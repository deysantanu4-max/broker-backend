// /api/angel/live.js
import axios from "axios";
import crypto from "crypto";
import os from "os";
import https from "https";

function generateTOTP(secret) {
  const epoch = Math.floor(Date.now() / 1000);
  const time = Math.floor(epoch / 30);
  const key = Buffer.from(secret, "base64");
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(0, 0);
  buffer.writeUInt32BE(time, 4);
  const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const otp = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return otp.toString().padStart(6, "0");
}

export default async function handler(req, res) {
  console.log("📩 /api/angel/live hit");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const apiKey = process.env.ANGEL_API_KEY; // ✅ Use same as historical
  const clientId = process.env.ANGEL_CLIENT_ID;
  const password = process.env.ANGEL_PASSWORD;
  const totpSecret = process.env.ANGEL_TOTP_SECRET;

  if (!apiKey || !clientId || !password || !totpSecret) {
    console.error("❌ Missing env variables");
    return res.status(500).json({ error: "Missing credentials in env" });
  }

  try {
    console.log("🔑 Logging in to AngelOne...");

    const payload = {
      clientcode: clientId,
      password: password,
      totp: generateTOTP(totpSecret)
    };

    const headers = {
      "X-PrivateKey": apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      "X-ClientLocalIP": "192.168.1.1", // dummy safe IP
      "X-ClientPublicIP": "122.176.75.22", // dummy safe public IP
      "X-MACAddress": "00:0a:95:9d:68:16"
    };

    const loginResp = await axios.post(
      "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword",
      payload,
      {
        headers,
        httpsAgent: new https.Agent({ rejectUnauthorized: false })
      }
    );

    console.log("📡 Login HTTP status:", loginResp.status);
    console.log("📡 Login data:", loginResp.data);

    if (!loginResp.data?.data?.feedToken) {
      console.error("❌ Login failed, missing feedToken");
      return res.status(500).json({ error: "Login failed", details: loginResp.data });
    }

    console.log("✅ Returning WS creds");
    return res.status(200).json({
      clientCode: clientId,
      feedToken: loginResp.data.data.feedToken,
      apiKey: apiKey
    });

  } catch (err) {
    if (err.response) {
      console.error("💥 Live API error:", err.response.status, err.response.data);
      return res.status(500).json({
        error: "Login request failed",
        status: err.response.status,
        details: err.response.data
      });
    }
    console.error("💥 Live API error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
