import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const CLIENT_SECRET = process.env.ANGEL_CLIENT_SECRET;
  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

  const { clientcode, password, totp } = req.body;

  if (!clientcode || !password) {
    return res.status(400).json({ error: "Missing clientcode or password" });
  }

  // Get client IP from headers, fallback to localhost
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '127.0.0.1';

  try {
    const loginRes = await axios.post(
      `${ANGEL_API_BASE}/rest/auth/angelbroking/user/v1/loginByPassword`,
      {
        clientcode,
        password,
        ...(totp ? { totp } : {}),
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": ip,
          "X-ClientPublicIP": ip,
          "X-MACAddress": "00:00:00:00:00:00",
          "X-PrivateKey": CLIENT_SECRET,
        },
      }
    );

    const accessToken = loginRes.data?.data?.jwtToken;
    if (!accessToken) throw new Error("Login failed: No access token received");

    return res.status(200).json({ accessToken });
  } catch (err) {
    console.error("Login error:", err.response?.data || err.message || err);
    return res.status(401).json({ error: "Invalid credentials or login error" });
  }
}
