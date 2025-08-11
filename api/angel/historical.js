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
  console.log('📥 Fetching scrip master JSON from Angel public URL...');
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

// Route handler
app.post('/api/angel/historical', async (req, res) => {
  console.log("📩 Incoming request body:", req.body);

  let { symbol, exchange } = req.body;

  if (!symbol || !exchange) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    if (!feedToken) {
      await angelLogin();
    }

    const scripMaster = await loadScripMaster();

    // Normalize inputs
    symbol = symbol.toUpperCase();
    exchange = exchange.toUpperCase();

    // Append '-EQ' suffix if not present
    const symbolWithEq = symbol.endsWith('-EQ') ? symbol : `${symbol}-EQ`;
    console.log(`🔍 Searching for symbol: ${symbolWithEq}, exchange: ${exchange}`);

    // Search in scrip master using correct keys: symbol and exch_seg
    const instrument = scripMaster.find(inst => 
      inst.symbol.toUpperCase() === symbolWithEq && inst.exch_seg.toUpperCase() === exchange
    );

    if (!instrument) {
      // Log some close matches for debugging
      const closeMatches = scripMaster.filter(inst =>
        inst.symbol.toUpperCase().includes(symbol) && inst.exch_seg.toUpperCase() === exchange
      );
      console.log(`❌ Symbol '${symbolWithEq}' not found on exchange '${exchange}'. Found ${closeMatches.length} close matches:`, closeMatches.slice(0, 10).map(i => i.symbol));
      return res.status(404).json({ error: `Symbol '${symbolWithEq}' not found in scrip master for exchange '${exchange}'` });
    }

    const symbolToken = instrument.token;
    console.log(`✅ Found symbol token: ${symbolToken} for ${symbolWithEq}`);

    // Prepare date range
    const now = new Date();
    const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

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
      }
    );

    if (!candleRes.data || !candleRes.data.data) {
      console.error('❌ No data in response from Angel API');
      return res.status(500).json({ error: 'No data in response from Angel API' });
    }

    console.log(`✅ Successfully fetched candle data for ${symbolWithEq}`);
    res.json(candleRes.data);

  } catch (error) {
    console.error('❌ Failed to fetch data:', error.response?.data || error.message || error);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

export default app;
