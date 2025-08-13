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

// Login function
async function angelLogin() {
  const totp = otp.authenticator.generate(TOTP_SECRET);
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);
  authToken = session.data.jwtToken;
  tokenTimestamp = Date.now();
  console.log('✅ Angel login successful (portfolio)');
}

// Token expiry check
function isTokenExpired() {
  if (!authToken || !tokenTimestamp) return true;
  const hoursSinceLogin = (Date.now() - tokenTimestamp) / (1000 * 60 * 60);
  return hoursSinceLogin > 23; // refresh before 24 hrs
}

// Build headers
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

      // Keep Android's current expectation for convertPosition
      if (apiResponse.data && apiResponse.data.status) {
        return res.status(200).json({
          status: "success",
          message: apiResponse.data.message || "Position converted successfully"
        });
      } else {
        return res.status(200).json({
          status: "error",
          message: apiResponse.data?.message || "Failed to convert position"
        });
      }
    } 
    else {
      return res.status(400).json({ error: 'Invalid action parameter' });
    }

    console.log(`✅ Angel API response for '${action}' fetched successfully`);

    // Unwrap holdings or positions array
    let returnedData = apiResponse.data?.data || [];

    if (action === 'holdings' && returnedData.holdings) {
      returnedData = returnedData.holdings;
    }
    if (action === 'positions' && returnedData.positions) {
      returnedData = returnedData.positions;
    }

    // Ensure it's always an array
    if (!Array.isArray(returnedData) || returnedData.length === 0) {
      console.warn(`⚠ No data returned from Angel for action '${action}'.`);
      return res.status(200).json({
        success: false,
        message: "No data found"
      });
    }

    console.log(`✅ Angel API returned ${returnedData.length} record(s) for action '${action}'.`);
    return res.status(200).json({
      success: true,
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
