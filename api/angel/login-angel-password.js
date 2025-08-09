import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    console.log(`Invalid method: ${req.method}`);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const CLIENT_SECRET = process.env.ANGEL_API_KEY; // Your API key
  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

  const { clientcode, mpin, totp } = req.body;

  console.log("Login attempt with body:", req.body);
  console.log("Using client IP:", req.headers['x-forwarded-for'] || req.connection.remoteAddress || "127.0.0.1");

  if (!clientcode || !mpin) {
    console.log("Missing clientcode or mpin");
    return res.status(400).json({ error: "Missing clientcode or mpin" });
  }

  try {
    const loginPayload = {
      clientcode,
      mpin,
      state: "some-state",  // you can customize or generate this for security
    };

    if (totp && totp.trim() !== "") {
      loginPayload.totp = totp;
    }

    const loginRes = await axios.post(
      `${ANGEL_API_BASE}/rest/auth/angelbroking/user/v1/loginByMpIN`,
      loginPayload,
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": req.headers['x-forwarded-for'] || req.connection.remoteAddress || "127.0.0.1",
          "X-ClientPublicIP": req.headers['x-forwarded-for'] || req.connection.remoteAddress || "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          "X-PrivateKey": CLIENT_SECRET,
        },
        validateStatus: () => true, // so axios doesn’t throw on non-200
      }
    );

    console.log("Angel API login response status:", loginRes.status);
    console.log("Angel API login response data:", JSON.stringify(loginRes.data));

    const accessToken = loginRes.data?.data?.jwtToken;

    if (!accessToken) {
      console.log("No access token received in response", loginRes.data);
      return res.status(401).json({ error: "Login failed: No access token received", details: loginRes.data });
    }

    console.log("Login successful, sending token");
    return res.status(200).json({ accessToken });
  } catch (err) {
    console.error("Login error:", err.response?.data || err.message || err);
    return res.status(500).json({ error: "Internal server error", details: err.message || err });
  }
}
