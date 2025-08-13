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

// Login to Angel
async function angelLogin() {
  const totp = otp.authenticator.generate(TOTP_SECRET);
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);
  authToken = session.data.jwtToken;
  tokenTimestamp = Date.now();
  console.log('✅ Angel login successful (portfolio)');
}

// Check token expiry
function isTokenExpired() {
  if (!authToken || !tokenTimestamp) return true;
  const hoursSinceLogin = (Date.now() - tokenTimestamp) / (1000 * 60 * 60);
  return hoursSinceLogin > 23;
}

// Angel API headers
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

// API route
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

      console.log(`📬 Raw Angel API response for convertPosition:`, JSON.stringify(apiResponse.data, null, 2));

      if (apiResponse.data && apiResponse.data.status) {
        return res.status(200).json({
          status: "success",
          message: apiResponse.data.message || "Position converted successfully"
        });
      } else {
        // Convert "Position not found" → "No positions to convert"
        let msg = apiResponse.data?.message || "No positions to convert";
        if (msg.toLowerCase().includes("position not found")) {
          msg = "No positions to convert";
        }
        return res.status(200).json({
          status: "error",
          message: msg,
          details: apiResponse.data || {}
        });
      }
    }
    else {
      return res.status(400).json({ error: 'Invalid action parameter' });
    }

    console.log(`✅ Angel API response for '${action}' fetched successfully`);

    let returnedData = apiResponse.data?.data || [];

    if (action === 'holdings' && returnedData.holdings) {
      returnedData = returnedData.holdings;
    }
    if (action === 'positions' && returnedData.positions) {
      returnedData = returnedData.positions;
    }

    if (!Array.isArray(returnedData) || returnedData.length === 0) {
      console.warn(`⚠ No data returned from Angel for action '${action}'. Full response:`, JSON.stringify(apiResponse.data, null, 2));

      let message = "No data found";
      if (action === "holdings") message = "No holdings found";
      if (action === "positions") message = "No positions found";

      return res.status(200).json({
        status: "error",
        message
      });
    }

    console.log(`✅ Angel API returned ${returnedData.length} record(s) for action '${action}'.`);
    console.log(`🔍 Sample records for '${action}':`, JSON.stringify(returnedData.slice(0, 3), null, 2));

    return res.status(200).json({
      status: "success",
      data: returnedData
    });

  } catch (error) {
    console.error('❌ Error in /api/angel/portfolio:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message || 'Internal Server Error',
    });
  }
});

export default app;
