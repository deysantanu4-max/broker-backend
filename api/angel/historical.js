import express from 'express';
import { SmartAPI } from 'smartapi-javascript';
import axios from 'axios';

const app = express();
app.use(express.json());

// Load credentials from environment variables
const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const PASSWORD = process.env.ANGEL_PASSWORD;
const API_KEY = process.env.ANGEL_API_KEY;  // your Angel API key (X-PrivateKey)

if (!CLIENT_ID || !PASSWORD || !API_KEY) {
  console.error("Missing ANGEL_CLIENT_ID, ANGEL_PASSWORD, or ANGEL_API_KEY env variables!");
  process.exit(1);
}

let smart_api = new SmartAPI({ api_key: API_KEY });
let scripMasterCache = null;

async function loadScripMaster() {
  if (scripMasterCache) return scripMasterCache;
  console.log("Fetching scrip master JSON from Angel public URL...");
  const res = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
  scripMasterCache = res.data;
  console.log(`Loaded ${scripMasterCache.length} instruments`);
  return scripMasterCache;
}

app.post('/api/angel/historical', async (req, res) => {
  const { symbol, exchange } = req.body;

  if (!symbol || !exchange) {
    return res.status(400).json({ error: "Missing symbol or exchange" });
  }

  try {
    console.log(`Received request for symbol: '${symbol}', exchange: '${exchange}'`);

    // 1. Generate session and get feed token
    await smart_api.generateSession(CLIENT_ID, PASSWORD);
    const feedToken = smart_api.getfeedToken();
    console.log("Feed token obtained");

    // 2. Load scrip master and find symbol token
    const scripMaster = await loadScripMaster();

    const symbolUpper = symbol.toUpperCase();
    const exUpper = exchange.toUpperCase();

    const instrument = scripMaster.find(
      (inst) =>
        inst.tradingsymbol === symbolUpper &&
        inst.exchange === exUpper
    );

    if (!instrument) {
      console.warn(`Symbol '${symbolUpper}' with exchange '${exUpper}' not found in scrip master`);
      return res.status(404).json({ error: "Symbol not found in scrip master" });
    }

    const symbolToken = instrument.token;
    console.log(`Found symbolToken: ${symbolToken}`);

    // 3. Prepare dates in Angel API format yyyy-MM-dd HH:mm
    const now = new Date();
    const toDate = now;
    const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

    const pad = (n) => n.toString().padStart(2, "0");

    const formatDate = (date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    console.log("Fetching historical candle data for:");
    console.log(`Exchange: ${exUpper}`);
    console.log(`SymbolToken: ${symbolToken}`);
    console.log(`FromDate: ${formatDate(fromDate)}`);
    console.log(`ToDate: ${formatDate(toDate)}`);

    // 4. Fetch candle data
    const candleRes = await axios.post(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/historical/v1/getCandleData',
      {
        exchange: exUpper,
        symboltoken: symbolToken,
        interval: "ONE_MINUTE",
        fromdate: formatDate(fromDate),
        todate: formatDate(toDate)
      },
      {
        headers: {
          "Authorization": `Bearer ${feedToken}`,
          "X-PrivateKey": API_KEY,
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": "127.0.0.1",
          "X-ClientPublicIP": "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      }
    );

    if (!candleRes.data || !candleRes.data.data) {
      return res.status(500).json({ error: "No data in response from Angel API" });
    }

    console.log("Historical data fetch successful");

    res.json(candleRes.data);

  } catch (error) {
    console.error("Failed to fetch data:", error.response?.data || error.message || error);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

// Start your server (if standalone, else use your existing Express setup)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Angel backend API running on port ${PORT}`);
});
