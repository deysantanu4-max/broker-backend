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

const API_KEY = process.env.ANGEL_API_KEY;
const CLIENT_ID = process.env.ANGEL_CLIENT_ID;

let scripMasterCache = null;
let ws = null;
let isStreaming = false;
let latestData = { indices: {}, stocks: {} };

// -------------------- Load ScripMaster --------------------
async function loadScripMaster(exchange) {
  try {
    if (!scripMasterCache) {
      console.log("📥 Loading local scrip master JSON...");
      const scripMasterPath = path.join(
        process.cwd(),
        "api",
        "angel",
        "OpenAPIScripMaster.json"
      );
      const rawData = fs.readFileSync(scripMasterPath, "utf8");
      scripMasterCache = JSON.parse(rawData);
      console.log(`✅ Loaded ${scripMasterCache.length} instruments locally`);
    }

    const hasExchange = scripMasterCache.some(
      (inst) => inst.exch_seg.toUpperCase() === exchange
    );
    if (hasExchange) {
      console.log(`📄 Found exchange ${exchange} in local file`);
      return scripMasterCache;
    }
  } catch (err) {
    console.warn("⚠️ Failed local ScripMaster load:", err.message);
  }

  // fallback
  const res = await axios.get(
    "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
  );
  scripMasterCache = res.data;
  console.log(`✅ Loaded ${scripMasterCache.length} instruments from Angel API`);
  return scripMasterCache;
}

// -------------------- Resolve Token --------------------
function resolveToken(scripMaster, exchange, symbol) {
  const upperEx = exchange.toUpperCase();
  const upperSym = symbol.toUpperCase();

  let instrument = scripMaster.find(
    (inst) =>
      inst.exch_seg.toUpperCase() === upperEx &&
      (inst.symbol.toUpperCase() === upperSym ||
        inst.symbol.toUpperCase() === `${upperSym}-EQ`) &&
      (inst.instrumenttype === "" || inst.instrumenttype === "EQ")
  );

  if (!instrument) {
    instrument = scripMaster.find(
      (inst) =>
        inst.exch_seg.toUpperCase() === upperEx &&
        inst.name &&
        inst.name.toUpperCase().includes(upperSym)
    );
  }

  if (!instrument) return null;

  return {
    token: instrument.token,
    symbol: instrument.symbol.endsWith("-EQ")
      ? instrument.symbol
      : `${instrument.symbol}-EQ`,
    name: instrument.name,
    exch_seg: instrument.exch_seg,
  };
}

// -------------------- Start Streaming --------------------
async function startStreaming(exchange, symbols) {
  if (isStreaming && ws) return;

  const { feedToken } = await getAngelTokens();
  const scripMaster = await loadScripMaster(exchange);

  // resolve 25 stock tokens
  const stockList = symbols
    .map((sym) => resolveToken(scripMaster, exchange, sym))
    .filter(Boolean);

  console.log(`🔑 Resolved ${stockList.length} tokens for ${exchange}`);

  // pre-populate response with 0 values
  stockList.forEach((stk) => {
    latestData.stocks[stk.symbol] = {
      ltp: 0,
      change: 0,
      percentChange: 0,
      token: stk.token,
      exch: stk.exch_seg,
    };
  });

  // connect websocket
  const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientcode=${CLIENT_ID}&feedtoken=${feedToken}`;
  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("🟢 Connected to AngelOne SmartAPI stream");

    // subscribe to all stocks
    const subs = stockList.map((stk) => ({
      exchangeType: stk.exch_seg,
      tokens: [stk.token],
    }));

    ws.send(
      JSON.stringify({
        correlationID: "sub-stocks",
        action: 1,
        params: {
          mode: 1,
          tokenList: subs,
        },
      })
    );

    console.log("📡 Subscribed to stock ticks:", stockList.map((s) => s.symbol));

    // subscribe to indices (NIFTY, BANKNIFTY, SENSEX)
    ["NIFTY 50", "NIFTY BANK", "SENSEX"].forEach((idx) => {
      ws.send(
        JSON.stringify({
          correlationID: "sub-indices",
          action: 1,
          params: {
            mode: 1,
            tokenList: [
              {
                exchangeType: "NSE",
                tokens: [idx],
              },
            ],
          },
        })
      );
    });

    isStreaming = true;
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (!data || !data.data) return;

      data.data.forEach((tick) => {
        const token = tick.token;
        const ltp = tick.ltp;
        const symbolEntry = Object.values(latestData.stocks).find(
          (s) => s.token === token
        );
        if (symbolEntry) {
          symbolEntry.ltp = ltp;
          symbolEntry.change = tick.change || 0;
          symbolEntry.percentChange = tick.percentChange || 0;
        }
      });
    } catch (e) {
      console.error("⚠️ Tick parse error:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("🔴 Stream closed");
    isStreaming = false;
    ws = null;
  });

  ws.on("error", (err) => {
    console.error("❌ Stream error:", err.message);
    isStreaming = false;
  });
}

// -------------------- API --------------------
app.get("/api/angel/live", async (req, res) => {
  try {
    const { type } = req.query;

    if (type === "top25") {
      // your predefined list of top25 symbols
      const top25 = [
        "RELIANCE",
        "TCS",
        "INFY",
        "HDFCBANK",
        "ICICIBANK",
        "SBIN",
        "KOTAKBANK",
        "LT",
        "AXISBANK",
        "HCLTECH",
        "WIPRO",
        "HINDUNILVR",
        "ITC",
        "BHARTIARTL",
        "BAJFINANCE",
        "ASIANPAINT",
        "MARUTI",
        "SUNPHARMA",
        "ONGC",
        "POWERGRID",
        "ADANIGREEN",
        "ADANIPORTS",
        "COALINDIA",
        "NTPC",
        "ULTRACEMCO",
      ];

      await startStreaming("NSE", top25);

      return res.json({
        type: "top25",
        stocks: latestData.stocks,
      });
    }

    // default
    res.json({
      indices: latestData.indices,
      stocks: latestData.stocks,
    });
  } catch (err) {
    console.error("❌ Live fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default app;
