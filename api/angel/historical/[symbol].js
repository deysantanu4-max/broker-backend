import axios from "axios";

export default async function handler(req, res) {
console.log("Symbol API hit"); 

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const CLIENT_SECRET = process.env.ANGEL_API_KEY;
  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

  const { symbol, exchange } = req.query; // exchange from app (NSE/BSE)

  if (!symbol) {
    console.log("Missing symbol parameter");
    return res.status(400).json({ error: "Missing symbol parameter" });
  }

  let accessToken = req.headers["authorization"];
  if (!accessToken) {
    console.log("No access token provided in headers");
    return res.status(401).json({ error: "No access token provided" });
  }

  // Remove "Bearer " prefix if present
  if (accessToken.toLowerCase().startsWith("bearer ")) {
    accessToken = accessToken.slice(7);
  }

  try {
    // 1️⃣ Get symbol token dynamically from Angel's search API
    console.log(`Fetching token for symbol: ${symbol}`);
    const searchRes = await axios.get(
      `${ANGEL_API_BASE}/rest/secure/angelbroking/market/v1/searchBySymbol`,
      {
        params: {
          exchange: exchange?.toUpperCase() || "NSE",
          searchsymbol: symbol.toUpperCase()
        },
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": req.headers["x-forwarded-for"] || "127.0.0.1",
          "X-ClientPublicIP": req.headers["x-forwarded-for"] || "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          Accept: "application/json",
          "X-PrivateKey": CLIENT_SECRET
        }
      }
    );

    if (!searchRes.data || !searchRes.data.data || searchRes.data.data.length === 0) {
      return res.status(404).json({ error: "Symbol not found" });
    }

    const symbolToken = searchRes.data.data[0].symbolToken;
    console.log(`Token for ${symbol}: ${symbolToken}`);

    // 2️⃣ Fetch historical data for that token
    console.log(`Fetching historical data for ${symbol} (${symbolToken})`);

    const historyRes = await axios.post(
      `${ANGEL_API_BASE}/rest/secure/angelbroking/historical/v1/getCandleData`,
      {
        exchange: exchange?.toUpperCase() || "NSE",
        symboltoken: symbolToken,
        interval: "ONE_MINUTE",
        fromdate: "2024-08-01 09:15",
        todate: "2024-08-02 15:30"
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": req.headers["x-forwarded-for"] || "127.0.0.1",
          "X-ClientPublicIP": req.headers["x-forwarded-for"] || "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          Accept: "application/json",
          "X-PrivateKey": CLIENT_SECRET
        }
      }
    );

    console.log("Historical data fetch successful");
    res.status(200).json(historyRes.data);
  } catch (err) {
    console.error("Failed to fetch data:", err.response?.data || err.message || err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
}
