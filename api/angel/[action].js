// actions.js
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// Your Angel One API credentials
const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const CLIENT_SECRET = process.env.ANGEL_CLIENT_SECRET;
const REDIRECT_URI = process.env.ANGEL_REDIRECT_URI;

// Angel One API base URL
const ANGEL_API_BASE = "https://apiconnect.angelone.in";

// Step 1: Start Login (redirect to Angel One)
app.get("/login-angel", (req, res) => {
  const loginUrl = `https://smartapi.angelone.in/publisher-login?api_key=${CLIENT_ID}`;
  res.redirect(loginUrl);
});

// Step 2: Callback after user logs in
app.get("/api/angel/callback", async (req, res) => {
  const { request_token } = req.query;
  if (!request_token) return res.status(400).send("No request token found");

  try {
    // Exchange request_token for access_token
    const tokenRes = await axios.post(
      `${ANGEL_API_BASE}/rest/auth/angelbroking/user/v1/loginByPassword`,
      {
        api_key: CLIENT_ID,
        request_token: request_token,
        client_secret: CLIENT_SECRET,
      }
    );

    const accessToken = tokenRes.data?.data?.jwtToken;
    if (!accessToken) throw new Error("Token not received");

    // TODO: Save accessToken to DB against the logged-in user ID
    console.log("Access Token:", accessToken);

    // Redirect back to your Android app main activity
    res.redirect(`aistocksignal://auth-success?token=${accessToken}`);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send("Error exchanging token");
  }
});

// Step 3: Fetch Historical Data
app.get("/historical/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const accessToken = req.headers["authorization"];

  if (!accessToken)
    return res.status(401).json({ error: "No access token provided" });

  try {
    const historyRes = await axios.post(
      `${ANGEL_API_BASE}/rest/secure/angelbroking/historical/v1/getCandleData`,
      {
        exchange: "NSE",
        symboltoken: symbol, // You must map this from scrip to token
        interval: "ONE_MINUTE",
        fromdate: "2024-08-01 09:15",
        todate: "2024-08-02 15:30",
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": "127.0.0.1",
          "X-ClientPublicIP": "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          Accept: "application/json",
        },
      }
    );

    res.json(historyRes.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
