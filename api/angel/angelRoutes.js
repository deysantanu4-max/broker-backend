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
let tokenTimestamp = null;

// ---------- LOGIN & TOKEN MANAGEMENT ----------
async function angelLogin() {
  const totp = otp.authenticator.generate(TOTP_SECRET);
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);
  authToken = session.data.jwtToken;
  tokenTimestamp = Date.now();
  console.log('✅ Angel login successful');
}

function isTokenExpired() {
  if (!authToken || !tokenTimestamp) return true;
  const hoursSinceLogin = (Date.now() - tokenTimestamp) / (1000 * 60 * 60);
  return hoursSinceLogin > 23;
}

function buildAngelHeaders() {
  return {
    Authorization: `Bearer ${authToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': '127.0.0.1',
    'X-ClientPublicIP': '127.0.0.1',
    'X-MACAddress': '00:00:00:00:00:00',
    'X-PrivateKey': API_KEY,
  };
}

// ---------- SCRIP MASTER CACHE ----------
async function loadScripMaster() {
  if (scripMasterCache) return scripMasterCache;
  console.log('📥 Fetching scrip master JSON...');
  const res = await axios.get(
    'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json'
  );
  scripMasterCache = res.data;
  console.log(`✅ Loaded ${scripMasterCache.length} instruments`);
  return scripMasterCache;
}

// ---------- HISTORICAL DATA ----------
app.post('/api/angel/historical', async (req, res) => {
  try {
    console.log("📩 Historical request body:", req.body);

    let { symbol, exchange } = req.body;
    if (!symbol || !exchange) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (isTokenExpired()) {
      await angelLogin();
    }

    const scripMaster = await loadScripMaster();
    symbol = symbol.toUpperCase();
    exchange = exchange.toUpperCase();
    const symbolWithEq = symbol.endsWith('-EQ') ? symbol : `${symbol}-EQ`;

    const instrument = scripMaster.find(
      inst =>
        inst.symbol.toUpperCase() === symbolWithEq &&
        inst.exch_seg.toUpperCase() === exchange
    );

    if (!instrument) {
      return res.status(404).json({ error: `Symbol '${symbolWithEq}' not found` });
    }

    const symbolToken = instrument.token;
    const now = new Date();
    const fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const pad = n => n.toString().padStart(2, '0');
    const formatDate = date =>
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
      { headers: buildAngelHeaders() }
    );

    res.json(candleRes.data);
  } catch (error) {
    console.error('❌ Historical error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// ---------- PORTFOLIO ACTIONS ----------
app.all('/api/angel/portfolio', async (req, res) => {
  try {
    if (isTokenExpired()) {
      await angelLogin();
    }

    const headers = buildAngelHeaders();
    const action = req.method === 'GET' ? req.query.action : req.body.action;
    if (!action) {
      return res.status(400).json({ error: 'Missing action parameter' });
    }

    let apiResponse;
    if (action === 'holdings') {
      apiResponse = await axios.get(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getAllHolding',
        { headers }
      );
    } else if (action === 'positions') {
      apiResponse = await axios.get(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getPosition',
        { headers }
      );
    } else if (action === 'convertPosition') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Use POST for convertPosition' });
      }
      apiResponse = await axios.post(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/convertPosition',
        req.body.data || {},
        { headers }
      );
    } else {
      return res.status(400).json({ error: 'Invalid action parameter' });
    }

    res.json(apiResponse.data);
  } catch (error) {
    console.error('❌ Portfolio error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message || 'Internal Server Error',
    });
  }
});

export default app;
