import crypto from 'crypto';

/**
 * Generate TOTP for AngelOne login
 */
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

export default async function handler(req, res) {
  console.log("📩 /api/angel/live hit");

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const apiKey = process.env.ANGEL_MARKET_DATA_API_KEY;
    const clientId = process.env.ANGEL_CLIENT_ID;
    const password = process.env.ANGEL_PASSWORD;
    const totpSecret = process.env.ANGEL_TOTP_SECRET;

    if (!apiKey || !clientId || !password || !totpSecret) {
      console.error("❌ Missing env variables");
      return res.status(500).json({ error: "Missing credentials in env" });
    }

    console.log("🔑 Logging in to AngelOne...");
    const loginResp = await fetch(
      "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword",
      {
        method: "POST",
        headers: {
          "X-PrivateKey": apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          clientcode: clientId,
          password: password,
          totp: generateTOTP(totpSecret)
        })
      }
    );

    const loginData = await loginResp.json();
    console.log("🔐 Login response:", loginData);

    if (!loginResp.ok || !loginData?.data?.feedToken) {
      console.error("❌ Login failed", loginData);
      return res.status(500).json({ error: "Login failed", details: loginData });
    }

    console.log("✅ Returning WS creds");
    return res.status(200).json({
      clientCode: clientId,
      feedToken: loginData.data.feedToken,
      apiKey: apiKey
    });

  } catch (err) {
    console.error("💥 Live API error:", err);
    return res.status(500).json({ error: err.message || "Unknown error" });
  }
}
