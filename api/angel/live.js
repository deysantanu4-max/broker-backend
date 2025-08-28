// /api/angel/live.js
import axios from "axios";
import crypto from "crypto";
import https from "https";
import WebSocket from "ws";
import EventEmitter from "events";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

import { getAngelTokens } from "./login-angel-mpin.js";

dotenv.config();

const tickStore = {}; // { token: { symbol, ltp, change, percentChange, exch } }
const tickEmitter = new EventEmitter();

let cachedLogin = null; // { feedToken, jwtToken, expiry }
let ws = null;
let scripMasterCache = null;

const exchangeMap = { NSE: "NSE", BSE: "BSE" };

// -------------------- ScripMaster Loader --------------------
async function loadScripMaster(exchange) {
  try {
    if (!scripMasterCache) {
      console.log("📥 Loading local scrip master JSON...");
      const scripMasterPath = path.join(process.cwd(), "api", "angel", "OpenAPIScripMaster.json");
      const rawData = fs.readFileSync(scripMasterPath, "utf8");
      scripMasterCache = JSON.parse(rawData);
      console.log(`✅ Loaded ${scripMasterCache.length} instruments from local file`);
    }
    return scripMasterCache.filter(inst => inst.exch_seg.toUpperCase() === exchange);
  } catch (err) {
    console.warn("⚠️ Failed to load local ScripMaster:", err.message);
    return [];
  }
}

// -------------------- Login & cache session --------------------
async function loginOnce() {
  const now = Date.now();
  if (cachedLogin && now < cachedLogin.expiry) return cachedLogin;

  console.log("🔑 Logging in to AngelOne...");
  const apiKey = process.env.ANGEL_API_KEY;
  const clientId = process.env.ANGEL_CLIENT_ID;
  const password = process.env.ANGEL_PASSWORD;
  const totpSecret = process.env.ANGEL_TOTP_SECRET;

  const generateTOTP = (secret) => {
    const epoch = Math.floor(Date.now() / 1000);
    const time = Math.floor(epoch / 30);
    const key = Buffer.from(secret, "hex"); // simple for demo, replace with base32 decode if needed
    const buffer = Buffer.alloc(8);
    buffer.writeUInt32BE(0, 0);
    buffer.writeUInt32BE(time, 4);
    const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const otp = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
    return otp.toString().padStart(6, "0");
  };

  const payload = { clientcode: clientId, password, totp: generateTOTP(totpSecret) };
  const headers = {
    "X-PrivateKey": apiKey,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "00:00:00:00:00:00",
  };

  const loginResp = await axios.post(
    "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword",
    payload,
    { headers, httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
  );

  if (!loginResp.data?.data?.feedToken) throw new Error("Login failed: no feedToken");

  cachedLogin = {
    feedToken: loginResp.data.data.feedToken,
    jwtToken: loginResp.data.data.jwtToken,
    expiry: now + 11 * 60 * 60 * 1000 // 11h cache
  };

  console.log("✅ Logged in, feedToken cached until", new Date(cachedLogin.expiry).toISOString());
  return cachedLogin;
}

// -------------------- WebSocket --------------------
function startSmartStream(clientCode, feedToken, apiKey, tokensToSubscribe) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("⚡ Reusing existing WebSocket");
    return;
  }

  const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${clientCode}&feedToken=${feedToken}&apiKey=${apiKey}`;
  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("✅ Connected to SmartAPI stream");
    ws.send(JSON.stringify({
      action: 1,
      params: { mode: 1, tokenList: [{ exchangeType: 1, tokens: tokensToSubscribe }] }
    }));
    console.log("📡 Subscribed tokens:", tokensToSubscribe);
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data?.ltp && data?.token) {
        tickStore[data.token] = {
          symbol: data.symbol || data.token,
          ltp: data.ltp,
          change: data.netChange ?? 0,
          percentChange: data.percentChange ?? 0,
          exch: data.exch || "NSE"
        };
        tickEmitter.emit("tick", tickStore[data.token]);
      }
    } catch (err) { console.error("💥 Parse tick error:", err); }
  });

  ws.on("close", () => {
    console.log("❌ WebSocket closed, reconnecting in 5s...");
    setTimeout(async () => {
      const session = await loginOnce();
      startSmartStream(clientCode, session.feedToken, apiKey, tokensToSubscribe);
    }, 5000);
  });

  ws.on("error", (err) => console.error("💥 WebSocket error:", err));
}

// -------------------- Utilities --------------------
function getTop25() {
  return Object.values(tickStore)
    .sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange))
    .slice(0, 25);
}
const getGainers = () => Object.values(tickStore).filter(s => s.percentChange > 0);
const getLosers = () => Object.values(tickStore).filter(s => s.percentChange < 0);
const getNeutrals = () => Object.values(tickStore).filter(s => s.percentChange === 0);

// -------------------- API Handler --------------------
export default async function handler(req, res) {
  console.log("📩 /api/angel/live hit");

  if (req.method === "GET") {
    const { type } = req.query;
    if (type === "top25") return res.status(200).json(getTop25());
    if (type === "gainers") return res.status(200).json(getGainers());
    if (type === "losers") return res.status(200).json(getLosers());
    if (type === "neutral") return res.status(200).json(getNeutrals());
    return res.status(200).json({ ticks: tickStore });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const apiKey = process.env.ANGEL_API_KEY;
    const clientId = process.env.ANGEL_CLIENT_ID;

    // -------------------- Fetch top25 tokens dynamically --------------------
    const NSE = await loadScripMaster("NSE");
    const BSE = await loadScripMaster("BSE");

    // Pick top25 from your static list if you want, else all
    const symbols = [
      "RELIANCE","TCS","INFY","HDFCBANK","ICICIBANK","SBIN","HINDUNILVR","KOTAKBANK",
      "LT","BHARTIARTL","AXISBANK","BAJFINANCE","ITC","WIPRO","ASIANPAINT","ULTRACEMCO",
      "MARUTI","SUNPHARMA","HCLTECH","POWERGRID","TITAN","NTPC","ONGC","JSWSTEEL","ADANIPORTS"
    ];

    const tokensToSubscribe = [];

    function findToken(symbol, exchangeArray) {
      const inst = exchangeArray.find(i => i.symbol.toUpperCase() === symbol || i.symbol.toUpperCase() === `${symbol}-EQ`);
      if (inst) tokensToSubscribe.push(inst.token);
    }

    symbols.forEach(sym => { findToken(sym, NSE); findToken(sym, BSE); });

    console.log("📡 Subscribing tokens:", tokensToSubscribe);

    const session = await loginOnce();
    startSmartStream(clientId, session.feedToken, apiKey, tokensToSubscribe);

    return res.status(200).json({
      message: "✅ Streaming active",
      clientCode: clientId,
      feedToken: session.feedToken,
      subscribedTokens: tokensToSubscribe
    });

  } catch (err) {
    console.error("💥 Live API error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
