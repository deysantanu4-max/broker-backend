import express from 'express';
import { SmartAPI } from 'smartapi-javascript';
import dotenv from 'dotenv';
import otp from 'otplib';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.ANGEL_API_KEY;
if (!API_KEY) {
  console.error('❌ Missing ANGEL_API_KEY in env');
  process.exit(1);
}

const smart_api = new SmartAPI({ api_key: API_KEY });

app.post('/', async (req, res) => {
  const { clientcode, password, totp } = req.body;

  if (!clientcode || !password) {
    return res.status(400).json({ error: 'Missing required parameters: clientcode, password' });
  }

  try {
    console.log(`➡️ Starting login for client: ${clientcode}`);

    // If TOTP not provided, generate one dynamically from env TOTP_SECRET
    let generatedTotp = totp;
    if (!generatedTotp) {
      if (!process.env.ANGEL_TOTP_SECRET) {
        return res.status(400).json({ error: 'TOTP not provided and ANGEL_TOTP_SECRET missing in env' });
      }
      generatedTotp = otp.authenticator.generate(process.env.ANGEL_TOTP_SECRET);
      console.log(`🔐 Generated TOTP dynamically: ${generatedTotp}`);
    } else {
      console.log('🔐 Using TOTP provided by client');
    }

    // Login session with user credentials + TOTP
    const session = await smart_api.generateSession(clientcode, password, generatedTotp);
    console.log(`✅ Login successful for client: ${clientcode}`);

    const jwtToken = session?.data?.jwtToken;
    if (!jwtToken) {
      throw new Error('JWT token missing in login session response');
    }

    console.log(`🔎 Fetching profile for client: ${clientcode} using JWT token`);
    const profileResponse = await smart_api.getProfile({
      clientcode,
      jwtToken,
    });

    console.log(`✅ Profile fetched successfully for client: ${clientcode}`);

    res.json({
      success: true,
      data: profileResponse.data,
    });

  } catch (error) {
    console.error('❌ Error in getprofile:', error.response?.data || error.message || error);

    res.status(500).json({
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to fetch profile',
    });
  }
});

export default app;
