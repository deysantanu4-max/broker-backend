import axios from "axios";

const symbolTokenMap = {
  "RELIANCE": "3045",
  "TCS": "2953",
  "INFY": "408065",
  "HDFCBANK": "341249",
  "ICICIBANK": "1270529",
  // Add more symbols and their tokens here
};

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { symbol } = req.query;
  let accessToken = req.headers["authorization"];

  if (!accessToken) return res.status(401).json({ error: "No access token provided" });

  if (accessToken.toLowerCase().startsWith("bearer ")) {
    accessToken = accessToken.slice(7);
  }

  const symbolToken = symbolTokenMap[symbol.toUpperCase()];
  if (!symbolToken) {
    return res.status(400).json({ error: "Invalid or unsupported symbol" });
  }

  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

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
          "X-ClientLocalIP": req.headers['x-forwarded-for'] || "127.0.0.1",
          "X-ClientPublicIP": req.headers['x-forwarded-for'] || "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          Accept: "application/json",
        },
      }
    );

    res.status(200).json(historyRes.data);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Failed to fetch historical data" });
  }
}
