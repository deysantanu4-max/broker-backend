import { SmartAPI } from "smartapi-javascript";
import axios from "axios";

const smart_api = new SmartAPI({
  api_key: process.env.ANGEL_API_KEY,
});

let scripMasterCache = null;

async function fetchScripMaster() {
  if (scripMasterCache) {
    return scripMasterCache;
  }
  try {
    const res = await axios.get(
      "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"
    );
    scripMasterCache = res.data;
    console.info(`Fetched ${scripMasterCache.length} instruments`);
    return scripMasterCache;
  } catch (err) {
    console.error("Failed to fetch scrip master:", err);
    throw err;
  }
}

function pad(n) {
  return n.toString().padStart(2, "0");
}

function formatDate(date) {
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
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed, use POST" });
  }

  const { symbol, exchange } = req.body;
  if (!symbol) {
    return res.status(400).json({ error: "Missing symbol in request body" });
  }
  const ex = (exchange || "NSE").toUpperCase();

  const clientId = process.env.ANGEL_CLIENT_ID;
  const password = process.env.ANGEL_PASSWORD;

  if (!clientId || !password || !process.env.ANGEL_API_KEY) {
    return res
      .status(500)
      .json({ error: "Missing Angel API credentials in environment variables" });
  }

  try {
    console.info(`Received request for symbol: '${symbol}', exchange: '${ex}'`);

    // 1. Generate session & get feed token
    await smart_api.generateSession(clientId, password);
    const feedToken = smart_api.getfeedToken();
    console.info("Feed Token acquired");

    // 2. Load scrip master JSON (cached)
    const scripMaster = await fetchScripMaster();

    // 3. Find matching instrument
    const instrument = scripMaster.find(
      (item) =>
        item.tradingsymbol?.toUpperCase() === symbol.toUpperCase() &&
        item.exchange?.toUpperCase() === ex
    );

    if (!instrument) {
      console.warn(`Symbol '${symbol}' with exchange '${ex}' not found in scrip master`);
      return res.status(404).json({ error: "Symbol not found" });
    }

    const symbolToken = instrument.token;
    console.info(`Found symbolToken: ${symbolToken}`);

    // 4. Prepare dates (24 hours range)
    const now = new Date();
    const toDate = now;
    const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // 5. Fetch historical candle data
    const historyRes = await axios.post(
      "https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData",
      {
        exchange: ex,
        symboltoken: symbolToken,
        interval: "ONE_MINUTE",
        fromdate: formatDate(fromDate),
        todate: formatDate(toDate),
      },
      {
        headers: {
          "X-PrivateKey": process.env.ANGEL_API_KEY,
          Accept: "application/json",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": req.headers["x-forwarded-for"] || "127.0.0.1",
          "X-ClientPublicIP": req.headers["x-forwarded-for"] || "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          "X-UserType": "USER",
          Authorization: `Bearer ${feedToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.info("Historical data fetch successful");
    return res.status(200).json(historyRes.data);
  } catch (error) {
    console.error(
      "Failed to fetch data:",
      error.response?.data || error.message || error
    );
    return res.status(500).json({ error: "Failed to fetch data" });
  }
}
