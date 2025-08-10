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

  const ex = (exchange || "NSE").toUpperCase();

  let accessToken = req.headers["authorization"];
  if (!accessToken) {
    console.log("No access token provided in headers");
    return res.status(401).json({ error: "No access token provided" });
  }
  if (accessToken.toLowerCase().startsWith("bearer ")) {
    accessToken = accessToken.slice(7);
  }

  // HARDCODED symbolToken for testing, e.g. TCS = 3045 on NSE
  const hardcodedSymbolToken = "3045";

  try {
    // Prepare date range: last 24 hours
    const now = new Date();
    const toDate = now;
    const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const pad = (n) => n.toString().padStart(2, "0");

    const formatDate = (date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    console.log("Fetching historical candle data for:");
    console.log("Exchange:", ex);
    console.log("SymbolToken:", hardcodedSymbolToken);
    console.log("FromDate:", formatDate(fromDate));
    console.log("ToDate:", formatDate(toDate));

    const historyRes = await axios.post(
      `${ANGEL_API_BASE}/rest/secure/angelbroking/historical/v1/getCandleData`,
      {
        exchange: ex,
        symboltoken: hardcodedSymbolToken,
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
