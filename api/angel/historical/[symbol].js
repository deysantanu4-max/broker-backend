import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed, use POST" });
  }

  const CLIENT_SECRET = process.env.ANGEL_API_KEY;
  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

  const { symbol, exchange } = req.body;

  if (!symbol) {
    return res.status(400).json({ error: "Missing symbol in request body" });
  }

  const ex = (exchange || "NSE").toUpperCase();

  let accessToken = req.headers["authorization"];
  if (!accessToken) {
    return res.status(401).json({ error: "No access token provided" });
  }
  if (accessToken.toLowerCase().startsWith("bearer ")) {
    accessToken = accessToken.slice(7);
  }

  try {
    // 1️⃣ Get symbol token from Angel's search API
    const searchRes = await axios.get(
      `${ANGEL_API_BASE}/rest/secure/angelbroking/market/v1/searchBySymbol`,
      {
        params: {
          exchange: ex,
          searchsymbol: symbol.toUpperCase(),
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
          "X-PrivateKey": CLIENT_SECRET,
        },
      }
    );

    if (
      !searchRes.data ||
      !searchRes.data.data ||
      searchRes.data.data.length === 0
    ) {
      return res.status(404).json({ error: "Symbol not found" });
    }

    const symbolToken = searchRes.data.data[0].symbolToken;

    // 2️⃣ Fetch historical data using symbolToken
    const historyRes = await axios.post(
      `${ANGEL_API_BASE}/rest/secure/angelbroking/historical/v1/getCandleData`,
      {
        exchange: ex,
        symboltoken: symbolToken,
        interval: "ONE_MINUTE",
        fromdate: "2024-08-01 09:15",  // You can make these dynamic or configurable
        todate: "2024-08-02 15:30",
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
          "X-PrivateKey": CLIENT_SECRET,
        },
      }
    );

    return res.status(200).json(historyRes.data);
  } catch (error) {
    console.error("Failed to fetch data:", error.response?.data || error.message || error);
    return res.status(500).json({ error: "Failed to fetch data" });
  }
}
