// /api/angel/live.js
import axios from "axios";
import crypto from "crypto";
import https from "https";
import WebSocket from "ws";
import EventEmitter from "events"; // ✅ needed for broadcasting ticks

// =========================
// Tick storage + event bus
// =========================
const tickStore = {}; // { symbol: { ltp, change, percentChange, exch } }
const tickEmitter = new EventEmitter();

// =========================
// Base32 decode for TOTP
// =========================
function base32ToBuffer(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  let buffer = [];

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

// =========================
// Generate TOTP
// =========================
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
// Start SmartAPI Streaming
// =========================
function startSmartStream(clientCode, feedToken, apiKey, tokensToSubscribe) {
  const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${clientCode}&feedToken=${feedToken}&apiKey=${apiKey}`;
  const ws = new WebSocket(wsUrl);

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
    console.log("📡 Subscription sent:", subscribeMessage);
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data?.ltp && data?.token) {
        // Store/update tick
        tickStore[data.token] = {
          symbol: data.token, // TODO: map token → symbol if you have master file
          ltp: data.ltp,
          change: data.netChange ?? 0,
          percentChange: data.percentChange ?? 0,
          exch: data.exch || "NSE"
        };
        tickEmitter.emit("tick", tickStore[data.token]);
      }
      console.log("📨 Tick stored:", data);
    } catch (err) {
      console.error("💥 Failed to parse tick:", err);
    }
  });

  ws.on("close", () => {
    console.log("❌ WebSocket closed, reconnecting in 5s...");
    setTimeout(() => startSmartStream(clientCode, feedToken, apiKey, tokensToSubscribe), 5000);
  });

  ws.on("error", (err) => {
    console.error("💥 WebSocket error:", err);
  });
}

// =========================
// Helper: compute rankings
// =========================
function getTop25() {
  return Object.values(tickStore)
    .sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange))
    .slice(0, 25);
}
function getGainers() {
  return Object.values(tickStore).filter((s) => s.percentChange > 0);
}
function getLosers() {
  return Object.values(tickStore).filter((s) => s.percentChange < 0);
}
function getNeutrals() {
  return Object.values(tickStore).filter((s) => s.percentChange === 0);
}

// =========================
// API Handler
// =========================
export default async function handler(req, res) {
  console.log("📩 /api/angel/live hit");

  // Extra query support
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

  const apiKey = process.env.ANGEL_API_KEY;
  const clientId = process.env.ANGEL_CLIENT_ID;
  const password = process.env.ANGEL_PASSWORD;
  const totpSecret = process.env.ANGEL_TOTP_SECRET;

  if (!apiKey || !clientId || !password || !totpSecret) {
    console.error("❌ Missing env variables");
    return res.status(500).json({ error: "Missing credentials in env" });
  }

  try {
    console.log("🔑 Logging in to AngelOne...");

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
      "X-ClientLocalIP": "192.168.1.1",
      "X-ClientPublicIP": "122.176.75.22",
      "X-MACAddress": "00:0a:95:9d:68:16"
    };

    const loginResp = await axios.post(
      "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword",
      payload,
      {
        headers,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      }
    );

    console.log("📡 Login HTTP status:", loginResp.status);
    console.log("📡 Login data:", loginResp.data);

    if (!loginResp.data?.data?.feedToken) {
      console.error("❌ Login failed, missing feedToken");
      return res.status(500).json({ error: "Login failed", details: loginResp.data });
    }

    const feedToken = loginResp.data.data.feedToken;

// =========================
// Start Streaming
// =========================
    // Start streaming for tokens (example: NIFTY 50)
    const tokensToSubscribe = ["26009"]; // Replace with your tokens
    startSmartStream(clientId, feedToken, apiKey, tokensToSubscribe);

    return res.status(200).json({
      message: "✅ Login successful, streaming started on server",
      clientCode: clientId,
      feedToken: feedToken,
      apiKey: apiKey
    });
  } catch (err) {
    if (err.response) {
      console.error("💥 Live API error:", err.response.status, err.response.data);
      return res.status(500).json({
        error: "Login request failed",
        status: err.response.status,
        details: err.response.data
      });
    }
    console.error("💥 Live API error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}