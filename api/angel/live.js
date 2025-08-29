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

if (!CLIENT_ID || !API_KEY) {
  console.error("❌ Missing required env vars: ANGEL_CLIENT_ID or ANGEL_API_KEY");
}

// In-memory state
let scripMasterCache = null;
let ws = null;
let isStreaming = false;
const latestData = { indices: {}, stocks: {} };
const tokenToInstrument = {};
const symbolKeyToToken = {};

// Top-25 lists
const TOP25_NSE = [
  "RELIANCE","TCS","INFY","HDFCBANK","ICICIBANK",
  "SBIN","HINDUNILVR","KOTAKBANK","LT","BHARTIARTL",
  "AXISBANK","BAJFINANCE","ITC","WIPRO","ASIANPAINT",
  "ULTRACEMCO","MARUTI","SUNPHARMA","HCLTECH","POWERGRID",
  "TITAN","NTPC","ONGC","JSWSTEEL","ADANIPORTS"
];
const TOP25_BSE = [
  "RELIANCE","HDFCBANK","INFY","ICICIBANK","SBIN",
  "TCS","KOTAKBANK","HINDUNILVR","BHARTIARTL","BAJFINANCE",
  "ITC","AXISBANK","LT","WIPRO","ASIANPAINT",
  "ULTRACEMCO","MARUTI","SUNPHARMA","HCLTECH","POWERGRID",
  "TITAN","NTPC","ONGC","JSWSTEEL","ADANIPORTS"
];

// Exchange mapping
const EXCHANGE_TYPE = { INDICES: 1, NSE_EQ: 2, BSE_EQ: 3 };

// -------------------- Load ScripMaster --------------------
async function loadScripMaster(exchange = "NSE") {
  try {
    if (!scripMasterCache) {
      console.log("📥 Loading local scrip master JSON...");
      const scripMasterPath = path.join(process.cwd(), "api", "angel", "OpenAPIScripMaster.json");
      const rawData = fs.readFileSync(scripMasterPath, "utf8");
      scripMasterCache = JSON.parse(rawData);
      console.log(`✅ Loaded ${scripMasterCache.length} instruments from local file`);
    }

    const hasExchange = scripMasterCache.some(inst => (inst.exch_seg || "").toUpperCase() === exchange.toUpperCase());
    if (hasExchange) {
      console.log(`📄 Found exchange ${exchange} in local file`);
      return scripMasterCache;
    } else {
      console.log(`⚠️ Exchange ${exchange} not found in local file — will fetch CDN fallback`);
    }
  } catch (err) {
    console.warn("⚠️ Failed to load local ScripMaster:", err.message);
  }

  console.log("🌐 Fetching ScripMaster from Angel CDN...");
  const res = await axios.get("https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json", {
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  });
  scripMasterCache = res.data;
  console.log(`✅ Loaded ${scripMasterCache.length} instruments from Angel API (CDN)`);
  return scripMasterCache;
}

// -------------------- Build token maps --------------------
async function buildTokenMaps() {
  if (Object.keys(tokenToInstrument).length > 0 && Object.keys(symbolKeyToToken).length > 0) return;

  const scrips = await loadScripMaster("NSE");

  Object.keys(tokenToInstrument).forEach(k => delete tokenToInstrument[k]);
  Object.keys(symbolKeyToToken).forEach(k => delete symbolKeyToToken[k]);

  for (const inst of scrips) {
    const exch = (inst.exch_seg || "").toUpperCase();
    const instType = (inst.instrumenttype || "").toUpperCase();
    const token = inst.token ? String(inst.token) : null;
    const rawSymbol = (inst.symbol || inst.tradingsymbol || "").toUpperCase();

    if (!token || !rawSymbol) continue;
    if (!(exch === "NSE" || exch === "BSE")) continue;
    if (instType && instType !== "EQ") continue;

    const cleanSymbol = rawSymbol.replace(/-EQ$/, "");
    tokenToInstrument[token] = { token, symbol: cleanSymbol, exch_seg: exch };
    const key = `${exch}:${cleanSymbol}`;
    if (!symbolKeyToToken[key]) symbolKeyToToken[key] = token;
  }

  console.log(`✅ Built token maps: ${Object.keys(tokenToInstrument).length} tokens`);
}

// -------------------- Resolve token --------------------
async function resolveTokenFor(exchange, symbol) {
  await buildTokenMaps();
  const key = `${exchange.toUpperCase()}:${symbol.toUpperCase()}`;
  const foundToken = symbolKeyToToken[key];
  if (foundToken) return tokenToInstrument[foundToken];

  const altKey = `NSE:${symbol.toUpperCase()}`;
  if (symbolKeyToToken[altKey]) return tokenToInstrument[symbolKeyToToken[altKey]];

  return null;
}

// -------------------- Binary decode fallback --------------------
function tryDecodeBinaryTick(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 9) return null;
    const token = String(buffer.readInt32BE(1));
    const rawPrice = buffer.readInt32BE(5);
    const ltp = rawPrice / 100.0;
    return { token, ltp };
  } catch (err) {
    return null;
  }
}

// -------------------- Start SmartAPI stream --------------------
let lastSubscribedTokenGroups = null;

async function startSmartStream(exchange = "NSE", symbols = TOP25_NSE) {
  await buildTokenMaps();

  const resolved = [];
  for (const sym of symbols) {
    const inst = await resolveTokenFor(exchange, sym);
    if (inst) resolved.push(inst);
    else console.warn(`⚠️ Token not found for ${exchange}:${sym}`);
  }

  if (resolved.length === 0) throw new Error(`No tokens resolved for Top25 ${exchange}`);

  latestData.stocks = {};
  resolved.forEach(inst => {
    const key = `${inst.exch_seg}:${inst.symbol}`;
    latestData.stocks[key] = { symbol: inst.symbol, exch: inst.exch_seg, token: inst.token, ltp: 0, change: 0, percentChange: 0 };
  });

  console.log("🔹 Resolved tokens for subscription:", resolved.map(r => `${r.exch_seg}:${r.symbol}(${r.token})`).join(", "));

  const byExType = {};
  for (const inst of resolved) {
    const exType = inst.exch_seg === "BSE" ? EXCHANGE_TYPE.BSE_EQ : EXCHANGE_TYPE.NSE_EQ;
    if (!byExType[exType]) byExType[exType] = [];
    byExType[exType].push(inst.token);
  }

  const tokenListGroups = Object.entries(byExType).map(([exType, tokens]) => ({ exchangeType: Number(exType), tokens }));
  lastSubscribedTokenGroups = tokenListGroups;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    const { feedToken } = await getAngelTokens();
    const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${CLIENT_ID}&feedToken=${feedToken}&apiKey=${API_KEY}`;
    ws = new WebSocket(wsUrl);
  }

  ws.on("open", () => {
    console.log("✅ Connected to SmartAPI stream");

    tokenListGroups.forEach((grp, idx) => {
      const subscribeMessage = { action: 1, params: { mode: 1, tokenList: [grp] } };
      try {
        ws.send(JSON.stringify(subscribeMessage));
        console.log(`📡 Subscribed group ${idx + 1}/${tokenListGroups.length}: exchangeType=${grp.exchangeType} tokens=${grp.tokens.length}`);
      } catch (e) {
        console.error("💥 Failed to send subscribe message:", e.message);
      }
    });
    isStreaming = true;
  });

  ws.on("message", (msg) => {
    try {
      let parsed = null;
      try { parsed = JSON.parse(msg.toString()); } catch (e) { parsed = null; }
      const ticks = Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []);

      ticks.forEach(it => {
        if (!it?.token || typeof it.ltp === "undefined") return;

        const tok = String(it.token);
        const inst = tokenToInstrument[tok];
        const key = inst ? `${inst.exch_seg}:${inst.symbol}` : tok;

        if (!latestData.stocks[key]) {
          console.warn(`⚠️ Tick received for unknown key ${key}, creating entry.`);
          latestData.stocks[key] = { symbol: inst?.symbol || tok, exch: inst?.exch_seg || "NSE", token: tok, ltp: 0, change: 0, percentChange: 0 };
        }

        const change = typeof it.netChange !== "undefined" ? Number(it.netChange) : 0;
        const ltp = Number(it.ltp) || 0;
        const percentChange = change && ltp ? (change / (ltp - change)) * 100 : 0;

        latestData.stocks[key].ltp = ltp;
        latestData.stocks[key].change = change;
        latestData.stocks[key].percentChange = percentChange;

        console.log(`📈 Tick ${key} LTP=${ltp} Δ=${change} (%${percentChange.toFixed(2)})`);
      });

      // fallback binary
      if (!ticks.length) {
        const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
        const decoded = tryDecodeBinaryTick(buf);
        if (decoded && decoded.token) {
          const tok = decoded.token;
          const inst = tokenToInstrument[tok];
          const key = inst ? `${inst.exch_seg}:${inst.symbol}` : tok;
          if (!latestData.stocks[key]) latestData.stocks[key] = { symbol: inst?.symbol || tok, exch: inst?.exch_seg || "NSE", token: tok, ltp: 0, change: 0, percentChange: 0 };
          latestData.stocks[key].ltp = decoded.ltp;
          console.log(`📈 Binary tick ${key} LTP=${decoded.ltp}`);
        }
      }
    } catch (err) {
      console.error("💥 Parse tick error:", err.message || err);
    }
  });

  ws.on("close", async () => {
    console.warn("❌ WebSocket closed — reconnecting in 5s");
    isStreaming = false;
    ws = null;
    setTimeout(async () => {
      try {
        if (lastSubscribedTokenGroups) {
          const tokens = lastSubscribedTokenGroups.flatMap(g => g.tokens);
          const symbolsFromTokens = tokens.map(t => {
            const inst = tokenToInstrument[t];
            return inst ? inst.symbol : null;
          }).filter(Boolean);
          await startSmartStream(exchange, symbolsFromTokens);
        }
      } catch (e) {
        console.error("💥 Reconnect start failed:", e.message || e);
      }
    }, 5000);
  });

  ws.on("error", (err) => {
    console.error("💥 WebSocket error:", err?.message || err);
    isStreaming = false;
  });
}

// -------------------- API endpoints --------------------
app.get("/api/angel/live", async (req, res) => {
  try {
    const { type = null } = req.query;
    const exchange = (req.query.exchange || "NSE").toUpperCase();

    if (type === "top25") {
      const symbols = exchange === "BSE" ? TOP25_BSE : TOP25_NSE;
      try { await startSmartStream(exchange, symbols); } catch (e) { console.warn(e.message); }

      const response = symbols.map(sym => {
        const key = `${exchange}:${sym}`;
        const item = latestData.stocks[key];
        return {
          symbol: sym,
          exch: exchange,
          token: item ? item.token : symbolKeyToToken?.[key] || null,
          ltp: item?.ltp || 0,
          change: item?.change || 0,
          percentChange: item?.percentChange || 0
        };
      });

      console.log(`🟢 GET top25 (${exchange}) -> ${response.length} items`);
      return res.status(200).json({ type: "top25", exchange, data: response, indices: latestData.indices });
    }

    return res.status(200).json({ indices: latestData.indices, stocks: latestData.stocks });
  } catch (err) {
    console.error("💥 /api/angel/live GET error:", err.message || err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

app.post("/api/angel/live", async (req, res) => {
  try {
    const exchange = (req.query.exchange || "NSE").toUpperCase();
    const symbols = exchange === "BSE" ? TOP25_BSE : TOP25_NSE;
    await startSmartStream(exchange, symbols);
    return res.status(200).json({ message: `✅ Streaming active for ${exchange}`, subscribedCount: Object.keys(latestData.stocks).length });
  } catch (err) {
    console.error("💥 /api/angel/live POST error:", err.message || err);
    return res.status(500).json({ error: err.message || "Failed to start streaming" });
  }
});

export default app;
