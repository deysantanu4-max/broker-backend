// api/angel/historical.js

import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import cors from 'cors';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { getAngelTokens } from './login-angel-mpin.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const API_KEY = process.env.ANGEL_API_KEY;

if (!CLIENT_ID || !API_KEY) {
  console.error('❌ Missing required env vars: ANGEL_CLIENT_ID, ANGEL_API_KEY');
}

let scripMasterCache = null;

const exchangeMap = {
  NSE: 'NSE',
  BSE: 'BSE',
  MCX: 'MCX',
  NFO: 'NFO',
  BFO: 'BFO',
  CDS: 'CDS'
};

// Allowed Angel intervals
const validIntervals = new Set([
  'ONE_MINUTE',
  'FIVE_MINUTE',
  'FIFTEEN_MINUTE',
  'ONE_HOUR',
  'ONE_DAY'
]);

// -------------------- ScripMaster Loader --------------------
async function loadScripMaster(exchange) {
  try {
    if (!scripMasterCache) {
      console.log('📥 Loading local scrip master JSON...');
      const scripMasterPath = path.join(process.cwd(), 'api', 'angel', 'OpenAPIScripMaster.json');
      const rawData = fs.readFileSync(scripMasterPath, 'utf8');
      scripMasterCache = JSON.parse(rawData);
      console.log(`✅ Loaded ${scripMasterCache.length} instruments from local file`);
    }

    const hasExchange = scripMasterCache.some(inst => inst.exch_seg.toUpperCase() === exchange);
    if (hasExchange) {
      console.log(`📄 Found exchange ${exchange} in local file`);
      return scripMasterCache;
    } else {
      console.log(`⚠️ Exchange ${exchange} not found in local file — fetching from Angel API...`);
    }
  } catch (err) {
    console.warn('⚠️ Failed to load local ScripMaster:', err.message);
  }

  // Fallback: fetch from Angel API
  const res = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
  scripMasterCache = res.data;
  console.log(`✅ Loaded ${scripMasterCache.length} instruments from Angel API (includes ${exchange})`);
  return scripMasterCache;
}

// -------------------- Historical Candles --------------------
app.post('/api/angel/historical', async (req, res) => {
  console.log("📩 Incoming request body:", req.body);

  let { symbol, exchange, interval } = req.body;
  if (!symbol || !exchange) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // ✅ Default to 1-minute if not provided
  interval = interval && validIntervals.has(interval.toUpperCase())
    ? interval.toUpperCase()
    : 'ONE_MINUTE';

  try {
    exchange = exchangeMap[exchange.toUpperCase()] || 'NSE';

    const { authToken, feedToken } = await getAngelTokens();
    const scripMaster = await loadScripMaster(exchange);

    symbol = symbol.toUpperCase();
    console.log(`🔍 Searching token for: ${symbol} @ ${exchange}`);

    // ✅ Refined search: exact symbol match first, equity-only
    let instrument = scripMaster.find(inst =>
      inst.exch_seg.toUpperCase() === exchange &&
      (
        inst.symbol.toUpperCase() === symbol ||
        inst.symbol.toUpperCase() === `${symbol}-EQ`
      ) &&
      (inst.instrumenttype === '' || inst.instrumenttype === 'EQ')
    );

    // Fallback: name contains query
    if (!instrument) {
      instrument = scripMaster.find(inst =>
        inst.exch_seg.toUpperCase() === exchange &&
        inst.name &&
        inst.name.toUpperCase().includes(symbol)
      );
    }

    if (!instrument) {
      console.error(`❌ Symbol '${symbol}' not found in exchange ${exchange}`);
      return res.status(404).json({ error: `Symbol '${symbol}' not found on ${exchange}` });
    }

    const symbolToken = instrument.token;
    const symbolWithEq = instrument.symbol.endsWith('-EQ') ? instrument.symbol : `${instrument.symbol}-EQ`;

    console.log(`✅ Found symbol token: ${symbolToken}`);

    // ✅ Choose max range by interval
    const now = new Date();
    let daysBack;
    switch (interval) {
      case 'ONE_MINUTE':
      case 'FIVE_MINUTE':
      case 'FIFTEEN_MINUTE':
        daysBack = 30; // Angel limit for intraday
        break;
      case 'ONE_HOUR':
        daysBack = 180; // ~6 months
        break;
      case 'ONE_DAY':
        daysBack = 365; // ~1 year
        break;
      default:
        daysBack = 30;
    }

    const fromDate = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const pad = (n) => n.toString().padStart(2, '0');
    const formatDate = (date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    console.log(`⏳ Fetching candle data [${interval}] for last ${daysBack} days: ${formatDate(fromDate)} → ${formatDate(now)}`);

    const candleRes = await axios.post(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData',
      {
        exchange,
        symboltoken: symbolToken,
        interval,
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

    console.log(`✅ Candle data fetched for ${symbolWithEq} (${interval}, ${daysBack} days)`);

    res.json({
      symbol: symbolWithEq,
      token: symbolToken,
      exchange,
      interval,
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

// -------------------- Index Values --------------------
app.get('/api/angel/index', async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'Missing index name' });

    const { authToken } = await getAngelTokens();

    const idxRes = await axios.post(
      "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/getIndices",
      { indexName: name.toUpperCase() },  // e.g. NIFTY, BANKNIFTY, SENSEX
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

    if (!idxRes.data || !idxRes.data.data) {
      return res.status(500).json({ error: 'No data from Angel API' });
    }

    res.json({
      index: name.toUpperCase(),
      data: idxRes.data.data
    });

  } catch (err) {
    console.error("❌ Index fetch error:", err.response?.data || err.message);
    res.status(500).json({ error: err.message || 'Failed to fetch index' });
  }
});

export default app;
