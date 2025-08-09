import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    console.log(`[${new Date().toISOString()}] Method Not Allowed: ${req.method}`);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const CLIENT_SECRET = process.env.ANGEL_CLIENT_SECRET;
  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

  console.log(`[${new Date().toISOString()}] Login attempt with body:`, req.body);

  const { clientcode, password, totp } = req.body;

  if (!clientcode || !password) {
    console.log(`[${new Date().toISOString()}] Missing clientcode or password`);
    return res.status(400).json({ error: "Missing clientcode or password" });
  }

  if (!CLIENT_SECRET) {
    console.error(`[${new Date().toISOString()}] Missing ANGEL_CLIENT_SECRET environment variable`);
    return res.status(500).json({ error: "Server configuration error" });
  }

  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || "127.0.0.1";

    console.log(`[${new Date().toISOString()}] Using client IP: ${ip}`);

    const loginRes = await axios.post(
      `${ANGEL_API_BASE}/rest/auth/angelbroking/user/v1/loginByPassword`,
      {
        clientcode,
        password,
        totp: totp || "",
        state: "some-state",
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
        timeout: 10000, // 10 seconds timeout
      }
    );

    console.log(`[${new Date().toISOString()}] Angel API login response status: ${loginRes.status}`);

    if (loginRes.status !== 200) {
      console.error(`[${new Date().toISOString()}] Login failed, status: ${loginRes.status}`);
      return res.status(loginRes.status).json({ error: "Login failed at Angel API" });
    }

    const accessToken = loginRes.data?.data?.jwtToken;
    if (!accessToken) {
      console.error(`[${new Date().toISOString()}] No access token received in response`, loginRes.data);
      return res.status(401).json({ error: "Login failed: No access token received" });
    }

    console.log(`[${new Date().toISOString()}] Login successful, sending token`);
    res.status(200).json({ accessToken });

  } catch (err) {
    // Log detailed error info
    if (err.response) {
      // Server responded with a status outside 2xx
      console.error(`[${new Date().toISOString()}] Angel API error response:`, {
        status: err.response.status,
        data: err.response.data,
        headers: err.response.headers,
      });
      return res.status(err.response.status || 401).json({ error: err.response.data || "Login error from Angel API" });
    } else if (err.request) {
      // Request was made but no response received
      console.error(`[${new Date().toISOString()}] No response from Angel API:`, err.request);
      return res.status(503).json({ error: "No response from Angel API" });
    } else {
      // Other errors
      console.error(`[${new Date().toISOString()}] Error during login request:`, err.message);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
}
