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

  try {
    const loginRes = await axios.post(
      `${ANGEL_API_BASE}/rest/auth/angelbroking/user/v1/loginByPassword`,
      {
        clientcode,
        password,
        totp,
        state: "some-state",
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": req.headers['x-forwarded-for'] || "127.0.0.1",
          "X-ClientPublicIP": req.headers['x-forwarded-for'] || "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          "X-PrivateKey": CLIENT_SECRET,
        },
      }
    );

    const accessToken = loginRes.data?.data?.jwtToken;
    if (!accessToken) throw new Error("Login failed: No access token received");

    res.status(200).json({ accessToken });
  } catch (err) {
    console.error("Login error:", err.response?.data || err.message || err);
    res.status(401).json({ error: "Invalid credentials or login error" });
  }
}
