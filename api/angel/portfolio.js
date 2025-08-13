// api/angel/portfolio.js

import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { SmartAPI } from 'smartapi-javascript';
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
let authToken = null;
let tokenTimestamp = null;

// Login function (same as historical.js)
async function angelLogin() {
  const totp = otp.authenticator.generate(TOTP_SECRET);
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);
  authToken = session.data.jwtToken;
  tokenTimestamp = Date.now();
  console.log('✅ Angel login successful (portfolio)');
}

// Token expiry check (Angel JWT usually valid for 24 hrs)
function isTokenExpired() {
  if (!authToken || !tokenTimestamp) return true;
  const hoursSinceLogin = (Date.now() - tokenTimestamp) / (1000 * 60 * 60);
  return hoursSinceLogin > 23; // refresh before 24 hrs
}

// Build headers exactly as Angel expects
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

app.all('/api/angel/portfolio', async (req, res) => {
  try {
    console.log(`📩 Incoming portfolio request: Method=${req.method} Body=`, req.body);

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
      console.log('📊 Fetching holdings...');
      apiResponse = await axios.get(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getAllHolding',
        { headers }
      );
    } 
    else if (action === 'positions') {
      console.log('📊 Fetching positions...');
      apiResponse = await axios.get(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getPosition',
        { headers }
      );
    } 
    else if (action === 'convertPosition') {
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed. Use POST for convertPosition.' });
      }
      console.log('♻️ Converting position with data:', req.body.data);
      apiResponse = await axios.post(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/convertPosition',
        req.body.data || {},
        { headers }
      );
    } 
    else {
      return res.status(400).json({ error: 'Invalid action parameter' });
    }

    console.log(`✅ Angel API response for '${action}' fetched successfully`);
    if (!apiResponse.data || !apiResponse.data.data) {
  console.warn(`⚠ Angel API returned SUCCESS but no portfolio data for action '${action}'. Full response:`, JSON.stringify(apiResponse.data, null, 2));
  return res.status(200).json({
    status: false,
    message: `No data returned from Angel for action '${action}'`,
    rawResponse: apiResponse.data
  });
}

console.log(`✅ Angel API returned ${Array.isArray(apiResponse.data.data) ? apiResponse.data.data.length : 1} record(s) for action '${action}'.`);
res.json(apiResponse.data);

  } catch (error) {
    console.error('❌ Error in /api/angel/portfolio:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message || 'Internal Server Error',
    });
  }
});

export default app;
