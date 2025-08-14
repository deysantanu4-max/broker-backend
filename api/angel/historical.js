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

// ✅ Load env variables
const CLIENT_ID   = process.env.ANGEL_CLIENT_ID;
const PASSWORD    = process.env.ANGEL_PASSWORD;
const API_KEY     = process.env.ANGEL_API_KEY;
const TOTP_SECRET = process.env.ANGEL_TOTP_SECRET;
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

if (!CLIENT_ID || !PASSWORD || !API_KEY || !TOTP_SECRET) {
  console.error('❌ Missing required env vars: ANGEL_CLIENT_ID, ANGEL_PASSWORD, ANGEL_API_KEY, ANGEL_TOTP_SECRET');
}

let smart_api = new SmartAPI({ api_key: API_KEY });
let scripMasterCache = null;
let authToken = null;
let feedToken = null;

// 🔹 Login to Angel
async function angelLogin() {
  console.log('[login] 🔐 Generating TOTP & logging in to Angel...');
  const totp = otp.authenticator.generate(TOTP_SECRET);
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);

  authToken = session?.data?.jwtToken || null;
  feedToken = session?.data?.feedToken || null;

  if (!authToken || !feedToken) {
    throw new Error('Angel login returned empty tokens');
  }

  console.log('[login] ✅ Angel login successful');
}

// 🔹 Load scrip master
async function loadScripMaster() {
  if (scripMasterCache) {
    console.log(`[scrip] ♻️ Using cached scrip master (${scripMasterCache.length} instruments)`);
    return scripMasterCache;
  }
  console.log('[scrip] 📥 Fetching scrip master JSON from Angel public URL...');
  const res = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
  scripMasterCache = res.data;
  console.log(`[scrip] ✅ Loaded ${scripMasterCache.length} instruments`);
  return scripMasterCache;
}

// 🔹 POST /api/angel/historical
app.post('/api/angel/historical', async (req, res) => {
  console.log('[hist] 📩 Incoming request:', req.body);

  let { symbol, exchange, clientCode } = req.body || {};

  if (!symbol || !exchange || !clientCode) {
    console.warn('[hist] ⚠️ Missing required fields (symbol, exchange, clientCode)');
    return res.status(400).json({ error: 'Missing required fields (symbol, exchange, clientCode)' });
  }

  try {
    if (!authToken || !feedToken) {
      console.log('[hist] 🔑 No tokens in memory. Logging in...');
      await angelLogin();
    }

    const scripMaster = await loadScripMaster();

    symbol   = String(symbol).trim().toUpperCase();
    exchange = String(exchange).trim().toUpperCase();
    const symbolWithEq = symbol.endsWith('-EQ') ? symbol : `${symbol}-EQ`;

    console.log(`[hist] 🔍 Searching in scrip master: symbol=${symbolWithEq}, exchange=${exchange}`);

    const instrument = scripMaster.find(inst =>
      inst.symbol?.toUpperCase() === symbolWithEq &&
      inst.exch_seg?.toUpperCase() === exchange
    );

    if (!instrument) {
      const closeMatches = scripMaster
        .filter(inst => inst.exch_seg?.toUpperCase() === exchange && inst.symbol?.toUpperCase()?.includes(symbol))
        .slice(0, 10)
        .map(i => i.symbol);
      console.log(`[hist] ❌ Symbol '${symbolWithEq}' not found. Close matches:`, closeMatches);
      return res.status(404).json({ error: `Symbol '${symbolWithEq}' not found for exchange '${exchange}'` });
    }

    const symbolToken = String(instrument.token);
    console.log(`[hist] ✅ Found symbol token: ${symbolToken} for ${symbolWithEq}`);

    // Date range - last 30 days
    const now = new Date();
    const fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const pad = (n) => n.toString().padStart(2, '0');
    const formatDate = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

    console.log(`[hist] ⏳ Fetching candle data from ${formatDate(fromDate)} to ${formatDate(now)}...`);

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
          'X-ClientLocalIP': '127.0.0.1',
          'X-ClientPublicIP': '127.0.0.1',
          'X-MACAddress': '00:00:00:00:00:00',
          'Content-Type': 'application/json',
        }
      }
    );

    if (!candleRes?.data?.data) {
      return res.status(500).json({ error: 'No historical data found' });
    }

    console.log(`[hist] ✅ Successfully fetched candle data for ${symbolWithEq} (rows=${candleRes.data.data.length})`);

    // 🔹 Always call backend's own live route
    const streamUrl = `${BACKEND_BASE_URL}/api/angel/live/stream`;
    console.log('[hist] 📡 Starting live stream via backend:', { streamUrl, clientCode, token: symbolToken });

    const startRes = await axios.post(
      streamUrl,
      { clientCode, feedToken, tokens: [symbolToken], exchange },
      { headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' } }
    );

    if (startRes.status >= 400) {
      console.error('[hist] ⚠️ Live stream start failed', startRes.data);
    } else {
      console.log('[hist] 📡 Live stream started OK');
    }

    return res.json({
      status: 'success',
      meta: { feedToken, symbolToken, exchange, symbol: symbolWithEq, clientCode },
      data: candleRes.data.data
    });

  } catch (err) {
    console.error('[hist] ❌ Error:', err?.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to fetch data' });
  }
});

export default app;
