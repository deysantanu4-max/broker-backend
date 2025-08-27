// /api/angel/live.js
import axios from "axios";
import crypto from "crypto";
import https from "https";

// Cache login state for 10–15 min
let cachedLogin = null;

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

async function loginOnce() {
  const now = Date.now();
  if (cachedLogin && now < cachedLogin.expiry) return cachedLogin;

  console.log("🔑 Logging in to AngelOne...");
  const apiKey = process.env.ANGEL_API_KEY;
  const clientId = process.env.ANGEL_CLIENT_ID;
  const password = process.env.ANGEL_PASSWORD;
  const totpSecret = process.env.ANGEL_TOTP_SECRET;

  const payload = { clientcode: clientId, password, totp: generateTOTP(totpSecret) };

  const headers = {
    "X-PrivateKey": apiKey,
    "Content-Type": "application/json",
    "Accept": "application/json",
    "X-UserType": "USER",
    "X-SourceID": "WEB"
  };

  const loginResp = await axios.post(
    "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword",
    payload,
    { headers, httpsAgent: new https.Agent({ rejectUnauthorized: false }) }
  );

  if (!loginResp.data?.data?.feedToken) throw new Error("Login failed");

  cachedLogin = {
    feedToken: loginResp.data.data.feedToken,
    jwtToken: loginResp.data.data.jwtToken,
    expiry: now + 10 * 60 * 1000 // cache 10 min
  };

  return cachedLogin;
}

// Fetch top 25 stocks + OHLC from Angel REST API
async function fetchTop25Stocks() {
  const session = await loginOnce();
  const apiKey = process.env.ANGEL_API_KEY;
  const jwtToken = session.jwtToken;

  // You can set NSE/BSE tokens as needed
  const tokens = process.env.TOP25_TOKENS?.split(",") || ["26009"]; 

  const payload = {
    mode: "LTP",
    exchangeTokens: { NSE: tokens.map(t => parseInt(t)) }
  };

  const headers = {
    Authorization: `Bearer ${jwtToken}`,
    "X-PrivateKey": apiKey,
    "Content-Type": "application/json"
  };

  const resp = await axios.post(
    "https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote",
    payload,
    { headers }
  );

  const data = resp.data?.data?.fetched || [];
  return data.map(item => ({
    token: item?.token?.toString(),
    symbol: item?.symbol,
    ltp: item?.ltp,
    open: item?.open,
    high: item?.high,
    low: item?.low,
    close: item?.close,
    prevClose: item?.prevClose,
    change: item?.netChange,
    percentChange: item?.percentChange
  }));
}

// Fetch indices (Nifty, BankNifty, Sensex)
async function fetchIndices() {
  const session = await loginOnce();
  const apiKey = process.env.ANGEL_API_KEY;
  const jwtToken = session.jwtToken;

  const indices = [
    { name: "NIFTY 50", token: 26000, exch: "NSE" },
    { name: "BANKNIFTY", token: 26009, exch: "NSE" },
    { name: "SENSEX", token: 99919000, exch: "BSE" }
  ];

  const result = [];

  for (const idx of indices) {
    try {
      const payload = {
        mode: "OHLC",
        exchangeTokens: { [idx.exch]: [idx.token] }
      };
      const headers = {
        Authorization: `Bearer ${jwtToken}`,
        "X-PrivateKey": apiKey,
        "Content-Type": "application/json"
      };
      const resp = await axios.post(
        "https://apiconnect.angelbroking.com/rest/secure/angelbroking/market/v1/quote",
        payload,
        { headers }
      );
      const fetched = resp.data?.data?.fetched?.[0];
      if (fetched) {
        result.push({
          name: idx.name,
          token: idx.token,
          ltp: fetched.ltp,
          close: fetched.close,
          prevClose: fetched.prevClose,
          change: fetched.netChange,
          percentChange: fetched.percentChange
        });
      }
    } catch (err) {
      console.error("Index fetch failed:", idx.name, err.message);
    }
  }

  return result;
}

// API Handler
export default async function handler(req, res) {
  console.log("📩 /api/angel/live hit");

  try {
    if (req.method === "GET") {
      const top25 = await fetchTop25Stocks();
      const indices = await fetchIndices();

      return res.status(200).json({
        top25,
        indices
      });
    }

    return res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    console.error("💥 Live API error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
