import axios from "axios";

export default async function handler(req, res) {
  console.info("Handler invoked");

  if (req.method !== "POST") {
    console.warn(`Invalid method: ${req.method}`);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const API_KEY = process.env.ANGEL_API_KEY; // <-- Use API key here
  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

  console.info("Loaded API_KEY:", API_KEY ? "YES" : "NO");

  const { clientcode, password, totp } = req.body;

  console.info("Received login request body:", req.body);

  if (!clientcode || !password) {
    console.warn("Missing clientcode or password");
    return res.status(400).json({ error: "Missing clientcode or password" });
  }

  try {
    const loginPayload = {
      clientcode,
      password,
      state: "some-state",
    };

    if (totp && totp.trim() !== "") {
      loginPayload.totp = totp;
      console.info("TOTP included in payload");
    }

    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || "127.0.0.1";
    console.info("Using client IP:", clientIP);

    const loginRes = await axios.post(
      `${ANGEL_API_BASE}/rest/auth/angelbroking/user/v1/loginByPassword`,
      loginPayload,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": clientIP,
          "X-ClientPublicIP": clientIP,
          "X-MACAddress": "00:00:00:00:00:00",
          "X-PrivateKey": API_KEY, // Correct API key here
        },
        validateStatus: () => true, // So we can log all responses
      }
    );

    console.info("Angel API login response status:", loginRes.status);
    console.info("Angel API login response data:", JSON.stringify(loginRes.data));

    const accessToken = loginRes.data?.data?.jwtToken;

    if (!accessToken) {
      console.warn("No access token received in response", loginRes.data);
      return res.status(401).json({ error: "Login failed: No access token received", details: loginRes.data });
    }

    console.info("Login successful, sending token");
    return res.status(200).json({ accessToken });
  } catch (err) {
    console.error("Login error:", err.response?.data || err.message || err);
    return res.status(500).json({ error: "Internal server error", details: err.message || err });
  }
}
