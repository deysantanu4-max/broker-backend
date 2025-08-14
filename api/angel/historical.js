// api/angel/historical.js

import express from 'express';
import { SmartAPI } from 'smartapi-javascript';
import axios from 'axios';
import dotenv from 'dotenv';
import otp from 'otplib';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const PASSWORD = process.env.ANGEL_PASSWORD;
const API_KEY = process.env.ANGEL_API_KEY;
const TOTP_SECRET = process.env.ANGEL_TOTP_SECRET;

if (!CLIENT_ID || !PASSWORD || !API_KEY || !TOTP_SECRET) {
  console.error('❌ Missing required env vars: ANGEL_CLIENT_ID, ANGEL_PASSWORD, ANGEL_API_KEY, ANGEL_TOTP_SECRET');
}

let smart_api = new SmartAPI({ api_key: API_KEY });
let scripMasterCache = null;
let authToken = null;
let feedToken = null;

async function loadScripMaster() {
  if (scripMasterCache) return scripMasterCache;
  console.log('📥 Fetching scrip master JSON...');
  const res = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
  scripMasterCache = res.data;
  console.log(`✅ Loaded ${scripMasterCache.length} instruments`);
  return scripMasterCache;
}

async function angelLogin() {
  const totp = otp.authenticator.generate(TOTP_SECRET);
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);
  authToken = session.data.jwtToken;
  feedToken = session.data.feedToken;
  console.log('✅ Angel login successful');
}

app.post('/api/angel/historical', async (req, res) => {
  console.log("📩 Incoming request:", req.body);

  let { symbol, exchange, clientCode } = req.body;
  if (!symbol || !exchange || !clientCode) {
    return res.status(400).json({ error: 'Missing required fields (symbol, exchange, clientCode)' });
  }

  try {
    if (!feedToken) {
      await angelLogin();
    }

    const scripMaster = await loadScripMaster();

    symbol = symbol.toUpperCase();
    exchange = exchange.toUpperCase();
    const symbolWithEq = symbol.endsWith('-EQ') ? symbol : `${symbol}-EQ`;

    const instrument = scripMaster.find(inst =>
      inst.symbol.toUpperCase() === symbolWithEq && inst.exch_seg.toUpperCase() === exchange
    );

    if (!instrument) {
      const closeMatches = scripMaster.filter(inst =>
        inst.symbol.toUpperCase().includes(symbol) && inst.exch_seg.toUpperCase() === exchange
      );
      console.log(`❌ Symbol not found. Matches:`, closeMatches.slice(0, 5).map(i => i.symbol));
      return res.status(404).json({ error: `Symbol '${symbolWithEq}' not found` });
    }

    const symbolToken = instrument.token;
    console.log(`✅ Found token: ${symbolToken}`);

    // Historical data fetch
    const now = new Date();
    const fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const pad = (n) => n.toString().padStart(2, '0');
    const formatDate = (date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    const candleRes = await axios.post(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData',
      {
        exchange,
        symboltoken: symbolToken,
        interval: 'ONE_MINUTE',
        fromdate: formatDate(fromDate),
        todate: formatDate(now),
      },
      {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-PrivateKey': API_KEY,
          'X-UserType': 'USER',
          'X-SourceID': 'WEB',
          'Content-Type': 'application/json',
        },
      }
    );

    if (!candleRes.data || !candleRes.data.data) {
      return res.status(500).json({ error: 'No historical data found' });
    }

    console.log(`✅ Historical data fetched for ${symbolWithEq}`);

    // 🔹 Auto-start Live Stream
    try {
      await axios.post(`${process.env.BACKEND_BASE_URL}/api/angel/live/stream`, {
        clientCode,
        feedToken,
        tokens: [symbolToken]
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
      console.log(`📡 Live stream started for ${symbolWithEq}`);
    } catch (streamErr) {
      console.error(`⚠️ Failed to start live stream:`, streamErr.message);
    }

    // Final Response
    res.json({
      status: "success",
      meta: {
        feedToken,
        symbolToken,
        exchange,
        symbol: symbolWithEq
      },
      data: candleRes.data.data
    });

  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

export default app;
