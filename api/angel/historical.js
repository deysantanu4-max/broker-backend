// api/angel/historical.js

import express from 'express';
import { SmartAPI } from 'smartapi-javascript';
import axios from 'axios';
import dotenv from 'dotenv';
import otp from 'otplib';
import cors from 'cors';
import https from 'https';
import fs from 'fs';
import path from 'path';

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

let scripMasterCache = null;
let authToken = null;
let feedToken = null;

// ✅ Load scrip master from local file
async function loadScripMaster() {
  if (scripMasterCache) return scripMasterCache;

  console.log('📥 Loading local scrip master JSON...');
  const scripMasterPath = path.join(process.cwd(), 'api', 'angel', 'OpenAPIScripMaster.json');

  try {
    const rawData = fs.readFileSync(scripMasterPath, 'utf8');
    scripMasterCache = JSON.parse(rawData);
    console.log(`✅ Loaded ${scripMasterCache.length} instruments from local file`);
    return scripMasterCache;
  } catch (err) {
    console.error('❌ Failed to load local scrip master:', err.message);
    throw new Error('Cannot load ScripMaster JSON from disk');
  }
}

// ✅ Login to AngelOne SmartAPI
async function angelLogin() {
  const smart_api = new SmartAPI({ api_key: API_KEY });
  const totpCode = otp.authenticator.generate(TOTP_SECRET);
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totpCode);

  authToken = session.data.jwtToken;
  feedToken = session.data.feedToken;

  console.log('✅ Angel login successful');
  return { authToken, feedToken };
}

app.post('/api/angel/historical', async (req, res) => {
  console.log("📩 Incoming request body:", req.body);

  let { symbol, exchange } = req.body;
  if (!symbol || !exchange) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Ensure logged in
    if (!feedToken || !authToken) {
      await angelLogin();
    }

    const scripMaster = await loadScripMaster();

    // Normalize symbol
    symbol = symbol.toUpperCase();
    exchange = exchange.toUpperCase();
    const symbolWithEq = symbol.endsWith('-EQ') ? symbol : `${symbol}-EQ`;

    console.log(`🔍 Searching token for: ${symbolWithEq} @ ${exchange}`);

    const instrument = scripMaster.find(inst =>
      inst.symbol.toUpperCase() === symbolWithEq &&
      inst.exch_seg.toUpperCase() === exchange
    );

    if (!instrument) {
      return res.status(404).json({ error: `Symbol '${symbolWithEq}' not found on ${exchange}` });
    }

    const symbolToken = instrument.token;
    console.log(`✅ Found symbol token: ${symbolToken}`);

    // Prepare date range (last 30 days)
    const now = new Date();
    const fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const pad = (n) => n.toString().padStart(2, '0');
    const formatDate = (date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    console.log(`⏳ Fetching candle data from ${formatDate(fromDate)} to ${formatDate(now)}...`);

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
          Accept: 'application/json',
        },
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      }
    );

    if (!candleRes.data || !candleRes.data.data) {
      return res.status(500).json({ error: 'No data from Angel API' });
    }

    console.log(`✅ Candle data fetched for ${symbolWithEq}`);

    // ✅ Return candles AND live feed creds in one call
    res.json({
      symbol: symbolWithEq,
      token: symbolToken,
      exchange,
      clientCode: CLIENT_ID,
      feedToken: feedToken,
      apiKey: API_KEY,
      data: candleRes.data.data
    });

  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
    res.status(500).json({ error: error.message || 'Failed to fetch data' });
  }
});

export default app;
