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
const BACKEND_BASE_URL = process.env.BACKEND_BASE_URL;

if (!CLIENT_ID || !PASSWORD || !API_KEY || !TOTP_SECRET) {
  console.error('❌ Missing required env vars');
}

let smart_api = new SmartAPI({ api_key: API_KEY });
let scripMasterCache = null;
let authToken = null;
let feedToken = null;

async function loadScripMaster() {
  if (scripMasterCache) return scripMasterCache;
  const res = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
  scripMasterCache = res.data;
  return scripMasterCache;
}

async function angelLogin() {
  const totp = otp.authenticator.generate(TOTP_SECRET);
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);
  authToken = session.data.jwtToken;
  feedToken = session.data.feedToken;
}

app.post('/api/angel/historical', async (req, res) => {
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
      return res.status(404).json({ error: `Symbol '${symbolWithEq}' not found` });
    }

    const symbolToken = instrument.token;

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

    // Auto-start live stream
    try {
      await axios.post(`${BACKEND_BASE_URL}/api/angel/live/stream`, {
        clientCode,
        feedToken,
        tokens: [symbolToken],
        exchange // pass exchange to live.js
      }, {
        headers: { Authorization: `Bearer ${authToken}` }
      });
    } catch (streamErr) {
      console.error(`⚠️ Failed to start live stream:`, streamErr.message);
    }

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
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

export default app;
