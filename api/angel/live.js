// /api/angel/live.js
import axios from "axios";
import crypto from "crypto";
import https from "https";
import WebSocket from "ws";
import EventEmitter from "events";
import fs from "fs";
import path from "path";

// -----------------------------
// In-memory stores
// -----------------------------
const tickStore = {}; // { "RELIANCE": { symbol, ltp, change, percentChange, exch } }
const tickEmitter = new EventEmitter();
let ws = null;

// Login/session cache
let cachedLogin = null; // { feedToken, jwtToken, expiry }

// Scrip master mappings
let tokenToSymbol = {}; // { "26009": "RELIANCE", ... }
let symbolToToken = {}; // { "RELIANCE": "26009", ... }

// -----------------------------
// Your Top 25 (NSE) universe
// -----------------------------
const TOP25_NSE = [
  "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK",
  "SBIN", "HINDUNILVR", "KOTAKBANK", "LT", "BHARTIARTL",
  "AXISBANK", "BAJFINANCE", "ITC", "WIPRO", "ASIANPAINT",
  "ULTRACEMCO", "MARUTI", "SUNPHARMA", "HCLTECH", "POWERGRID",
  "TITAN", "NTPC", "ONGC", "JSWSTEEL", "ADANIPORTS"
];

// -----------------------------
// Base32 decode + TOTP
// -----------------------------
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

// -----------------------------
// Login & cache session
// -----------------------------
async function loginOnce() {
  const now = Date.now();
  if (cachedLogin && now < cachedLogin.expiry) return cachedLogin;

  console.log("🔑 Logging in to AngelOne…");

  const apiKey = process.env.ANGEL_API_KEY;
  const clientId = process.env.ANGEL_CLIENT_ID;
  const password = process.env.ANGEL_PASSWORD;
  const totpSecret = process.env.ANGEL_TOTP_SECRET;

  const payload = {
    clientcode: clientId,
    password: password,
    totp: generateTOTP(totpSecret),
  };

  const headers = {
    "X-PrivateKey": apiKey,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "192.168.1.1",
    "X-ClientPublicIP": "122.176.75.22",
    "X-MACAddress": "00:0a:95:9d:68:16",
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
    expiry: now + 11 * 60 * 60 * 1000, // 11h cache
  };

  console.log("✅ Logged in, feedToken cached until", new Date(cachedLogin.expiry).toISOString());
  return cachedLogin;
}

// -----------------------------
// Load ScripMaster → build maps
// -----------------------------
async function loadScripMaster() {
  if (Object.keys(tokenToSymbol).length > 0) return;

  // Try local first (same pathing style as your historical.js)
  const localPath = path.join(process.cwd(), "api", "angel", "OpenAPIScripMaster.json");
  let data = null;

  try {
    const raw = fs.readFileSync(localPath, "utf-8");
    data = JSON.parse(raw);
    console.log(`📥 Loaded ScripMaster locally: ${data.length} instruments`);
  } catch (e) {
    console.warn("⚠️ Local ScripMaster not found, fetching from Angel CDN…", e.message);
    const res = await axios.get(
      "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json",
      { httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
    );
    data = res.data;
    console.log(`📥 Loaded ScripMaster from CDN: ${data.length} instruments`);
  }

  // Build maps for NSE, EQ only; store clean symbol (strip '-EQ')
  tokenToSymbol = {};
  symbolToToken = {};

  for (const inst of data) {
    const exch = (inst.exch_seg || inst.exchSeg || "").toUpperCase();
    const instrumentType = (inst.instrumenttype || inst.instrumentType || "").toUpperCase();
    const token = String(inst.token);
    const rawSymbol = String(inst.symbol || inst.tradingsymbol || "").toUpperCase();

    if (exch !== "NSE") continue;             // focus NSE to match your app
    if (instrumentType && instrumentType !== "EQ") continue;
    if (!token || !rawSymbol) continue;

    const cleanSymbol = rawSymbol.replace(/-EQ$/, "");
    tokenToSymbol[token] = cleanSymbol;
    // only set the first mapping to avoid overwriting in rare dupes
    if (!symbolToToken[cleanSymbol]) symbolToToken[cleanSymbol] = token;
  }

  console.log(`✅ Built token maps: ${Object.keys(tokenToSymbol).length} tokens (NSE EQ)`);
}

// -----------------------------
// WebSocket start (only once)
// -----------------------------
function startSmartStream(clientCode, feedToken, apiKey, tokensToSubscribe) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("⚡ Reusing existing WebSocket (already open)");
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
        tokenList: [{ exchangeType: 1, tokens: tokensToSubscribe }], // NSE = 1
      },
    };

    try {
      ws.send(JSON.stringify(subscribeMessage));
      console.log("📡 Subscribed tokens:", tokensToSubscribe);
    } catch (e) {
      console.error("💥 Failed to send subscribe message:", e.message);
    }
  });

  ws.on("message", (msg) => {
    // NOTE: Keeping your original JSON parsing to avoid disturbing your stream.
    // Angel often sends binary, but if your infra sends JSON, this will work.
    try {
      const text = msg.toString();
      let data = null;

      try {
        data = JSON.parse(text);
      } catch (jerr) {
        // If not JSON, log a short preview once and skip
        console.warn("⚠️ Non-JSON tick received (preview):", text.slice(0, 80));
        return;
      }

      if (!data) return;

      // Angel WS events can be arrays or single objects depending on mode/provider
      const items = Array.isArray(data) ? data : [data];

      for (const it of items) {
        // Expect fields like { token, ltp, netChange, percentChange, exch }
        if (!it?.token || typeof it.ltp === "undefined") continue;

        const token = String(it.token);
        const symbol = tokenToSymbol[token] || token; // fallback to token if not mapped
        const exch = (it.exch || "NSE").toUpperCase();

        // Compute change/percent if missing
        const ltp = Number(it.ltp) || 0;
        let change = typeof it.netChange !== "undefined" ? Number(it.netChange) : 0;
        let percentChange =
          typeof it.percentChange !== "undefined" ? Number(it.percentChange) : 0;

        if ((percentChange === 0 || isNaN(percentChange)) && ltp && change) {
          const prev = ltp - change;
          if (prev) percentChange = (change / prev) * 100;
        }

        tickStore[symbol] = {
          symbol,
          ltp,
          change: isNaN(change) ? 0 : change,
          percentChange: isNaN(percentChange) ? 0 : percentChange,
          exch,
        };

        console.log(
          `📈 Tick ${symbol.padEnd(12)} LTP=${ltp} Δ=${change} (${percentChange.toFixed(2)}%)`
        );

        tickEmitter.emit("tick", tickStore[symbol]);
      }
    } catch (err) {
      console.error("💥 Parse tick error:", err);
    }
  });

  ws.on("close", async () => {
    console.log("❌ WebSocket closed, reconnecting in 5s…");
    setTimeout(async () => {
      try {
        const session = await loginOnce();
        // Reuse the last tokens we subscribed with (if any)
        const currentTokens = collectTop25Tokens(); // build again from maps
        startSmartStream(process.env.ANGEL_CLIENT_ID, session.feedToken, process.env.ANGEL_API_KEY, currentTokens);
      } catch (e) {
        console.error("💥 Reconnect failed:", e.message);
      }
    }, 5000);
  });

  ws.on("error", (err) => {
    console.error("💥 WebSocket error:", err?.message || err);
  });
}

// -----------------------------
// Build Top-25 token list (NSE)
// -----------------------------
function collectTop25Tokens() {
  const tokens = [];
  for (const sym of TOP25_NSE) {
    const t = symbolToToken[sym];
    if (t) tokens.push(t);
    else console.warn(`⚠️ No token found for ${sym} in ScripMaster`);
  }
  // Deduplicate just in case
  return Array.from(new Set(tokens));
}

// -----------------------------
// Lazy ensure stream is running
// -----------------------------
async function ensureStreamStarted() {
  await loadScripMaster();

  const apiKey = process.env.ANGEL_API_KEY;
  const clientId = process.env.ANGEL_CLIENT_ID;

  const tokensToSubscribe = collectTop25Tokens();
  if (tokensToSubscribe.length === 0) {
    throw new Error("No tokens resolved for Top 25 NSE — check ScripMaster mapping");
  }

  const session = await loginOnce();
  startSmartStream(clientId, session.feedToken, apiKey, tokensToSubscribe);
}

// -----------------------------
// Response helpers
// -----------------------------
function getTop25() {
  // Return only symbols we care about, ordered by |% change|
  return Object.values(tickStore)
    .filter((row) => TOP25_NSE.includes(row.symbol))
    .sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange))
    .slice(0, 25);
}
const getGainers = () =>
  Object.values(tickStore).filter((s) => s.percentChange > 0);
const getLosers = () =>
  Object.values(tickStore).filter((s) => s.percentChange < 0);
const getNeutrals = () =>
  Object.values(tickStore).filter((s) => Number(s.percentChange) === 0);

// -----------------------------
// API Handler (default export)
// -----------------------------
export default async function handler(req, res) {
  console.log("📩 /api/angel/live hit", req.method, req.url);

  try {
    // Auto-start stream on first hit (GET or POST)
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log("⏯️ Stream not active — starting (lazy) …");
      await ensureStreamStarted();
    }

    if (req.method === "GET") {
      const { type } = req.query;

      if (type === "top25") {
        const payload = getTop25();
        console.log(`🟢 GET top25 -> ${payload.length} items`);
        return res.status(200).json(payload);
      }
      if (type === "gainers") {
        const payload = getGainers();
        console.log(`🟢 GET gainers -> ${payload.length} items`);
        return res.status(200).json(payload);
      }
      if (type === "losers") {
        const payload = getLosers();
        console.log(`🟢 GET losers -> ${payload.length} items`);
        return res.status(200).json(payload);
      }
      if (type === "neutral") {
        const payload = getNeutrals();
        console.log(`🟢 GET neutral -> ${payload.length} items`);
        return res.status(200).json(payload);
      }

      // default: dump everything we have
      const all = Object.values(tickStore);
      console.log(`🟢 GET all -> ${all.length} items`);
      return res.status(200).json({ ticks: all });
    }

    if (req.method === "POST") {
      // Explicit start (kept for compatibility with your previous flow)
      await ensureStreamStarted();
      return res.status(200).json({
        message: "✅ Streaming active",
        subscribed: collectTop25Tokens().length,
      });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("💥 Live API error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}
