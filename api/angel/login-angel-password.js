import axios from "axios";

console.log("login-angel-password API loaded");

export default async function handler(req, res) {
  console.log("Handler invoked");

  if (req.method !== "POST") {
    console.error(`Invalid method: ${req.method}`);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const CLIENT_SECRET = process.env.ANGEL_CLIENT_SECRET;
  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

  console.log("Loaded CLIENT_SECRET:", CLIENT_SECRET ? "YES" : "NO");

  const { clientcode, password, totp } = req.body;

  console.log("Received login request body:", req.body);

  if (!clientcode || !password) {
    console.error("Missing clientcode or password");
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
      console.log("TOTP included in payload");
    } else {
      console.log("No TOTP included in payload");
    }

    const clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress || "127.0.0.1";
    console.log("Using client IP:", clientIP);

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
          "X-PrivateKey": CLIENT_SECRET,
        },
        validateStatus: () => true,
      }
    );

    console.log("Angel API login response status:", loginRes.status);
    console.log("Angel API login response data:", JSON.stringify(loginRes.data));

    const accessToken = loginRes.data?.data?.jwtToken;

    if (!accessToken) {
      console.error("No access token received in response", loginRes.data);
      return res.status(401).json({ error: "Login failed: No access token received", details: loginRes.data });
    }

    console.log("Login successful, sending token");
    return res.status(200).json({ accessToken });
  } catch (err) {
    console.error("Caught error during login:", err.response?.data || err.message || err);
    return res.status(500).json({ error: "Internal server error", details: err.message || err });
  }
}
