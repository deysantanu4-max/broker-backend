// /api/angel/live.js
import fs from "fs";
import path from "path";
import axios from "axios";
import crypto from "crypto";
import https from "https";
import WebSocket from "ws";
import EventEmitter from "events";

// =========================
// Globals
// =========================
const tickStore = {}; // { token: { symbol, ltp, change, percentChange, exch } }
const tickEmitter = new EventEmitter();

let cachedLogin = null; // { feedToken, jwtToken, expiry }
let ws = null;

// --- Scrip Master Cache ---
let scripMaster = null;
let symbolToTokenMap = {};
let tokenToSymbolMap = {};

// =========================
// Load Scrip Master
// =========================
async function loadScripMaster() {
  if (scripMaster) return;

  const filePath = path.join(process.cwd(), "data", "OpenAPIScripMaster.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  scripMaster = JSON.parse(raw);
  console.log("📥 Loaded ScripMaster locally:", scripMaster.length, "instruments");

  // NSE + BSE
  symbolToTokenMap = {};
  tokenToSymbolMap = {};
  for (let inst of scripMaster) {
    if ((inst.exch_seg === "NSE" || inst.exch_seg === "BSE") && inst.symbol.endsWith("-EQ")) {
      const sym = inst.symbol.replace("-EQ", "");
      const key = inst.exch_seg + ":" + sym;
      symbolToTokenMap[key] = inst.token;
      tokenToSymbolMap[inst.token] = { symbol: sym, exch: inst.exch_seg };
    }
  }

  console.log("✅ Built token maps:", Object.keys(symbolToTokenMap).length, "tokens (NSE+BSE EQ)");
}

// =========================
// Base32 decode + TOTP
// =========================
function base32ToBuffer(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "", buffer = [];
  base32 = base32.replace(/=+$/, "").toUpperCase();
  for (let char of base32) {
    const val = alphabet.indexOf(char);
    if (val === -1) throw new Error("Invalid base32 character.");
    bits += val.toString(2).padStart(5, "0");
  }
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    buffer.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(buffer);
}

function generateTOTP(secret) {
  const epoch = Math.floor(Date.now() / 1000);
  const time = Math.floor(epoch / 30);
  const key = base32ToBuffer(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(0, 0);
  buffer.writeUInt32BE(time, 4);
  const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const otp = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return otp.toString().padStart(6, "0");
}

// =========================
// Login & cache session
// =========================
async function loginOnce() {
  const now = Date.now();
  if (cachedLogin && now < cachedLogin.expiry) {
    return cachedLogin;
  }

  console.log("🔑 Logging in to AngelOne…");

  const apiKey = process.env.ANGEL_API_KEY;
  const clientId = process.env.ANGEL_CLIENT_ID;
  const password = process.env.ANGEL_PASSWORD;
  const totpSecret = process.env.ANGEL_TOTP_SECRET;

  const payload = {
    clientcode: clientId,
    password: password,
    totp: generateTOTP(totpSecret)
  };

  const headers = {
    "X-PrivateKey": apiKey,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "192.168.29.1",   // aligned with historical.js
    "X-ClientPublicIP": "106.193.147.98", // aligned with historical.js
    "X-MACAddress": "00:0a:95:9d:68:16"
  };

  const loginResp = await axios.post(
    "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword",
    payload,
    { headers, httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
  );

  if (!loginResp.data?.data?.feedToken) {
    throw new Error("Login failed: no feedToken");
  }

  cachedLogin = {
    feedToken: loginResp.data.data.feedToken,
    jwtToken: loginResp.data.data.jwtToken,
    expiry: now + 11 * 60 * 60 * 1000 // 11h cache
  };

  console.log("✅ Logged in, feedToken cached until", new Date(cachedLogin.expiry).toISOString());
  return cachedLogin;
}

// =========================
// WebSocket stream
// =========================
function startSmartStream(clientCode, feedToken, apiKey, tokensToSubscribe) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("⚡ Reusing existing WebSocket");
    return;
  }

  const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${clientCode}&feedToken=${feedToken}&apiKey=${apiKey}`;
  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("✅ Connected to SmartAPI stream");

    const subscribeMessage = {
      action: 1,
      params: {
        mode: 1, // LTP
        tokenList: [{ exchangeType: 1, tokens: tokensToSubscribe }]
      }
    };
    ws.send(JSON.stringify(subscribeMessage));
    console.log("📡 Subscribed tokens:", tokensToSubscribe);
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data?.ltp && data?.token) {
        const meta = tokenToSymbolMap[data.token] || {};
        tickStore[data.token] = {
          symbol: meta.symbol || data.token,
          ltp: data.ltp,
          change: data.netChange ?? 0,
          percentChange: data.percentChange ?? 0,
          exch: meta.exch || "NSE"
        };
        tickEmitter.emit("tick", tickStore[data.token]);
      } else {
        console.log("📩 Raw tick:", msg.toString());
      }
    } catch (err) {
      console.error("💥 Parse tick error:", err);
    }
  });

  ws.on("close", () => {
    console.log("❌ WebSocket closed, reconnecting in 5s…");
    setTimeout(async () => {
      const session = await loginOnce();
      startSmartStream(clientCode, session.feedToken, apiKey, tokensToSubscribe);
    }, 5000);
  });

  ws.on("error", (err) => {
    console.error("💥 WebSocket error:", err);
  });
}

// =========================
// Helpers
// =========================
function getTop25() {
  return Object.values(tickStore).sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange)).slice(0, 25);
}
const getGainers = () => Object.values(tickStore).filter((s) => s.percentChange > 0);
const getLosers = () => Object.values(tickStore).filter((s) => s.percentChange < 0);
const getNeutrals = () => Object.values(tickStore).filter((s) => s.percentChange === 0);

function resolveTokens(symbols, exchange="NSE") {
  return symbols
    .map(sym => symbolToTokenMap[exchange + ":" + sym])
    .filter(Boolean);
}

// =========================
// API Handler
// =========================
export default async function handler(req, res) {
  console.log("📩 /api/angel/live hit", req.method, req.url);

  if (req.method === "GET") {
    const { type } = req.query;
    if (type === "top25") return res.status(200).json(getTop25());
    if (type === "gainers") return res.status(200).json(getGainers());
    if (type === "losers") return res.status(200).json(getLosers());
    if (type === "neutral") return res.status(200).json(getNeutrals());
    return res.status(200).json({ ticks: tickStore });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    await loadScripMaster();

    const apiKey = process.env.ANGEL_API_KEY;
    const clientId = process.env.ANGEL_CLIENT_ID;

    // Top 25 lists
    const nseTop25Symbols = [
      "RELIANCE","TCS","INFY","HDFCBANK","ICICIBANK","SBIN","HINDUNILVR","KOTAKBANK",
      "LT","BHARTIARTL","AXISBANK","BAJFINANCE","ITC","WIPRO","ASIANPAINT","ULTRACEMCO",
      "MARUTI","SUNPHARMA","HCLTECH","POWERGRID","TITAN","NTPC","ONGC","JSWSTEEL","ADANIPORTS"
    ];
    const bseTop25Symbols = [
      "RELIANCE","TCS","INFY","HDFCBANK","ICICIBANK","SBIN","HINDUNILVR","KOTAKBANK",
      "LT","BHARTIARTL","AXISBANK","BAJFINANCE","ITC","WIPRO","ASIANPAINT","ULTRACEMCO",
      "MARUTI","SUNPHARMA","HCLTECH","POWERGRID","TITAN","NTPC","ONGC","JSWSTEEL","ADANIPORTS"
    ];

    const { exchange = "NSE" } = req.query;
    const symbols = exchange === "BSE" ? bseTop25Symbols : nseTop25Symbols;
    const tokensToSubscribe = resolveTokens(symbols, exchange);

    console.log(`🔍 [${exchange}] Resolved tokens:`, tokensToSubscribe.length, tokensToSubscribe);

    const session = await loginOnce();
    startSmartStream(clientId, session.feedToken, apiKey, tokensToSubscribe);

    return res.status(200).json({
      message: `✅ Streaming active for ${exchange}`,
      subscribed: tokensToSubscribe.length,
      exchange,
      clientCode: clientId
    });
  } catch (err) {
    console.error("💥 Live API error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
