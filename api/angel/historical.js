import axios from "axios";

let scripMasterCache = null;

// Fetch & cache scrip master list
async function fetchScripMaster() {
  if (scripMasterCache) {
    console.log("Using cached scrip master data");
    return scripMasterCache;
  }

  try {
    console.log("Fetching scrip master JSON from Angel public URL...");
    const response = await axios.get(
      "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
    );
    scripMasterCache = response.data;
    console.log(`Fetched ${scripMasterCache.length} instruments`);
    return scripMasterCache;
  } catch (error) {
    console.error("Failed to fetch scrip master JSON:", error.message || error);
    return null;
  }
}

// Get symbol token by symbol + exchange from cached scrip master
async function getSymbolToken(symbol, exchange) {
  const instruments = await fetchScripMaster();
  if (!instruments) {
    console.error("No scrip master data available");
    return null;
  }

  const found = instruments.find(
    (inst) =>
      inst.tradingsymbol.toUpperCase() === symbol.toUpperCase() &&
      inst.exchange.toUpperCase() === exchange.toUpperCase()
  );

  if (!found) {
    console.warn(`Symbol '${symbol}' with exchange '${exchange}' not found in scrip master`);
    return null;
  }

  console.log(`Found symbolToken '${found.token}' for symbol '${symbol}'`);
  return found.token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    console.log("Invalid HTTP method:", req.method);
    return res.status(405).json({ error: "Method not allowed, use POST" });
  }

  const CLIENT_SECRET = process.env.ANGEL_API_KEY;
  if (!CLIENT_SECRET) {
    console.error("Missing ANGEL_API_KEY in environment variables");
    return res.status(500).json({ error: "Server configuration error" });
  }

  const { symbol, exchange = "NSE" } = req.body;

  console.log(`Received request for symbol: '${symbol}', exchange: '${exchange}'`);

  if (!symbol) {
    console.log("Missing symbol in request body");
    return res.status(400).json({ error: "Missing symbol" });
  }

  let accessToken = req.headers["authorization"];
  if (!accessToken) {
    console.log("No access token provided in headers");
    return res.status(401).json({ error: "No access token provided" });
  }
  if (accessToken.toLowerCase().startsWith("bearer ")) {
    accessToken = accessToken.slice(7);
  }

  try {
    // Step 1: Get symbol token using ScripMaster
    const symbolToken = await getSymbolToken(symbol, exchange);
    if (!symbolToken) {
      return res.status(404).json({ error: "Symbol token not found" });
    }

    // Step 2: Prepare date range (24 hours back)
    const now = new Date();
    const toDate = now;
    const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const pad = (n) => n.toString().padStart(2, "0");
    const formatDate = (date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    console.log("Fetching historical candle data for:");
    console.log("Exchange:", exchange);
    console.log("SymbolToken:", symbolToken);
    console.log("FromDate:", formatDate(fromDate));
    console.log("ToDate:", formatDate(toDate));

    // Step 3: Fetch historical candle data from Angel API
    const historyRes = await axios.post(
      "https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData",
      {
        exchange: exchange.toUpperCase(),
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

    if (!historyRes.data || !historyRes.data.status) {
      console.error("Failed to get historical data:", historyRes.data);
      return res.status(500).json({ error: "Failed to fetch historical data" });
    }

    console.log("Historical data fetch successful");
    return res.status(200).json(historyRes.data);
  } catch (error) {
    console.error("Error during API call:", error.response?.data || error.message || error);
    return res.status(500).json({ error: "Failed to fetch data" });
  }
}
