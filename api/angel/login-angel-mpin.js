// api/angel/login-angel-mpin.js

import express from 'express';
import { SmartAPI } from 'smartapi-javascript';
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

// 🗂 Cache variables (shared across requests)
let cachedAuthToken = null;
let cachedFeedToken = null;
let lastLoginDate = null;

// ✅ Helper: check if token is still valid for today
function isTokenValid() {
  const today = new Date().toISOString().split('T')[0];
  return cachedAuthToken && cachedFeedToken && lastLoginDate === today;
}

// ✅ Login function
async function loginToAngel() {
  const smart_api = new SmartAPI({ api_key: API_KEY });
  const totpCode = otp.authenticator.generate(TOTP_SECRET);

  console.log("🔑 Performing full login to AngelOne...");
  const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totpCode);

  cachedAuthToken = session.data.jwtToken;
  cachedFeedToken = session.data.feedToken;
  lastLoginDate = new Date().toISOString().split('T')[0];

  console.log("✅ Login successful — tokens cached for today");
  return { authToken: cachedAuthToken, feedToken: cachedFeedToken };
}

app.get('/api/angel/login', async (req, res) => {
  try {
    if (isTokenValid()) {
      console.log("⚡ Using cached AngelOne tokens");
      return res.json({
        clientCode: CLIENT_ID,
        apiKey: API_KEY,
        authToken: cachedAuthToken,
        feedToken: cachedFeedToken
      });
    }

    const { authToken, feedToken } = await loginToAngel();
    res.json({
      clientCode: CLIENT_ID,
      apiKey: API_KEY,
      authToken,
      feedToken
    });
  } catch (error) {
    console.error("❌ Angel login error:", error.message || error);
    res.status(500).json({ error: error.message || 'Login failed' });
  }
});

export default app;

// ✅ Export reusable login for other modules (historical.js, live.js)
export async function getAngelTokens() {
  if (isTokenValid()) {
    console.log("⚡ Using cached AngelOne tokens (from getAngelTokens)");
    return { authToken: cachedAuthToken, feedToken: cachedFeedToken };
  }
  return await loginToAngel();
}
