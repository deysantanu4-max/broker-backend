import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const CLIENT_SECRET = process.env.ANGEL_CLIENT_SECRET;
  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

  const { symbol } = req.query;

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

  // Map symbol to token (expand this mapping as needed)
  const symbolTokenMap = {
    RELIANCE: "3045",
    TCS: "2953",
    INFY: "408065",
    HDFCBANK: "341249",
    ICICIBANK: "1270529",
  };

  const symbolToken = symbolTokenMap[symbol.toUpperCase()];
  if (!symbolToken) {
    console.log("Invalid or unsupported symbol:", symbol);
    return res.status(400).json({ error: "Invalid or unsupported symbol" });
  }

  try {
    console.log(`Fetching historical data for symbol: ${symbol} with token: ${symbolToken}`);

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
          "X-ClientLocalIP": req.headers['x-forwarded-for'] || "127.0.0.1",
          "X-ClientPublicIP": req.headers['x-forwarded-for'] || "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          Accept: "application/json",
          "X-PrivateKey": CLIENT_SECRET,
        },
      }
    );

    console.log("Historical data fetch successful");
    res.status(200).json(historyRes.data);
  } catch (err) {
    console.error("Failed to fetch historical data:", err.response?.data || err.message || err);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
}
