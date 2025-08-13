// api/angel/funds.js

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
let authToken = null;
let tokenTimestamp = null;

async function angelLogin() {
  const totp = otp.authenticator.generate(TOTP_SECRET);
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);

  authToken = session.data.jwtToken;
  tokenTimestamp = Date.now();
  console.log('✅ Angel login successful (funds)');
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

// Mapping from API keys to friendly labels
const keyMapping = {
  net: "Net",
  availablecash: "Available Cash",
  availableintradaypayin: "Available Intraday Payin",
  availablelimitmargin: "Available Limit Margin",
  collateral: "Collateral",
  m2munrealized: "M2M Unrealized",
  m2mrealized: "M2M Realized",
  utiliseddebits: "Utilised Debits",
  utilisedspan: "Utilised Span",
  utilisedoptionpremium: "Utilised Option Premium",
  utilisedholdingsales: "Utilised Holding Sales",
  utilisedexposure: "Utilised Exposure",
  utilisedturnover: "Utilised Turnover",
  utilisedpayout: "Utilised Payout"
};

app.get('/api/angel/funds', async (req, res) => {
  try {
    console.log('📩 Incoming funds request');

    if (isTokenExpired()) {
      await angelLogin();
    }

    const headers = buildAngelHeaders();

    console.log('💰 Fetching user funds & margin...');
    const apiResponse = await axios.get(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getRMS',
      { headers }
    );

    console.log("📦 Raw Angel API Funds Response:", JSON.stringify(apiResponse.data, null, 2));

    if (!apiResponse.data || !apiResponse.data.data) {
      console.warn('⚠ No funds data returned from Angel API');
      return res.status(200).json({
        status: "error",
        message: "No funds data found"
      });
    }

    console.log(`✅ Funds data retrieved successfully`);

    // Transform keys and replace nulls with "N/A"
    const rawData = apiResponse.data.data;
    const transformedData = {};
    Object.keys(rawData).forEach(key => {
      const newKey = keyMapping[key.toLowerCase()] || key; // fallback to original if not mapped
      transformedData[newKey] = rawData[key] === null ? "N/A" : rawData[key];
    });

    res.status(200).json({
      status: "success",
      data: transformedData
    });

  } catch (error) {
    console.error('❌ Error fetching funds:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message || 'Internal Server Error',
    });
  }
});

export default app;
