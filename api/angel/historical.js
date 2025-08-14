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

// Load ScripMaster: try local first, fallback to Angel API if exchange missing
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

  // Fallback: Fetch from Angel API
  const res = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
  scripMasterCache = res.data;
  console.log(`✅ Loaded ${scripMasterCache.length} instruments from Angel API (includes ${exchange})`);
  return scripMasterCache;
}

app.post('/api/angel/historical', async (req, res) => {
  console.log("📩 Incoming request body:", req.body);

  let { symbol, exchange } = req.body;
  if (!symbol || !exchange) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Normalize exchange
    exchange = exchangeMap[exchange.toUpperCase()] || 'NSE';

    // Get tokens from shared login
    const { authToken, feedToken } = await getAngelTokens();

    const scripMaster = await loadScripMaster(exchange);

    symbol = symbol.toUpperCase();

    console.log(`🔍 Searching token for: ${symbol} @ ${exchange}`);

    // ✅ Modified search to support BSE & NSE dynamically
    const instrument = scripMaster.find(inst =>
      inst.exch_seg.toUpperCase() === exchange &&
      (
        inst.symbol.toUpperCase() === symbol ||
        inst.symbol.toUpperCase() === `${symbol}-EQ` || // auto append -EQ if missing
        (inst.name && inst.name.toUpperCase().includes(symbol))
      )
    );

    if (!instrument) {
      console.error(`❌ Symbol '${symbol}' not found in exchange ${exchange}`);
      return res.status(404).json({ error: `Symbol '${symbol}' not found on ${exchange}` });
    }

    const symbolToken = instrument.token;
    const symbolWithEq = instrument.symbol.endsWith('-EQ') ? instrument.symbol : `${instrument.symbol}-EQ`;

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

    // Return candles AND live feed creds in one call
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
