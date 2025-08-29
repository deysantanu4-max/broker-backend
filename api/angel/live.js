// api/angel/live.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import express from "express";
import AngelOne from "angel-one"; // adjust if using a custom SDK

const require = createRequire(import.meta.url);

// Load ScripMaster.json safely without "assert"
const scripMaster = require("../../ScripMaster.json");

const router = express.Router();

// Cache
let feedTokenCache = null;
let feedTokenExpiry = null;
let instrumentMap = null; // token → details
let symbolMap = null;     // symbol → token

// --- Helpers ---
const loadScripMaster = () => {
  if (!instrumentMap) {
    console.log("📥 Loading ScripMaster...");
    instrumentMap = {};
    symbolMap = {};

    for (const item of scripMaster) {
      const token = String(item.token);
      const symbol = item.symbol?.toUpperCase();

      if (token && symbol) {
        instrumentMap[token] = item;
        symbolMap[symbol] = token;
      }
    }

    console.log(`✅ Built token maps: ${Object.keys(instrumentMap).length} tokens`);
  }
};

const getFeedToken = async () => {
  const now = Date.now();
  if (feedTokenCache && feedTokenExpiry && now < feedTokenExpiry) {
    return feedTokenCache;
  }

  console.log("🔑 Logging in to AngelOne…");
  const client = new AngelOne({
    apiKey: process.env.ANGEL_API_KEY,
    clientCode: process.env.ANGEL_CLIENT_CODE,
    password: process.env.ANGEL_PASSWORD,
    totpSecret: process.env.ANGEL_TOTP_SECRET,
  });

  const session = await client.generateSession();
  feedTokenCache = session.feedToken;
  feedTokenExpiry = now + 1000 * 60 * 60 * 12; // 12h cache

  console.log(`✅ Logged in, feedToken cached until ${new Date(feedTokenExpiry).toISOString()}`);
  return feedTokenCache;
};

// --- API Handler ---
router.get("/", async (req, res) => {
  try {
    console.log("📩 /api/angel/live hit");

    const { type = "indices", exchange = "NSE" } = req.query;

    // Ensure scrip master loaded
    loadScripMaster();

    // Build symbol list
    let symbols = [];
    if (type === "indices") {
      symbols = ["NIFTY 50", "NIFTY BANK"];
    } else if (type === "top25") {
      symbols =
        exchange === "BSE"
          ? [
              "RELIANCE", "HDFCBANK", "INFY", "ICICIBANK", "SBIN",
              "TCS", "KOTAKBANK", "HINDUNILVR", "BHARTIARTL", "BAJFINANCE",
              "ITC", "AXISBANK", "LT", "WIPRO", "ASIANPAINT",
              "ULTRACEMCO", "MARUTI", "SUNPHARMA", "HCLTECH", "POWERGRID",
              "TITAN", "NTPC", "ONGC", "JSWSTEEL", "ADANIPORTS"
            ]
          : [
              "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK",
              "SBIN", "HINDUNILVR", "KOTAKBANK", "LT", "BHARTIARTL",
              "AXISBANK", "BAJFINANCE", "ITC", "WIPRO", "ASIANPAINT",
              "ULTRACEMCO", "MARUTI", "SUNPHARMA", "HCLTECH", "POWERGRID",
              "TITAN", "NTPC", "ONGC", "JSWSTEEL", "ADANIPORTS"
            ];
    }

    // Map symbols → tokens
    const instruments = [];
    for (const sym of symbols) {
      const token = symbolMap[sym.toUpperCase()];
      if (token) {
        instruments.push({ symbol: sym, token });
      } else {
        console.log(`⚠️ Symbol not found in scripMaster: ${sym}`);
      }
    }

    console.log(`🔎 Built token list for ${exchange}: ${JSON.stringify(instruments)}`);

    // Ensure feed token ready
    await getFeedToken();

    // Respond with instruments list (later your websocket uses these tokens)
    res.json(instruments);
  } catch (err) {
    console.error("❌ Error in /api/angel/live:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
