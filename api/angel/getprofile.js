// api/angel/getprofile.js

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
let feedToken = null;

async function angelLogin() {
  console.log("🔐 Performing Angel login...");
  const totp = otp.authenticator.generate(TOTP_SECRET);
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);

  authToken = session.data.jwtToken;
  feedToken = session.data.feedToken;

  console.log('✅ Angel login successful. Tokens set.');
}

// POST /api/angel/getprofile
app.post('/api/angel/getprofile', async (req, res) => {
  console.log("📩 Received getprofile request with body:", req.body);
  const { clientcode } = req.body;

  if (!clientcode) {
    console.log("❌ Missing clientcode in request body");
    return res.status(400).json({ error: 'Missing required parameter: clientcode' });
  }

  try {
    if (!authToken) {
      console.log("⚠️ No authToken present, logging in...");
      await angelLogin();
    } else {
      console.log("✅ AuthToken present, proceeding with API call...");
    }

    // Setup request config for Angel profile API
    const config = {
      method: 'get',
      url: 'https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getProfile',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1', // can be dynamic if you want
        'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '00:00:00:00:00:00',
        'X-PrivateKey': API_KEY,
      },
      params: { clientcode },
    };

    console.log("📡 Calling Angel profile API...");
    const response = await axios(config);
    console.log("✅ Angel profile API responded with status:", response.status);
    console.log("📦 Response data:", JSON.stringify(response.data, null, 2));

    if (response.status !== 200 || !response.data) {
      console.log("❌ Invalid response from Angel API");
      return res.status(500).json({ error: 'Failed to fetch profile from Angel API' });
    }

    res.json({
      success: true,
      data: response.data,
    });

  } catch (error) {
    console.error("⚠️ Error fetching profile:", error.response?.data || error.message || error);

    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      try {
        console.log("🔄 Token expired or unauthorized, retrying login...");
        await angelLogin();

        const retryConfig = {
          method: 'get',
          url: 'https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getProfile',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-UserType': 'USER',
            'X-SourceID': 'WEB',
            'X-ClientLocalIP': '127.0.0.1',
            'X-ClientPublicIP': '127.0.0.1',
            'X-MACAddress': '00:00:00:00:00:00',
            'X-PrivateKey': API_KEY,
          },
          params: { clientcode },
        };

        console.log("📡 Retrying Angel profile API call...");
        const retryResponse = await axios(retryConfig);

        console.log("✅ Retry successful. Responding with data.");
        return res.json({
          success: true,
          data: retryResponse.data,
        });

      } catch (retryError) {
        console.error('❌ Retry failed:', retryError.response?.data || retryError.message || retryError);
        return res.status(500).json({
          success: false,
          message: retryError.response?.data?.message || retryError.message || 'Failed to fetch profile after retry',
        });
      }
    }

    res.status(500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to fetch profile',
    });
  }
});

export default app;
