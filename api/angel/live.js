// api/angel/live.js
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import https from "https";
import fs from "fs";
import path from "path";
import WebSocket from "ws";
import { getAngelTokens } from "./login-angel-mpin.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const API_KEY = process.env.ANGEL_API_KEY;
if (!CLIENT_ID || !API_KEY) console.error("❌ Missing ANGEL_CLIENT_ID or ANGEL_API_KEY");

// ---------------- State ----------------
let scripMasterCache = null;
let ws = null;
let isStreaming = false;
const latestData = { indices: {}, stocks: {} };
const tokenToInstrument = {};
const symbolKeyToToken = {};

const TOP25_NSE = ["RELIANCE","TCS","INFY","HDFCBANK","ICICIBANK","SBIN","HINDUNILVR","KOTAKBANK","LT","BHARTIARTL","AXISBANK","BAJFINANCE","ITC","WIPRO","ASIANPAINT","ULTRACEMCO","MARUTI","SUNPHARMA","HCLTECH","POWERGRID","TITAN","NTPC","ONGC","JSWSTEEL","ADANIPORTS"];
const TOP25_BSE = ["RELIANCE","HDFCBANK","INFY","ICICIBANK","SBIN","TCS","KOTAKBANK","HINDUNILVR","BHARTIARTL","BAJFINANCE","ITC","AXISBANK","LT","WIPRO","ASIANPAINT","ULTRACEMCO","MARUTI","SUNPHARMA","HCLTECH","POWERGRID","TITAN","NTPC","ONGC","JSWSTEEL","ADANIPORTS"];
const EXCHANGE_TYPE = { INDICES: 1, NSE_EQ: 2, BSE_EQ: 3 };

// ---------------- ScripMaster ----------------
async function loadScripMaster() {
    if (scripMasterCache) return scripMasterCache;
    try {
        const localPath = path.join(process.cwd(), "api", "angel", "OpenAPIScripMaster.json");
        const raw = fs.readFileSync(localPath, "utf8");
        scripMasterCache = JSON.parse(raw);
        console.log(`✅ Loaded ${scripMasterCache.length} instruments locally`);
        return scripMasterCache;
    } catch {
        const res = await axios.get("https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json", { httpsAgent: new https.Agent({ rejectUnauthorized: false }) });
        scripMasterCache = res.data;
        console.log(`✅ Loaded ${scripMasterCache.length} instruments from CDN`);
        return scripMasterCache;
    }
}

async function buildTokenMaps() {
    if (Object.keys(tokenToInstrument).length) return;
    const scrips = await loadScripMaster();
    for (const inst of scrips) {
        const exch = (inst.exch_seg || "").toUpperCase();
        const type = (inst.instrumenttype || "").toUpperCase();
        const token = inst.token ? String(inst.token) : null;
        const sym = (inst.symbol || inst.tradingsymbol || "").toUpperCase();
        if (!token || !sym) continue;
        if (!(exch === "NSE" || exch === "BSE")) continue;
        if (type && type !== "EQ") continue;
        tokenToInstrument[token] = { token, symbol: sym, exch_seg: exch };
        symbolKeyToToken[`${exch}:${sym}`] = token;
    }
    console.log(`✅ Token maps built: ${Object.keys(tokenToInstrument).length}`);
}

async function resolveToken(exchange, symbol) {
    await buildTokenMaps();
    return tokenToInstrument[symbolKeyToToken[`${exchange}:${symbol}`]] || tokenToInstrument[symbolKeyToToken[`NSE:${symbol}`]] || null;
}

// ---------------- SmartAPI Stream ----------------
let lastSubscribedGroups = null;
async function startSmartStream(exchange = "NSE", symbols = TOP25_NSE) {
    await buildTokenMaps();
    const resolved = await Promise.all(symbols.map(sym => resolveToken(exchange, sym)));
    const valid = resolved.filter(r => r);
    if (!valid.length) throw new Error(`No tokens resolved for ${exchange}`);

    latestData.stocks = {};
    valid.forEach(inst => {
        const key = `${inst.exch_seg}:${inst.symbol}`;
        latestData.stocks[key] = { symbol: inst.symbol, exch: inst.exch_seg, token: inst.token, ltp: 0, change: 0, percentChange: 0 };
    });

    // Group tokens by exchangeType
    const byExType = {};
    valid.forEach(inst => {
        const exType = inst.exch_seg === "BSE" ? EXCHANGE_TYPE.BSE_EQ : EXCHANGE_TYPE.NSE_EQ;
        if (!byExType[exType]) byExType[exType] = [];
        byExType[exType].push(inst.token);
    });
    const groups = Object.entries(byExType).map(([exType, tokens]) => ({ exchangeType: Number(exType), tokens }));
    lastSubscribedGroups = groups;

    if (ws && ws.readyState === WebSocket.OPEN) {
        groups.forEach(g => ws.send(JSON.stringify({ action: 1, params: { mode: 1, tokenList: [g] } })));
        return;
    }

    const { feedToken } = await getAngelTokens();
    const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${CLIENT_ID}&feedToken=${feedToken}&apiKey=${API_KEY}`;
    ws = new WebSocket(wsUrl);

    ws.on("open", () => {
        console.log("✅ SmartAPI WS connected");
        groups.forEach(g => ws.send(JSON.stringify({ action: 1, params: { mode: 1, tokenList: [g] } }))); 
        isStreaming = true;
    });

    ws.on("message", msg => {
        try {
            let data = null;
            try { data = JSON.parse(msg.toString()); } catch {}
            if (data) {
                const arr = Array.isArray(data) ? data : [data];
                arr.forEach(it => {
                    if (!it?.token) return;
                    const tok = String(it.token);
                    const inst = tokenToInstrument[tok];
                    const key = inst ? `${inst.exch_seg}:${inst.symbol}` : tok;
                    const ltp = Number(it.ltp) || 0;
                    const change = Number(it.netChange || it.change || 0);
                    const pct = Number(it.percentChange || (change && ltp ? (change/(ltp-change))*100 : 0));
                    latestData.stocks[key] = { symbol: inst?.symbol || key, exch: inst?.exch_seg || "NSE", token: tok, ltp, change, percentChange: pct };
                });
            }
        } catch (e) { console.error(e); }
    });

    ws.on("close", () => { console.warn("WS closed, reconnecting in 5s"); isStreaming = false; ws = null; setTimeout(() => startSmartStream(exchange, symbols), 5000); });
    ws.on("error", e => { console.error("WS error", e.message); isStreaming = false; });
}

// ---------------- API Endpoints ----------------
app.get("/api/angel/live", async (req, res) => {
    try {
        const exchange = (req.query.exchange || "NSE").toUpperCase();
        const symbols = exchange === "BSE" ? TOP25_BSE : TOP25_NSE;
        if (!isStreaming) await startSmartStream(exchange, symbols);

        const resolvedItems = await Promise.all(symbols.map(sym => resolveToken(exchange, sym)));
        const response = resolvedItems.map(inst => ({
            symbol: inst.symbol,
            exch: inst.exch_seg,
            token: inst.token,
            ltp: latestData.stocks[`${exchange}:${inst.symbol}`]?.ltp || 0,
            change: latestData.stocks[`${exchange}:${inst.symbol}`]?.change || 0,
            percentChange: latestData.stocks[`${exchange}:${inst.symbol}`]?.percentChange || 0
        }));

        return res.status(200).json({ type: "top25", exchange, data: response, indices: latestData.indices });
    } catch (e) { console.error(e); return res.status(500).json({ error: e.message }); }
});

app.post("/api/angel/live", async (req, res) => {
    try {
        const exchange = (req.query.exchange || "NSE").toUpperCase();
        const symbols = exchange === "BSE" ? TOP25_BSE : TOP25_NSE;
        await startSmartStream(exchange, symbols);
        return res.status(200).json({ message: `✅ Streaming active for ${exchange}`, subscribedCount: Object.keys(latestData.stocks).length });
    } catch (e) { console.error(e); return res.status(500).json({ error: e.message }); }
});

export default app;
