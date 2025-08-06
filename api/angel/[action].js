// /api/angel/[action].js
import axios from "axios";

export default async function handler(req, res) {
  const { action } = req.query;

  try {
    if (action === "login") {
      // Step 1: Redirect to Angel One login
      const loginUrl = `https://smartapi.angelbroking.com/publisher-login?api_key=${process.env.ANGEL_API_KEY}`;
      return res.redirect(loginUrl);
    }

    if (action === "callback") {
      // Step 2: Handle redirect after login
      const { request_token } = req.query;
      if (!request_token) {
        return res.status(400).json({ error: "Missing request_token" });
      }

      // Step 3: Exchange request_token for access_token
      const tokenResponse = await axios.post(
        "https://apiconnect.angelbroking.com/rest/auth/angelbroking/jwt/v1/generateToken",
        {
          apiKey: process.env.ANGEL_API_KEY,
          clientCode: process.env.ANGEL_CLIENT_CODE,
          jwtToken: request_token,
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1",
            "X-MACAddress": "ab:cd:ef:gh:ij:kl",
            "X-PrivateKey": process.env.ANGEL_API_KEY,
          },
        }
      );

      return res.status(200).json(tokenResponse.data);
    }

    if (action === "status") {
      // Step 4: (Optional) Check API status
      return res.status(200).json({ status: "Angel One API is working" });
    }

    return res.status(404).json({ error: "Invalid action" });
  } catch (error) {
    console.error("Angel API Error:", error);
    res.status(500).json({ error: error.message });
  }
}
