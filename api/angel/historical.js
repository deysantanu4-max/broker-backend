import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import axios from "axios";
import { SmartAPI } from "smartapi-javascript";
import { authenticator } from "otplib";

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Angel API credentials from Vercel env
const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const PASSWORD = process.env.ANGEL_PASSWORD;
const API_KEY = process.env.ANGEL_API_KEY;
const TOTP_SECRET = process.env.ANGEL_TOTP_SECRET;

let smart_api = new SmartAPI({ api_key: API_KEY });
let authToken = null;
let feedToken = null;
let lastLoginTime = null;

// Convert UTC → IST
function toIST(date) {
  return new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
}

// Login and save token
async function angelLogin() {
  const totp = authenticator.generate(TOTP_SECRET);
  console.log(`[LOGIN] Generated TOTP: ${totp}`);

  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);
  authToken = session.data.jwtToken;
  feedToken = session.data.feedToken;
  lastLoginTime = Date.now();

  console.log("[LOGIN] Successful, JWT token acquired");
}

// Ensure token is valid or re-login
async function ensureLogin() {
  const TOKEN_EXPIRY_MS = 23 * 60 * 60 * 1000; // Angel token ~24h
  if (!authToken || Date.now() - lastLoginTime > TOKEN_EXPIRY_MS) {
    console.log("[TOKEN] Refreshing login...");
    await angelLogin();
  }
}

// Fetch historical data
app.post("/api/angel/historical", async (req, res) => {
  try {
    await ensureLogin();

    const { symbol, exchange, interval, days } = req.body;
    if (!symbol || !exchange || !interval || !days) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Get scrip master to find token
    const scripRes = await axios.get(
      "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
    );
    const inst = scripRes.data.find(
      (i) =>
        i.tradingsymbol.toUpperCase() === symbol.toUpperCase() &&
        i.exchange.toUpperCase() === exchange.toUpperCase()
    );

    if (!inst) {
      return res.status(404).json({ error: "Instrument not found" });
    }

    const nowIST = toIST(new Date());
    const fromIST = toIST(new Date(Date.now() - days * 24 * 60 * 60 * 1000));

    const formatDate = (date) => {
      return date.toISOString().replace("T", " ").substring(0, 16);
    };

    const payload = {
      exchange: exchange.toUpperCase(),
      symboltoken: inst.token,
      interval: interval.toLowerCase(),
      fromdate: formatDate(fromIST),
      todate: formatDate(nowIST),
    };

    const histRes = await axios.post(
      "https://apiconnect.angelbroking.com/rest/secure/angelbroking/historical/v1/getCandleData",
      payload,
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          "X-PrivateKey": API_KEY,
          "X-SourceID": "WEB",
          "X-UserType": "USER",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }
    );

    res.json(histRes.data);
  } catch (err) {
    console.error("[ERROR]", err.response?.data || err.message);
    res.status(500).json({
      error: err.response?.data || "Internal Server Error",
    });
  }
});

export default app;
