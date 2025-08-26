// /api/angel/stocks.js
import fs from "fs";
import path from "path";
import { startSmartStream } from "./live"; // <-- reuse live stream
import EventEmitter from "events";

const stockEvents = new EventEmitter();

// In-memory store for live ticks
let liveStocks = {};

// Load scrip master once
const scripFile = path.join(process.cwd(), "api", "angel", "OpenAPIScripMaster.json");
const scripMaster = JSON.parse(fs.readFileSync(scripFile, "utf8"));

// Map tokens -> scrip metadata
const tokenMap = {};
for (let scrip of scripMaster) {
  if (scrip.token) {
    tokenMap[scrip.token] = {
      token: scrip.token,
      name: scrip.name,
      symbol: scrip.symbol,
      exch: scrip.exch_seg,
      close: scrip.close || 0
    };
  }
}

// Start live streaming once at server startup
if (!global.smartStreamStarted) {
  const tokensToSubscribe = Object.keys(tokenMap).slice(0, 500); // subscribe first 500 (adjust)
  startSmartStream(process.env.ANGEL_CLIENT_ID, process.env.ANGEL_FEED_TOKEN, process.env.ANGEL_API_KEY, tokensToSubscribe);

  // Listen for ticks from live.js
  stockEvents.on("tick", (tick) => {
    try {
      const token = String(tick.token);
      const meta = tokenMap[token];
      if (!meta) return;

      const ltp = parseFloat(tick.ltp);
      const close = parseFloat(meta.close) || ltp;
      const change = ltp - close;
      const changePercent = close !== 0 ? (change / close) * 100 : 0;

      liveStocks[token] = {
        ...meta,
        ltp,
        change,
        changePercent
      };
    } catch (err) {
      console.error("💥 Error updating tick:", err);
    }
  });

  global.smartStreamStarted = true;
}

// Helper: sort & pick
function sortStocks(limit, type) {
  let arr = Object.values(liveStocks);

  if (type === "gainers") {
    arr.sort((a, b) => b.changePercent - a.changePercent);
  } else if (type === "losers") {
    arr.sort((a, b) => a.changePercent - b.changePercent);
  } else if (type === "neutral") {
    arr = arr.filter((s) => Math.abs(s.changePercent) < 0.2);
  } else {
    arr.sort((a, b) => b.ltp - a.ltp);
  }

  return limit ? arr.slice(0, limit) : arr;
}

// API handler
export default function handler(req, res) {
  try {
    const { type, limit } = req.query;

    let data;
    switch (type) {
      case "top25":
        data = sortStocks(25, "top");
        break;
      case "gainers":
        data = sortStocks(25, "gainers");
        break;
      case "losers":
        data = sortStocks(25, "losers");
        break;
      case "neutral":
        data = sortStocks(25, "neutral");
        break;
      default:
        data = sortStocks(50, "top");
        break;
    }

    res.setHeader("Content-Type", "application/json");
    res.status(200).json(data);
  } catch (err) {
    console.error("💥 stocks.js API error:", err);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
}
