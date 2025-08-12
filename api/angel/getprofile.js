import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import otp from 'otplib';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.ANGEL_API_KEY;
const TOTP_SECRET = process.env.ANGEL_TOTP_SECRET;

if (!API_KEY) {
  console.error('❌ Missing ANGEL_API_KEY in env');
  process.exit(1);
}

// Helper function to login and get JWT token
async function loginAndGetToken(clientcode, password, totp) {
  // If no TOTP provided, generate one dynamically
  let generatedTotp = totp;
  if (!generatedTotp) {
    if (!TOTP_SECRET) throw new Error('TOTP not provided and TOTP_SECRET missing');
    generatedTotp = otp.authenticator.generate(TOTP_SECRET);
  }

  // Login API call to Angel to get JWT token
  const loginResponse = await axios.post('https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/loginByPassword', {
    clientcode,
    password,
    totp: generatedTotp
  }, {
    headers: {
      'X-PrivateKey': API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-SourceID': 'WEB',
      'X-UserType': 'USER'
    }
  });

  if (!loginResponse.data.status || !loginResponse.data.data?.jwtToken) {
    throw new Error('Login failed or JWT token missing');
  }

  return loginResponse.data.data.jwtToken;
}

// GET profile from Angel using JWT token
async function getProfileFromAngel(jwtToken) {
  const profileResponse = await axios.get('https://apiconnect.angelone.in/rest/secure/angelbroking/user/v1/getProfile', {
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-UserType': 'USER',
      'X-SourceID': 'WEB',
      'X-PrivateKey': API_KEY
    }
  });

  if (!profileResponse.data.status) {
    throw new Error(profileResponse.data.message || 'Failed to fetch profile');
  }

  return profileResponse.data.data;
}

app.post('/', async (req, res) => {
  try {
    const { clientcode, password, totp } = req.body;

    if (!clientcode || !password) {
      return res.status(400).json({ success: false, message: 'Missing clientcode or password' });
    }

    // Login and get JWT token
    const jwtToken = await loginAndGetToken(clientcode, password, totp);
    console.log(`✅ Logged in and got JWT token for client: ${clientcode}`);

    // Get profile from Angel API
    const profileData = await getProfileFromAngel(jwtToken);
    console.log(`✅ Fetched profile for client: ${clientcode}`);

    res.json({
      success: true,
      data: profileData
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
