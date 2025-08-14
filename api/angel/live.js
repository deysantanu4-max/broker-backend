import fetch from 'node-fetch';

export default async function handler(req, res) {
  console.log("📩 Incoming request to /api/angel/live");

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    console.log("Incoming body:", req.body);

    // Validate environment keys
    const apiKey = process.env.ANGEL_MARKET_DATA_API_KEY;
    if (!apiKey) {
      console.error("❌ Missing ANGEL_MARKET_DATA_API_KEY in env");
      return res.status(500).json({ error: "Missing market data API key" });
    }

    const clientId = process.env.ANGEL_CLIENT_ID;
    const password = process.env.ANGEL_PASSWORD;
    const totpSecret = process.env.ANGEL_TOTP_SECRET;
    if (!clientId || !password || !totpSecret) {
      console.error("❌ Missing Angel login credentials in env");
      return res.status(500).json({ error: "Missing login credentials" });
    }

    // 1️⃣ Login to Angel to get feedToken
    console.log("🔐 Logging in to Angel...");
    const loginResp = await fetch("https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword", {
      method: "POST",
      headers: {
        "X-PrivateKey": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        clientcode: clientId,
        password: password,
        totp: generateTOTP(totpSecret) // We’ll define this below
      })
    });

    const loginData = await loginResp.json();
    console.log("Login response:", loginData);

    if (!loginData.data || !loginData.data.fundoid) {
      return res.status(500).json({ error: "Login failed", details: loginData });
    }

    const feedToken = loginData.data.feedToken;
    console.log("✅ Got feedToken:", feedToken);

    // 2️⃣ Return credentials for direct WebSocket connection
    return res.status(200).json({
      clientCode: clientId,
      feedToken: feedToken,
      apiKey: apiKey
    });

  } catch (err) {
    console.error("💥 Live API error:", err);
    return res.status(500).json({ error: err.message });
  }
}

// 🔹 Simple TOTP generator for Angel
import crypto from 'crypto';
function generateTOTP(secret) {
  const epoch = Math.floor(Date.now() / 1000);
  const time = Math.floor(epoch / 30);
  const key = Buffer.from(secret, 'base64');
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(0, 0);
  buffer.writeUInt32BE(time, 4);
  const hmac = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const otp = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return otp.toString().padStart(6, '0');
}
