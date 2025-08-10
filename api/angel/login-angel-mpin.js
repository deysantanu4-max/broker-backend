import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    console.log(`Invalid method: ${req.method}`);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const CLIENT_SECRET = process.env.ANGEL_API_KEY; // Your API key
  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

  const { clientcode, password, totp, state } = req.body;

  console.log("Login attempt with body:", req.body);
  console.log("Using client IP:", req.headers['x-forwarded-for'] || req.connection.remoteAddress || "127.0.0.1");

  if (!clientcode || !password) {
    console.log("Missing clientcode or password");
    return res.status(400).json({ error: "Missing clientcode or password" });
  }

  const payload = {
    clientcode,
    password,
    state: state || "some-state"
  };

  if (totp && totp.trim() !== "") {
    payload.totp = totp;
  }

  try {
    const response = await axios({
      method: 'post',
      url: `${ANGEL_API_BASE}/rest/auth/angelbroking/user/v1/loginByPassword`,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': req.headers['x-forwarded-for'] || req.connection.remoteAddress || "127.0.0.1",
        'X-ClientPublicIP': req.headers['x-forwarded-for'] || req.connection.remoteAddress || "127.0.0.1",
        'X-MACAddress': '00:00:00:00:00:00',
        'X-PrivateKey': CLIENT_SECRET,
      },
      data: JSON.stringify(payload),
      validateStatus: () => true, // Don't throw on non-2xx status codes
    });

    console.log("Angel API response status:", response.status);
    console.log("Angel API response data:", JSON.stringify(response.data));

    const token = response.data?.data?.jwtToken;

    if (!token) {
      console.log("No access token received in response", response.data);
      return res.status(401).json({ error: "Login failed: No access token received", details: response.data });
    }

    // Return full response data so client sees { data: { jwtToken: ... } }
    return res.status(200).json(response.data);
  } catch (error) {
    console.error("Login error:", error.response?.data || error.message || error);
    return res.status(500).json({ error: "Internal server error", details: error.message || error });
  }
}
