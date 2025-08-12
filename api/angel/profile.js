// api/angel/getprofile.js

import express from 'express';
import { SmartAPI } from 'smartapi-javascript';
import dotenv from 'dotenv';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// POST request expected: { clientcode, password, totp }
app.post('/', async (req, res) => {
  const { clientcode, password, totp } = req.body;

  if (!clientcode || !password || !totp) {
    return res.status(400).json({ error: "Missing required parameters: clientcode, password, totp" });
  }

  try {
    console.log(`📌 Login attempt for Angel Client: ${clientcode}`);

    const smart_api = new SmartAPI({ api_key: process.env.ANGEL_API_KEY });

    // Step 1: Login with user's credentials
    const session = await smart_api.generateSession(clientcode, password, totp);
    console.log(`✅ Login success for ${clientcode}, fetching profile...`);

    // Step 2: Get Profile using the generated access token
    const profile = await smart_api.getProfile({
      clientcode,
      jwtToken: session.data.jwtToken
    });

    console.log(`✅ Profile fetched successfully for ${clientcode}`);
    res.json(profile.data);

  } catch (error) {
    console.error("❌ Error fetching profile:", error);
    res.status(500).json({ error: error.message || "Failed to fetch profile" });
  }
});

export default app;
