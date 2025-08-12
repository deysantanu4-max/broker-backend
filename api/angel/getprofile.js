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
  process.exit(1);
}

const smart_api = new SmartAPI({ api_key: API_KEY });

app.post('/', async (req, res) => {
  try {
    console.log('➡️ Starting Angel profile fetch process');

    const totp = otp.authenticator.generate(TOTP_SECRET);
    console.log(`🔐 Generated TOTP: ${totp}`);

    console.log(`🧾 Logging in client: ${CLIENT_ID}`);
    const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);
    console.log('✅ Login successful');

    const jwtToken = session?.data?.jwtToken;
    if (!jwtToken) {
      throw new Error('JWT token missing in session response');
    }

    console.log('🔎 Fetching profile with JWT token');
    const profileResponse = await smart_api.getProfile({
      clientcode: CLIENT_ID,
      jwtToken: jwtToken,
    });

    console.log('✅ Profile fetched successfully');
    res.json({
      success: true,
      data: profileResponse.data,
    });

  } catch (error) {
    console.error('❌ Error fetching profile:', error.response?.data || error.message || error);

    const message =
      error.response?.data?.message ||
      error.message ||
      'Failed to fetch profile';

    res.status(500).json({
      success: false,
      message,
    });
  }
});

export default app;
