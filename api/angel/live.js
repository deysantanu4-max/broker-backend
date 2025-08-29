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
// TOP25 lists (NSE & BSE)
// -----------------------------
const TOP25_NSE = [
  "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK",
  "SBIN", "HINDUNILVR", "KOTAKBANK", "LT", "BHARTIARTL",
  "AXISBANK", "BAJFINANCE", "ITC", "WIPRO", "ASIANPAINT",
  "ULTRACEMCO", "MARUTI", "SUNPHARMA", "HCLTECH", "POWERGRID",
  "TITAN", "NTPC", "ONGC", "JSWSTEEL", "ADANIPORTS"
];

const TOP25_BSE = [
  "RELIANCE", "HDFCBANK", "INFY", "ICICIBANK", "SBIN",
  "TCS", "KOTAKBANK", "HINDUNILVR", "BHARTIARTL", "BAJFINANCE",
  "ITC", "AXISBANK", "LT", "WIPRO", "ASIANPAINT",
  "ULTRACEMCO", "MARUTI", "SUNPHARMA", "HCLTECH", "POWERGRID",
  "TITAN", "NTPC", "ONGC", "JSWSTEEL", "ADANIPORTS"
];

// -----------------------------
// Base32 decode + TOTP
// (unchanged from your existing implementation)
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
// Login & cache session (aligned headers with your historical.js style)
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
    totp: generateTOTP(totpSecret)
  };

  const headers = {
    "X-PrivateKey": apiKey,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB",
    "X-ClientLocalIP": "127.0.0.1",
    "X-ClientPublicIP": "127.0.0.1",
    "X-MACAddress": "00:00:00:00:00:00"
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

// -----------------------------
// Load ScripMaster → build maps
// - tries local path used in historical.js then falls back to CDN
// -----------------------------
async function loadScripMaster() {
  if (Object.keys(tokenToSymbol).length > 0) return;

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

  tokenToSymbol = {};
  symbolToToken = {};

  for (const inst of data) {
    const exch = (inst.exch_seg || inst.exchSeg || "").toUpperCase();
    const instType = (inst.instrumenttype || inst.instrumentType || "").toUpperCase();
    const token = inst.token ? String(inst.token) : null;
    const rawSymbol = (inst.symbol || inst.tradingsymbol || "").toUpperCase();

    if (!token || !rawSymbol) continue;
    if (!(exch === "NSE" || exch === "BSE")) continue; // only NSE/BSE
    if (instType && instType !== "EQ") continue; // equities only

    const cleanSymbol = rawSymbol.replace(/-EQ$/, "");
    tokenToSymbol[token] = { symbol: cleanSymbol, exch };
    // only set first token for a symbol (avoid overwriting)
    const key = `${exch}:${cleanSymbol}`;
    if (!symbolToToken[key]) symbolToToken[key] = token;
  }

  console.log(`✅ Built token maps: ${Object.keys(tokenToSymbol).length} tokens (NSE+BSE EQ)`);
}

// -----------------------------
// Binary decoder fallback (best-effort)
// - Angel often sends binary packets; this is a simple, safe attempt to read token+ltp.
// - It's conservative: if decoding fails, we log preview and skip.
// -----------------------------
function tryDecodeBinaryTick(buffer) {
  try {
    // Attempt to read token (32-bit BE) at byte index 1 and price at index 5 (32-bit BE)
    // This matches a common Angel LTP binary layout (not guaranteed for every vendor).
    if (!Buffer.isBuffer(buffer) || buffer.length < 9) return null;
    const exchSeg = buffer.readInt8(0); // may be present
    const token = String(buffer.readInt32BE(1));
    // Price often sent as integer with 2 decimals: divide by 100 (best-effort)
    const rawPrice = buffer.readInt32BE(5);
    const ltp = rawPrice / 100.0;
    return { token, ltp };
  } catch (err) {
    return null;
  }
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
        tokenList: [{ exchangeType: 1, tokens: tokensToSubscribe }] // NSE = 1
      }
    };

    try {
      ws.send(JSON.stringify(subscribeMessage));
      console.log("📡 Subscribed tokens:", tokensToSubscribe.slice(0, 30), " (showing up to 30)");
    } catch (e) {
      console.error("💥 Failed to send subscribe message:", e.message);
    }
  });

  // track first few raw non-JSON previews so logs aren't flooded
  let nonJsonPreviewCount = 0;

  ws.on("message", (msg) => {
    try {
      // Try JSON first (this preserves your existing streaming path for indices if they send JSON)
      let parsed = null;
      const txt = msg.toString?.() ?? "";

      try {
        parsed = JSON.parse(txt);
      } catch (jerr) {
        parsed = null;
      }

      if (parsed) {
        // parsed might be array or single object
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const it of items) {
          // If object contains token & ltp - treat as tick
          if (it?.token && typeof it.ltp !== "undefined") {
            const token = String(it.token);
            const mapping = tokenToSymbol[token];
            const symbol = mapping ? mapping.symbol : token;
            const exch = mapping ? mapping.exch : (it.exch || "NSE").toUpperCase();

            const ltp = Number(it.ltp) || 0;
            let change = typeof it.netChange !== "undefined" ? Number(it.netChange) : (typeof it.change !== "undefined" ? Number(it.change) : 0);
            let percentChange = typeof it.percentChange !== "undefined" ? Number(it.percentChange) : 0;

            if ((percentChange === 0 || isNaN(percentChange)) && ltp && change) {
              const prev = ltp - change;
              if (prev) percentChange = (change / prev) * 100;
            }

            tickStore[symbol] = {
              symbol,
              ltp,
              change: isNaN(change) ? 0 : change,
              percentChange: isNaN(percentChange) ? 0 : percentChange,
              exch
            };

            console.log(`📈 JSON Tick ${symbol.padEnd(12)} LTP=${ltp} Δ=${change} (${percentChange.toFixed(2)}%)`);
            tickEmitter.emit("tick", tickStore[symbol]);
            continue;
          }

          // Some messages may be index updates or control messages — log lightly
          if (it?.type || it?.event || it?.message) {
            console.log("📩 WS message (info):", (it.type || it.event || it.message));
          }
        }
        return;
      }

      // If not JSON, attempt a binary decode
      const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      const decoded = tryDecodeBinaryTick(buf);

      if (decoded && decoded.token) {
        const token = decoded.token;
        const mapping = tokenToSymbol[token];
        const symbol = mapping ? mapping.symbol : token;
        const exch = mapping ? mapping.exch : "NSE";
        const ltp = Number(decoded.ltp) || 0;

        // We don't have netChange/percentChange from this minimal decode -> set 0
        tickStore[symbol] = {
          symbol,
          ltp,
          change: 0,
          percentChange: 0,
          exch
        };

        console.log(`📈 Binary Tick ${symbol.padEnd(12)} LTP=${ltp} (token=${token})`);
        tickEmitter.emit("tick", tickStore[symbol]);
        return;
      }

      // Non-JSON, non-decodable: preview once to help debugging
      if (nonJsonPreviewCount < 3) {
        nonJsonPreviewCount++;
        const preview = buf?.slice ? buf.slice(0, 120).toString("hex") : String(msg).slice(0, 120);
        console.warn("⚠️ Received non-JSON/non-decodable WS message preview (hex):", preview);
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
        // reuse last subscriptions (we can collect tokens from TOP25 lists)
        const tokens = collectTop25Tokens(); // uses symbolToToken map
        startSmartStream(process.env.ANGEL_CLIENT_ID, session.feedToken, process.env.ANGEL_API_KEY, tokens);
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
// Build token list for TOP25 per exchange
// -----------------------------
function collectTop25Tokens(exchange = "NSE") {
  const symbols = (exchange === "BSE") ? TOP25_BSE : TOP25_NSE;
  const tokens = [];
  for (const sym of symbols) {
    const key = `${exchange}:${sym}`;
    const t = symbolToToken[key] || symbolToToken[`${exchange.toUpperCase()}:${sym}`] || symbolToToken[`NSE:${sym}`];
    if (t) tokens.push(t);
    else console.warn(`⚠️ No token found for ${sym} on ${exchange}`);
  }
  return Array.from(new Set(tokens));
}

// -----------------------------
// Lazy ensure stream is running
// -----------------------------
async function ensureStreamStarted(exchange = "NSE") {
  await loadScripMaster();
  const apiKey = process.env.ANGEL_API_KEY;
  const clientId = process.env.ANGEL_CLIENT_ID;

  const tokensToSubscribe = collectTop25Tokens(exchange);
  if (tokensToSubscribe.length === 0) {
    throw new Error(`No tokens resolved for Top 25 ${exchange} — check ScripMaster mapping`);
  }

  const session = await loginOnce();
  startSmartStream(clientId, session.feedToken, apiKey, tokensToSubscribe);
}

// -----------------------------
// Response helpers
// -----------------------------
function getTop25(exchange = "NSE") {
  const list = (exchange === "BSE") ? TOP25_BSE : TOP25_NSE;
  return Object.values(tickStore)
    .filter((row) => list.includes(row.symbol))
    .sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange))
    .slice(0, 25);
}
const getGainers = () => Object.values(tickStore).filter((s) => s.percentChange > 0);
const getLosers = () => Object.values(tickStore).filter((s) => s.percentChange < 0);
const getNeutrals = () => Object.values(tickStore).filter((s) => Number(s.percentChange) === 0);

// -----------------------------
// API Handler (default export)
// -----------------------------
export default async function handler(req, res) {
  console.log("📩 /api/angel/live hit", req.method, req.url);

  try {
    const exchangeParam = (req.query.exchange || "NSE").toUpperCase();

    // Auto-start stream on first hit (GET or POST) for requested exchange
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log("⏯️ Stream not active — starting (lazy) for", exchangeParam);
      await ensureStreamStarted(exchangeParam);
    }

    if (req.method === "GET") {
      const { type } = req.query;

      if (type === "top25") {
        const payload = getTop25(exchangeParam);
        console.log(`🟢 GET top25 (${exchangeParam}) -> ${payload.length} items`);
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
      // explicit start — accepts optional exchange query param
      const exchangeQuery = (req.query.exchange || "NSE").toUpperCase();
      await ensureStreamStarted(exchangeQuery);
      return res.status(200).json({
        message: `✅ Streaming active for ${exchangeQuery}`,
        subscribed: collectTop25Tokens(exchangeQuery).length,
      });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("💥 Live API error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}
