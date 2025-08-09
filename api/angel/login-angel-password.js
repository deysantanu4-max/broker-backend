import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const CLIENT_SECRET = process.env.ANGEL_CLIENT_SECRET;
  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

  const { clientcode, password, totp = "" } = req.body; // default totp to empty string

  console.log("Login attempt with body:", { clientcode, password: password ? "****" : "", totp });
  console.log("Using client IP:", req.headers['x-forwarded-for'] || "127.0.0.1");

  if (!clientcode || !password) {
    console.log("Missing clientcode or password");
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

    console.log("Angel API login response status:", loginRes.status);
    if (loginRes.status !== 200) {
      console.log("Unexpected login status:", loginRes.status);
      return res.status(401).json({ error: "Login failed with status " + loginRes.status });
    }

    const accessToken = loginRes.data?.data?.jwtToken;
    if (!accessToken) {
      console.log("No access token received in response", loginRes.data);
      return res.status(401).json({ error: "Login failed: No access token received" });
    }

    console.log("Login successful, sending access token");
    return res.status(200).json({ accessToken });
  } catch (err) {
    console.error("Login error:", err.response?.data || err.message || err);
    return res.status(401).json({ error: "Invalid credentials or login error" });
  }
}
