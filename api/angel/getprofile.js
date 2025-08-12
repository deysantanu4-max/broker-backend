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
  const totp = otp.authenticator.generate(TOTP_SECRET);
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);

  authToken = session.data.jwtToken;
  feedToken = session.data.feedToken;

  console.log('✅ Angel login successful');
}

// POST /api/angel/getprofile
app.post('/api/angel/getprofile', async (req, res) => {
  const { clientcode } = req.body;

  if (!clientcode) {
    return res.status(400).json({ error: 'Missing required parameter: clientcode' });
  }

  try {
    if (!authToken) {
      await angelLogin();
    }

    // Make GET request to Angel profile API
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
      params: {
        clientcode,
      },
    };

    const response = await axios(config);

    if (response.status !== 200 || !response.data) {
      return res.status(500).json({ error: 'Failed to fetch profile from Angel API' });
    }

    res.json({
      success: true,
      data: response.data,
    });

  } catch (error) {
    // If auth token expired or invalid, try to relogin once
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      try {
        await angelLogin();

        // Retry after relogin
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
          params: {
            clientcode,
          },
        };

        const retryResponse = await axios(retryConfig);

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

    console.error('❌ Error fetching profile:', error.response?.data || error.message || error);
    res.status(500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to fetch profile',
    });
  }
});

export default app;
