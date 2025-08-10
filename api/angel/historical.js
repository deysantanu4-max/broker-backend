import express from 'express';
import { SmartAPI } from 'smartapi-javascript';
import axios from 'axios';
import dotenv from 'dotenv';
import otp from 'otplib';

dotenv.config();

const app = express();
app.use(express.json());

const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const PASSWORD = process.env.ANGEL_PASSWORD;
const API_KEY = process.env.ANGEL_API_KEY; // Angel API key (X-PrivateKey)
const TOTP_SECRET = process.env.ANGEL_TOTP_SECRET; // Angel TOTP secret

if (!CLIENT_ID || !PASSWORD || !API_KEY || !TOTP_SECRET) {
  console.error('Missing required env vars: ANGEL_CLIENT_ID, ANGEL_PASSWORD, ANGEL_API_KEY, ANGEL_TOTP_SECRET');
  process.exit(1);
}

let smart_api = new SmartAPI({ api_key: API_KEY });
let scripMasterCache = null;
let authToken = null;
let feedToken = null;

async function loadScripMaster() {
  if (scripMasterCache) return scripMasterCache;
  console.log('Fetching scrip master JSON from Angel public URL...');
  const res = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
  scripMasterCache = res.data;
  console.log(`Loaded ${scripMasterCache.length} instruments`);
  return scripMasterCache;
}

async function angelLogin() {
  const totp = otp.authenticator.generate(TOTP_SECRET);
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);

  authToken = session.data.jwtToken;
  feedToken = session.data.feedToken;

  console.log('[info] Angel login successful');
}

app.post('/api/angel/historical', async (req, res) => {
  const { symbol, exchange } = req.body;

  if (!symbol || !exchange) {
    return res.status(400).json({ error: 'Missing symbol or exchange' });
  }

  try {
    console.log(`Received request for symbol: '${symbol}', exchange: '${exchange}'`);

    if (!feedToken) {
      await angelLogin();
    }

    const scripMaster = await loadScripMaster();

    const symbolUpper = symbol.toUpperCase();
    const exUpper = exchange.toUpperCase();

    const instrument = scripMaster.find(
      (inst) => inst.tradingsymbol === symbolUpper && inst.exchange === exUpper
    );

    if (!instrument) {
      console.warn(`Symbol '${symbolUpper}' with exchange '${exUpper}' not found in scrip master`);
      return res.status(404).json({ error: 'Symbol not found in scrip master' });
    }

    const symbolToken = instrument.token;

    const now = new Date();
    const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const pad = (n) => n.toString().padStart(2, '0');
    const formatDate = (date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    const candleRes = await axios.post(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData',
      {
        exchange: exUpper,
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
      return res.status(500).json({ error: 'No data in response from Angel API' });
    }

    res.json(candleRes.data);
  } catch (error) {
    console.error('Failed to fetch data:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Angel backend API running on port ${PORT}`);
});
