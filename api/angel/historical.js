import axios from "axios";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    console.log("Invalid method:", req.method);
    return res.status(405).json({ error: "Method not allowed, use POST" });
  }

  const CLIENT_SECRET = process.env.ANGEL_API_KEY;  // your private key from Vercel
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
  console.log("Access token received (truncated):", accessToken.substring(0, 10) + "...");

  try {
    // 1️⃣ Get symbol token from Angel's search API
    console.log(`Calling searchBySymbol API for symbol: ${symbol.toUpperCase()}, exchange: ${ex}`);

    const searchParams = {
      exchange: ex,
      searchSymbol: symbol.toUpperCase(),  // Changed to capital S in key, verify with API doc
    };
    console.log("Search params:", searchParams);

    const searchHeaders = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-UserType": "USER",
      "X-SourceID": "WEB",
      "X-ClientLocalIP": req.headers["x-forwarded-for"] || "127.0.0.1",
      "X-ClientPublicIP": req.headers["x-forwarded-for"] || "127.0.0.1",
      "X-MACAddress": "00:00:00:00:00:00",
      Accept: "application/json",
      "X-PrivateKey": CLIENT_SECRET,
    };
    console.log("Search headers:", JSON.stringify(searchHeaders));

    const searchRes = await axios.get(
      `${ANGEL_API_BASE}/rest/secure/angelbroking/market/v1/searchBySymbol`,
      {
        params: searchParams,
        headers: searchHeaders,
        validateStatus: () => true, // Don't throw, handle errors manually
      }
    );

    console.log("Raw search API response status:", searchRes.status);
    console.log("Raw search API response data:", JSON.stringify(searchRes.data));

    if (searchRes.status !== 200) {
      console.log(`Search API returned error status: ${searchRes.status}`);
      return res.status(searchRes.status).json({
        error: `Search API error: ${searchRes.status}`,
        details: searchRes.data,
      });
    }

    if (!searchRes.data || !searchRes.data.data || searchRes.data.data.length === 0) {
      console.log("Symbol not found in search results");
      return res.status(404).json({ error: "Symbol not found", rawResponse: searchRes.data });
    }

    const symbolToken = searchRes.data.data[0].symbolToken;
    console.log(`Found symbolToken: ${symbolToken}`);

    // 2️⃣ Prepare date range in "yyyy-MM-dd HH:mm" format (24 hours back)
    const now = new Date();
    const toDate = now;
    const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const pad = (n) => n.toString().padStart(2, "0");
    const formatDate = (date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    console.log("Fetching candle data from:", formatDate(fromDate), "to:", formatDate(toDate));

    // 3️⃣ Fetch historical candle data for symbol token
    const historyPayload = {
      exchange: ex,
      symboltoken: symbolToken,
      interval: "ONE_MINUTE",
      fromdate: formatDate(fromDate),
      todate: formatDate(toDate),
    };
    console.log("History fetch payload:", historyPayload);

    const historyHeaders = searchHeaders; // same headers as search

    const historyRes = await axios.post(
      `${ANGEL_API_BASE}/rest/secure/angelbroking/historical/v1/getCandleData`,
      historyPayload,
      {
        headers: historyHeaders,
        validateStatus: () => true,
      }
    );

    console.log("Historical data fetch status:", historyRes.status);
    console.log("Historical data response:", JSON.stringify(historyRes.data));

    if (historyRes.status !== 200) {
      console.log(`Historical data API error status: ${historyRes.status}`);
      return res.status(historyRes.status).json({
        error: `Historical data API error: ${historyRes.status}`,
        details: historyRes.data,
      });
    }

    return res.status(200).json(historyRes.data);
  } catch (error) {
    console.error("Failed to fetch data:", error.response?.data || error.message || error);
    return res.status(500).json({ error: "Failed to fetch data", details: error.response?.data || error.message || error });
  }
}
