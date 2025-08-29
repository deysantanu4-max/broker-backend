// /api/angel/live.js
import axios from "axios";
import crypto from "crypto";
import https from "https";
import WebSocket from "ws";
import EventEmitter from "events";
import fs from "fs";
import path from "path";

// -----------------------------
// In-memory stores & state
// -----------------------------
const tickStore = {}; // { "RELIANCE": { symbol, ltp, change, percentChange, exch } }
const tickEmitter = new EventEmitter();
let ws = null;
let cachedLogin = null; // { feedToken, jwtToken, expiry }

// Keep raw scrip master array for fuzzy lookups
let scripMaster = null;

// Scrip master mappings (fast lookup)
let tokenToSymbol = {}; // { "26009": { symbol: "RELIANCE", exch: "NSE" } }
let symbolToToken = {}; // { "NSE:RELIANCE": "26009", ... }

// Last subscription payload (grouped)
let lastTokenListGroups = [];

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
// Exchange type constants
// -----------------------------
const EXCH_TYPE = { INDICES: 1, NSE_EQ: 2, BSE_EQ: 3 };
const exchToEquityType = { NSE: EXCH_TYPE.NSE_EQ, BSE: EXCH_TYPE.BSE_EQ };

// -----------------------------
// Base32 decode + TOTP (unchanged)
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
// Load ScripMaster → build maps + keep raw array
// -----------------------------
async function loadScripMaster() {
  if (scripMaster && Object.keys(tokenToSymbol).length > 0) return;

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

  scripMaster = data;
  tokenToSymbol = {};
  symbolToToken = {};

  for (const inst of data) {
    const exch = (inst.exch_seg || inst.exchSeg || "").toUpperCase();
    const instType = (inst.instrumenttype || inst.instrumentType || "").toUpperCase();
    const token = inst.token ? String(inst.token) : null;
    const rawSymbol = (inst.symbol || inst.tradingsymbol || "").toUpperCase();
    const name = (inst.name || "").toUpperCase();

    if (!token || !rawSymbol) continue;
    if (!(exch === "NSE" || exch === "BSE")) continue; // only NSE/BSE
    if (instType && instType !== "EQ") continue; // equities only

    const cleanSymbol = rawSymbol.replace(/-EQ$/, "");
    tokenToSymbol[token] = { symbol: cleanSymbol, exch };
    const key = `${exch}:${cleanSymbol}`;
    if (!symbolToToken[key]) symbolToToken[key] = token;

    // also save alternate key with -EQ (some callers use that)
    const altKey = `${exch}:${rawSymbol}`;
    if (!symbolToToken[altKey]) symbolToToken[altKey] = token;

    // store name based mapping (first occurrence)
    const nameKey = `${exch}:NAME:${name}`;
    if (!symbolToToken[nameKey]) symbolToToken[nameKey] = token;
  }

  console.log(`✅ Built token maps: ${Object.keys(tokenToSymbol).length} tokens (NSE+BSE EQ)`);
}

// -----------------------------
// Robust resolver for a single symbol -> token (fuzzy, mirrors historical.js logic)
// Returns token string or null
// -----------------------------
function resolveTokenForSymbol(exchange, symbol) {
  if (!scripMaster || scripMaster.length === 0) {
    console.warn("⚠️ ScripMaster not loaded yet in resolveTokenForSymbol");
    return null;
  }
  const exch = exchange.toUpperCase();
  const sym = symbol.toUpperCase();

  // 1) direct key
  const directKeys = [
    `${exch}:${sym}`,
    `${exch}:${sym}-EQ`,
    `${exch}:${sym.replace(/\s+/g, "")}`, // no spaces
    `${exch}:${sym.replace(/\./g, "")}`
  ];
  for (const k of directKeys) {
    if (symbolToToken[k]) {
      console.log(`🔍 Resolved ${symbol} via direct key ${k} -> ${symbolToToken[k]}`);
      return symbolToToken[k];
    }
  }

  // 2) search by exact symbol/trading symbol entries in scripMaster
  const exact = scripMaster.find(inst => {
    const instExch = (inst.exch_seg || inst.exchSeg || "").toUpperCase();
    if (instExch !== exch) return false;
    const s = (inst.symbol || inst.tradingsymbol || "").toUpperCase();
    if (!s) return false;
    return s === sym || s === `${sym}-EQ`;
  });
  if (exact && exact.token) {
    console.log(`🔍 Resolved ${symbol} by exact tradingsymbol -> ${exact.token}`);
    return String(exact.token);
  }

  // 3) fallback: find first where name includes symbol (useful for different naming)
  const byName = scripMaster.find(inst => {
    const instExch = (inst.exch_seg || inst.exchSeg || "").toUpperCase();
    if (instExch !== exch) return false;
    const name = (inst.name || "").toUpperCase();
    if (!name) return false;
    return name.includes(sym);
  });
  if (byName && byName.token) {
    console.log(`🔍 Resolved ${symbol} by name match (${byName.name || byName.symbol}) -> ${byName.token}`);
    return String(byName.token);
  }

  // 4) more aggressive: symbol is substring of trading symbol
  const substr = scripMaster.find(inst => {
    const instExch = (inst.exch_seg || inst.exchSeg || "").toUpperCase();
    if (instExch !== exch) return false;
    const s = (inst.symbol || inst.tradingsymbol || "").toUpperCase();
    if (!s) return false;
    return s.includes(sym) || sym.includes(s);
  });
  if (substr && substr.token) {
    console.log(`🔍 Resolved ${symbol} by substring match (${substr.symbol}) -> ${substr.token}`);
    return String(substr.token);
  }

  console.warn(`❌ Could not resolve token for ${exch}:${symbol}`);
  return null;
}

// -----------------------------
// Binary decoder fallback (best-effort)
// -----------------------------
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

// -----------------------------
// Helpers: chunk array
// -----------------------------
function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// -----------------------------
// Build grouped tokenList for subscribe (grouped by exchangeType), with batching
// Uses resolveTokenForSymbol to handle fuzzy mapping
// -----------------------------
function buildGroupedTokenListForExchange(exchange = "NSE") {
  const symbols = exchange === "BSE" ? TOP25_BSE : TOP25_NSE;
  const groups = {}; // exchangeType -> Set(tokens)
  const missing = [];

  for (const sym of symbols) {
    const key = `${exchange}:${sym}`;
    let token = symbolToToken[key];

    if (!token) {
      // attempt to resolve fuzzily
      token = resolveTokenForSymbol(exchange, sym);
    }

    if (!token) {
      missing.push({ symbol: sym, key });
      continue;
    }

    const exchangeType = exchToEquityType[exchange] || EXCH_TYPE.NSE_EQ;
    if (!groups[exchangeType]) groups[exchangeType] = new Set();
    groups[exchangeType].add(token);
  }

  if (missing.length) {
    console.warn("⚠️ Missing token mappings for Top25 (will attempt further lookups):", JSON.stringify(missing, null, 2));
  }

  // Convert sets to array of { exchangeType, tokens: [...] }
  const grouped = Object.entries(groups).map(([exType, set]) => ({
    exchangeType: Number(exType),
    tokens: Array.from(set)
  }));

  console.log(`🔎 Built grouped token list for ${exchange}: ${grouped.map(g => ({ exchangeType: g.exchangeType, tokenCount: g.tokens.length }))}`);
  return grouped;
}

// -----------------------------
// Build subscription batches for WS (chunk each group's tokens)
// -----------------------------
function buildSubscriptionBatches(groupedList, batchSize = 500) {
  const batches = [];
  for (const grp of groupedList) {
    const chunks = chunkArray(grp.tokens, batchSize);
    for (const chunk of chunks) {
      // tokenList is an array that may have multiple grouped entries; we send one grouped entry per batch here
      batches.push([{ exchangeType: grp.exchangeType, tokens: chunk }]);
    }
  }
  return batches;
}

// -----------------------------
// WebSocket start (only once)
// Accepts tokenListGroups (array of grouped entries), will send batched subscribes
// -----------------------------
function startSmartStream(clientCode, feedToken, apiKey, groupedTokenList) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("⚡ Reusing existing WebSocket (already open)");
    return;
  }

  lastTokenListGroups = groupedTokenList || lastTokenListGroups || [];

  const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${clientCode}&feedToken=${feedToken}&apiKey=${apiKey}`;
  ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    console.log("✅ Connected to SmartAPI stream");

    const batches = buildSubscriptionBatches(lastTokenListGroups, 500);
    if (batches.length === 0) {
      console.warn("⚠️ No token groups to subscribe.");
      return;
    }

    // Diagnostic: log first batch (short sample) for verification
    try {
      console.log("📡 About to subscribe batches. sample first batch:", JSON.stringify(batches[0][0].tokens.slice(0, 20)));
    } catch (e) { /* ignore */ }

    batches.forEach((tokenListArray, idx) => {
      const subscribeMessage = {
        action: 1,
        params: {
          mode: 1,
          tokenList: tokenListArray
        }
      };
      try {
        ws.send(JSON.stringify(subscribeMessage));
        console.log(`📡 Subscribed batch ${idx + 1}/${batches.length}: exchangeType=${tokenListArray[0].exchangeType} tokens=${tokenListArray[0].tokens.length}`);
      } catch (e) {
        console.error("💥 Failed to send subscribe message:", e.message);
      }
    });
  });

  let nonJsonPreviewCount = 0;

  ws.on("message", (msg) => {
    try {
      let parsed = null;
      const txt = typeof msg.toString === "function" ? msg.toString() : "";

      try { parsed = JSON.parse(txt); } catch (e) { parsed = null; }

      if (parsed) {
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const it of items) {
          if (it?.token && typeof it.ltp !== "undefined") {
            const token = String(it.token);
            const mapping = tokenToSymbol[token];
            const symbol = mapping ? mapping.symbol : token;
            const exch = mapping ? mapping.exch : (it.exch || "NSE").toUpperCase();

            const ltp = Number(it.ltp) || 0;
            let change = typeof it.netChange !== "undefined"
              ? Number(it.netChange)
              : (typeof it.change !== "undefined" ? Number(it.change) : 0);
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

          // Light logging for control messages/index updates
          if (it?.type || it?.event || it?.message) {
            console.log("📩 WS info:", it.type || it.event || it.message);
          }
        }
        return;
      }

      // Not JSON -> try binary decode
      const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);
      const decoded = tryDecodeBinaryTick(buf);
      if (decoded && decoded.token) {
        const token = decoded.token;
        const mapping = tokenToSymbol[token];
        const symbol = mapping ? mapping.symbol : token;
        const exch = mapping ? mapping.exch : "NSE";
        const ltp = Number(decoded.ltp) || 0;

        // netChange/percent not available via minimal decode
        tickStore[symbol] = { symbol, ltp, change: 0, percentChange: 0, exch };

        console.log(`📈 Binary Tick ${symbol.padEnd(12)} LTP=${ltp} (token=${token})`);
        tickEmitter.emit("tick", tickStore[symbol]);
        return;
      }

      if (nonJsonPreviewCount < 3) {
        nonJsonPreviewCount++;
        const preview = buf.slice ? buf.slice(0, 120).toString("hex") : String(msg).slice(0, 120);
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
        const groups = lastTokenListGroups.length ? lastTokenListGroups : buildGroupedTokenListForExchange("NSE");
        startSmartStream(process.env.ANGEL_CLIENT_ID, session.feedToken, process.env.ANGEL_API_KEY, groups);
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
// Lazy ensure stream is running for requested exchange
// -----------------------------
async function ensureStreamStarted(exchange = "NSE") {
  await loadScripMaster();
  const clientId = process.env.ANGEL_CLIENT_ID;

  const grouped = buildGroupedTokenListForExchange(exchange);
  if (!grouped || grouped.length === 0) {
    throw new Error(`No tokens resolved for Top 25 ${exchange} — check ScripMaster mapping`);
  }

  const session = await loginOnce();
  lastTokenListGroups = grouped;
  startSmartStream(clientId, session.feedToken, process.env.ANGEL_API_KEY, grouped);
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
        subscribedGroups: lastTokenListGroups
      });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("💥 Live API error:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Unknown error" });
  }
}
