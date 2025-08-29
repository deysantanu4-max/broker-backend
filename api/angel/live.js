// api/angel/live.js
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import https from "https";
import fs from "fs";
import path from "path";
import WebSocket from "ws";
import { getAngelTokens } from "./login-angel-mpin.js"; // same helper used in historical.js

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
const latestData = { indices: {}, stocks: {} }; // returned to UI
const tokenToInstrument = {}; // token -> { symbol, exch_seg, token }
const symbolKeyToToken = {}; // "NSE:RELIANCE" -> token

// Top-25 lists (your app's universe)
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

// Exchange mapping for SmartAPI subscribe payloads
// Common SmartAPI exchangeType (examples):
// 1 = indices, 2 = NSE equity, 3 = BSE equity
const EXCHANGE_TYPE = { INDICES: 1, NSE_EQ: 2, BSE_EQ: 3 };

// -------------------- ScripMaster loader (same style as historical.js) --------------------
async function loadScripMaster(exchange = "NSE") {
  try {
    if (!scripMasterCache) {
      console.log("📥 Loading local scrip master JSON...");
      const scripMasterPath = path.join(process.cwd(), "api", "angel", "OpenAPIScripMaster.json");
      const rawData = fs.readFileSync(scripMasterPath, "utf8");
      scripMasterCache = JSON.parse(rawData);
      console.log(`✅ Loaded ${scripMasterCache.length} instruments from local file`);
    }

    // If local file contains the requested exchange, return it
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

  // Fallback: fetch from Angel CDN
  console.log("🌐 Fetching ScripMaster from Angel CDN...");
  const res = await axios.get("https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json", {
    httpsAgent: new https.Agent({ rejectUnauthorized: false })
  });
  scripMasterCache = res.data;
  console.log(`✅ Loaded ${scripMasterCache.length} instruments from Angel API (CDN)`);
  return scripMasterCache;
}

// Build token maps (tokenToInstrument and symbolKeyToToken)
async function buildTokenMaps() {
  if (Object.keys(tokenToInstrument).length > 0 && Object.keys(symbolKeyToToken).length > 0) return;

  const scrips = await loadScripMaster("NSE"); // loads cache or CDN
  tokenToInstrument.__built = false;

  tokenToInstrument && Object.keys(tokenToInstrument).forEach(k => delete tokenToInstrument[k]);
  Object.keys(tokenToInstrument).length = 0;
  Object.keys(symbolKeyToToken).length = 0;

  for (const inst of scrips) {
    const exch = (inst.exch_seg || "").toUpperCase();
    const instType = (inst.instrumenttype || "").toUpperCase();
    const token = inst.token ? String(inst.token) : null;
    const rawSymbol = (inst.symbol || inst.tradingsymbol || "").toUpperCase();

    if (!token || !rawSymbol) continue;
    if (!(exch === "NSE" || exch === "BSE")) continue; // limit to exchanges you care about
    if (instType && instType !== "EQ") continue; // equities only

    const cleanSymbol = rawSymbol.replace(/-EQ$/, "");
    tokenToInstrument[token] = { token, symbol: cleanSymbol, exch_seg: exch };
    const key = `${exch}:${cleanSymbol}`;
    if (!symbolKeyToToken[key]) symbolKeyToToken[key] = token;
  }

  console.log(`✅ Built token maps: ${Object.keys(tokenToInstrument).length} tokens (NSE+BSE EQ)`);
  tokenToInstrument.__built = true;
}

// -------------------- Helpers to resolve token by exchange+symbol --------------------
async function resolveTokenFor(exchange, symbol) {
  await buildTokenMaps();
  const key = `${exchange.toUpperCase()}:${symbol.toUpperCase()}`;
  const foundToken = symbolKeyToToken[key];
  if (foundToken) return tokenToInstrument[foundToken];
  // fallback: try across exchanges (prefer NSE)
  const altKey = `NSE:${symbol.toUpperCase()}`;
  if (symbolKeyToToken[altKey]) return tokenToInstrument[symbolKeyToToken[altKey]];
  return null;
}

// -------------------- Binary decode fallback (best-effort) --------------------
function tryDecodeBinaryTick(buffer) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length < 9) return null;
    // Many SmartAPI binary packets include token as Int32BE at byte 1 and price at byte 5 (heuristic).
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
  // Build maps
  await buildTokenMaps();

  // Resolve tokens for requested symbols
  const resolved = [];
  for (const sym of symbols) {
    const inst = await resolveTokenFor(exchange, sym);
    if (inst) resolved.push(inst);
    else console.warn(`⚠️ Token not found for ${exchange}:${sym}`);
  }

  if (resolved.length === 0) {
    throw new Error(`No tokens resolved for Top25 ${exchange}`);
  }

  // Pre-populate latestData.stocks so UI can display 25 items immediately
  latestData.stocks = {}; // reset / rebuild
  resolved.forEach(inst => {
    const key = `${inst.exch_seg}:${inst.symbol}`;
    latestData.stocks[key] = {
      symbol: inst.symbol,
      exch: inst.exch_seg,
      token: inst.token,
      ltp: 0,
      change: 0,
      percentChange: 0
    };
  });

  // Build grouped tokenList for subscribe:
  // SmartAPI expects exchangeType numeric values; group tokens by exchange type
  const byExType = {}; // exType -> tokens[]
  for (const inst of resolved) {
    const exType = inst.exch_seg === "BSE" ? EXCHANGE_TYPE.BSE_EQ : EXCHANGE_TYPE.NSE_EQ;
    if (!byExType[exType]) byExType[exType] = [];
    byExType[exType].push(inst.token);
  }

  // Build tokenList groups (SmartAPI tokenList is array of { exchangeType, tokens: [] })
  const tokenListGroups = Object.entries(byExType).map(([exType, tokens]) => ({
    exchangeType: Number(exType),
    tokens
  }));

  lastSubscribedTokenGroups = tokenListGroups;

  // If WS already open, just (re)subscribe by sending subscribe messages
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("⚡ Re-using WS - sending subscribe batches");
    tokenListGroups.forEach((grp, idx) => {
      const subscribeMessage = { action: 1, params: { mode: 1, tokenList: [grp] } };
      try { ws.send(JSON.stringify(subscribeMessage)); }
      catch (e) { console.error("💥 subscribe send failed:", e.message); }
    });
    return;
  }

  // Else create the WebSocket
  const tokensForUrl = await (async () => {
    try {
      const { feedToken } = await getAngelTokens();
      return feedToken;
    } catch (e) {
      console.error("❌ getAngelTokens failed:", e.message);
      throw e;
    }
  })();

  const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${CLIENT_ID}&feedToken=${tokensForUrl}&apiKey=${API_KEY}`;
  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("✅ Connected to SmartAPI stream (smart-stream)");

    // Send subscribe for each group (batching safe)
    tokenListGroups.forEach((grp, idx) => {
      const subscribeMessage = { action: 1, params: { mode: 1, tokenList: [grp] } };
      try {
        ws.send(JSON.stringify(subscribeMessage));
        console.log(`📡 Subscribed group ${idx + 1}/${tokenListGroups.length}: exchangeType=${grp.exchangeType} tokens=${grp.tokens.length}`);
      } catch (e) {
        console.error("💥 Failed to send subscribe message:", e.message);
      }
    });

    // Also subscribe to indices if you want indices streaming in same WS (example tokens must be resolved to tokenIDs if needed)
    // Optionally: subscribe index token(s) here (left out because index token mapping may differ)
    isStreaming = true;
  });

  ws.on("message", (msg) => {
    try {
      // try JSON decode
      let parsed = null;
      const txt = (typeof msg.toString === "function") ? msg.toString() : null;
      try { parsed = txt ? JSON.parse(txt) : null; } catch (e) { parsed = null; }

      if (parsed) {
        // parsed may be control or array; normalize into array of ticks
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const it of items) {
          // Typical tick shape: { token, ltp, netChange, percentChange, exch }
          if (it?.token && typeof it.ltp !== "undefined") {
            const tok = String(it.token);
            const inst = tokenToInstrument[tok];
            const symbol = inst ? `${inst.exch_seg}:${inst.symbol}` : tok;
            const ltp = Number(it.ltp) || 0;
            const change = (typeof it.netChange !== "undefined") ? Number(it.netChange) : (typeof it.change !== "undefined" ? Number(it.change) : 0);
            const percentChange = (typeof it.percentChange !== "undefined") ? Number(it.percentChange) : (change && ltp ? (change / (ltp - change)) * 100 : 0);

            // Update latestData if present
            if (latestData.stocks[symbol]) {
              latestData.stocks[symbol].ltp = ltp;
              latestData.stocks[symbol].change = isNaN(change) ? 0 : change;
              latestData.stocks[symbol].percentChange = isNaN(percentChange) ? 0 : percentChange;
            } else {
              // If not in top25 prepopulated, optionally keep in tick map
              latestData.stocks[symbol] = {
                symbol,
                exch: inst ? inst.exch_seg : (it.exch || "NSE"),
                token: tok,
                ltp,
                change,
                percentChange
              };
            }

            console.log(`📈 Tick ${symbol} LTP=${ltp} Δ=${change} (%${(latestData.stocks[symbol].percentChange||0).toFixed(2)})`);
          } else {
            // control / other messages
            // lightweight logging
            if (it?.type || it?.event || it?.message) {
              console.log("📩 WS message:", it.type || it.event || it.message);
            }
          }
        }
        return;
      }

      // not JSON => try binary decode heuristic
      const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      const decoded = tryDecodeBinaryTick(buf);
      if (decoded && decoded.token) {
        const tok = decoded.token;
        const inst = tokenToInstrument[tok];
        const symbol = inst ? `${inst.exch_seg}:${inst.symbol}` : tok;
        const ltp = Number(decoded.ltp) || 0;
        if (latestData.stocks[symbol]) {
          latestData.stocks[symbol].ltp = ltp;
        } else {
          latestData.stocks[symbol] = { symbol, exch: inst ? inst.exch_seg : "NSE", token: tok, ltp, change: 0, percentChange: 0 };
        }
        console.log(`📈 Binary tick ${symbol} LTP=${ltp}`);
        return;
      }

      // otherwise ignore or lightly preview
    } catch (err) {
      console.error("💥 Parse tick error:", err.message || err);
    }
  });

  ws.on("close", async () => {
    console.warn("❌ WebSocket closed — will attempt reconnect in 5s");
    isStreaming = false;
    ws = null;
    setTimeout(async () => {
      try {
        if (lastSubscribedTokenGroups) {
          // rebuild a symbols array from token groups and restart
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
    console.error("💥 WebSocket error:", err && err.message ? err.message : err);
    isStreaming = false;
  });

  // Save token->instrument mapping for quick lookup on ticks
  for (const r of resolved) tokenToInstrument[r.token] = r;
}

// -------------------- API endpoints --------------------

// GET /api/angel/live?type=top25&exchange=NSE
app.get("/api/angel/live", async (req, res) => {
  try {
    const { type = null } = req.query;
    const exchange = (req.query.exchange || "NSE").toUpperCase();

    if (type === "top25") {
      // choose symbols based on exchange
      const symbols = exchange === "BSE" ? TOP25_BSE : TOP25_NSE;

      // ensure stream started for this exchange and those symbols
      try {
        await startSmartStream(exchange, symbols);
      } catch (e) {
        console.warn("⚠️ startSmartStream warning:", e.message);
        // still continue to return prepopulated list if possible
      }

      // Prepare response array of 25 objects in stable order (symbol keys)
      const response = symbols.map(sym => {
        const key = `${exchange}:${sym}`;
        const item = latestData.stocks[key];
        // Always return an object with consistent fields
        return {
          symbol: sym,
          exch: exchange,
          token: item ? item.token : (symbolKeyToToken ? symbolKeyToToken[`${exchange}:${sym}`] : null),
          ltp: item ? item.ltp : 0,
          change: item ? item.change : 0,
          percentChange: item ? item.percentChange : 0
        };
      });

      console.log(`🟢 GET top25 (${exchange}) -> ${response.length} items`);
      return res.status(200).json({ type: "top25", exchange, data: response, indices: latestData.indices });
    }

    // default: return latest snapshot
    return res.status(200).json({ indices: latestData.indices, stocks: latestData.stocks });
  } catch (err) {
    console.error("💥 /api/angel/live GET error:", err.message || err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
});

// POST /api/angel/live?exchange=NSE  -> explicit start
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
