import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    console.log("Invalid method:", req.method);
    return res.status(405).json({ error: "Method not allowed, use POST" });
  }

  const CLIENT_SECRET = process.env.ANGEL_API_KEY;
  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

  const { symbol, exchange } = req.body;

  console.log("Received request with symbol:", symbol, "exchange:", exchange);

  if (!symbol) {
    console.log("Missing symbol in request body");
    return res.status(400).json({ error: "Missing symbol in request body" });
  }

  const ex = (exchange || "NSE").toUpperCase();

  let accessToken = req.headers["authorization"];
  if (!accessToken) {
    console.log("No access token provided in headers");
    return res.status(401).json({ error: "No access token provided" });
  }
  if (accessToken.toLowerCase().startsWith("bearer ")) {
    accessToken = accessToken.slice(7);
  }

  try {
    // 1️⃣ Call searchBySymbol API to get symbolToken
    console.log(`Calling searchBySymbol API for symbol: ${symbol.toUpperCase()}, exchange: ${ex}`);
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

    console.log("searchBySymbol response data:", JSON.stringify(searchRes.data));

    if (!searchRes.data || !searchRes.data.data || searchRes.data.data.length === 0) {
      console.log("Symbol not found in search results");
      return res.status(404).json({ error: "Symbol not found" });
    }

    const symbolToken = searchRes.data.data[0].symbolToken;
    console.log(`Found symbolToken: ${symbolToken}`);

    // 2️⃣ Prepare dates in required format (yyyy-MM-dd HH:mm)
    const now = new Date();
    const toDate = now;
    const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

    const pad = (n) => n.toString().padStart(2, "0");

    const formatDate = (date) => {
      return (
        date.getFullYear() +
        "-" +
        pad(date.getMonth() + 1) +
        "-" +
        pad(date.getDate()) +
        " " +
        pad(date.getHours()) +
        ":" +
        pad(date.getMinutes())
      );
    };

    // 3️⃣ Fetch historical data with POST body per API docs
    const historyRes = await axios.post(
      `${ANGEL_API_BASE}/rest/secure/angelbroking/historical/v1/getCandleData`,
      {
        exchange: ex,
        symboltoken: symbolToken,
        interval: "ONE_MINUTE",
        fromdate: formatDate(fromDate),
        todate: formatDate(toDate),
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

    console.log("Historical data fetch successful");
    console.log("Historical data response:", JSON.stringify(historyRes.data));

    return res.status(200).json(historyRes.data);
  } catch (error) {
    console.error("Failed to fetch data:", error.response?.data || error.message || error);
    return res.status(500).json({ error: "Failed to fetch data" });
  }
}
