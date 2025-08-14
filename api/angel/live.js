import { Router } from 'express';
import { SmartAPI } from 'smartapi-javascript';
import otp from 'otplib';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

const API_KEY = process.env.ANGEL_MARKET_DATA_API_KEY;
const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const PASSWORD = process.env.ANGEL_PASSWORD;
const TOTP_SECRET = process.env.ANGEL_TOTP_SECRET;

if (!API_KEY || !CLIENT_ID || !PASSWORD || !TOTP_SECRET) {
  console.error('❌ Missing required env vars for live data');
}

async function angelLogin() {
  try {
    console.log('🔑 Logging into Angel for direct WebSocket credentials...');
    const smart_api = new SmartAPI({ api_key: API_KEY });
    const totp = otp.authenticator.generate(TOTP_SECRET);

    const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);
    console.log('✅ Login successful');

    return {
      clientCode: CLIENT_ID,
      feedToken: session.data.feedToken,
      apiKey: API_KEY
    };
  } catch (err) {
    console.error('❌ Login failed:', err.message || err);
    throw err;
  }
}

router.post('/stream', async (req, res) => {
  try {
    const creds = await angelLogin();
    res.json(creds); // send credentials to frontend
  } catch (err) {
    res.status(500).json({ error: 'Failed to get WebSocket credentials' });
  }
});

export default router;
