import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

// Your Angel One API credentials (app-level, secure)
const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const CLIENT_SECRET = process.env.ANGEL_CLIENT_SECRET;

const ANGEL_API_BASE = "https://apiconnect.angelone.in";

// Static symbol to token mapping (expand as needed)
const symbolTokenMap = {
  "RELIANCE": "3045",
  "TCS": "2953",
  "INFY": "408065",
  "HDFCBANK": "341249",
  "ICICIBANK": "1270529",
  // Add more symbols and their tokens here
};

// Login endpoint: users send their Angel One user credentials here
app.post("/login-angel-password", async (req, res) => {
  console.log("Login attempt received with body:", req.body);
  console.log("Loaded CLIENT_ID:", CLIENT_ID ? "YES" : "NO");
  console.log("Loaded CLIENT_SECRET:", CLIENT_SECRET ? "YES" : "NO");

  const { clientcode, password, totp } = req.body;

  if (!clientcode || !password) {
    console.log("Missing clientcode or password in request");
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
          "X-ClientLocalIP": req.ip || "127.0.0.1",
          "X-ClientPublicIP": req.ip || "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          "X-PrivateKey": CLIENT_SECRET,
        },
      }
    );

    const accessToken = loginRes.data?.data?.jwtToken;
    if (!accessToken) throw new Error("Login failed: No access token received");

    console.log("Login successful, sending token");
    res.json({ accessToken });
  } catch (err) {
    console.error("Login error:", err.response?.data || err.message || err);
    res.status(401).json({ error: "Invalid credentials or login error" });
  }
});

// Historical data fetch endpoint - requires access token from logged in user
app.get("/historical/:symbol", async (req, res) => {
  const { symbol } = req.params;
  let accessToken = req.headers["authorization"];

  if (!accessToken) return res.status(401).json({ error: "No access token provided" });

  // Remove "Bearer " prefix if present
  if (accessToken.toLowerCase().startsWith("bearer ")) {
    accessToken = accessToken.slice(7);
  }

  const symbolToken = symbolTokenMap[symbol.toUpperCase()];
  if (!symbolToken) {
    return res.status(400).json({ error: "Invalid or unsupported symbol" });
  }

  try {
    const historyRes = await axios.post(
      `${ANGEL_API_BASE}/rest/secure/angelbroking/historical/v1/getCandleData`,
      {
        exchange: "NSE",
        symboltoken: symbolToken,
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
          "X-ClientLocalIP": req.ip || "127.0.0.1",
          "X-ClientPublicIP": req.ip || "127.0.0.1",
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
