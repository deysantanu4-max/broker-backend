import { SmartAPI } from "smartapi-javascript";

const smart_api = new SmartAPI({
  api_key: process.env.ANGEL_API_KEY, // your Angel SmartAPI key here
});

// Cache session info to avoid logging in every request
let sessionExpiry = 0;

async function ensureSession(clientId, password) {
  const now = Date.now();
  if (now < sessionExpiry) {
    // Session still valid
    return;
  }

  // Generate session (login)
  const response = await smart_api.generateSession(clientId, password);
  if (!response.status) {
    throw new Error("Login failed: " + JSON.stringify(response));
  }

  // Session valid for 1 hour approx - adjust if needed
  sessionExpiry = now + 55 * 60 * 1000;
  console.log("Logged in, feed token:", smart_api.getfeedToken());
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const { symbol, exchange, clientId, password } = req.body;

  if (!symbol || !exchange || !clientId || !password) {
    return res.status(400).json({ error: "Missing symbol, exchange, clientId, or password" });
  }

  try {
    // Login / session management
    await ensureSession(clientId, password);

    console.log(`Fetching symbol token for ${symbol} on exchange ${exchange}`);

    // Fetch all instruments (scrip master)
    const instruments = await smart_api.getInstruments(exchange.toUpperCase());

    // Find symbol token for requested symbol
    const scrip = instruments.find(
      (item) =>
        item.tradingsymbol.toUpperCase() === symbol.toUpperCase() &&
        item.exchange.toUpperCase() === exchange.toUpperCase()
    );

    if (!scrip) {
      return res.status(404).json({ error: `Symbol '${symbol}' not found on exchange '${exchange}'` });
    }

    const symbolToken = scrip.token;
    console.log(`Found symbol token: ${symbolToken}`);

    // Prepare date range for last 24 hours
    const now = new Date();
    const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const pad = (n) => n.toString().padStart(2, "0");
    const formatDate = (date) =>
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    // Fetch historical candle data
    const historyRes = await smart_api.getCandleData({
      exchange: exchange.toUpperCase(),
      symboltoken: symbolToken,
      interval: "ONE_MINUTE",
      fromdate: formatDate(fromDate),
      todate: formatDate(now),
    });

    if (!historyRes.status) {
      return res.status(500).json({ error: "Failed to fetch candle data", details: historyRes.message });
    }

    console.log(`Historical data fetch successful for symbol: ${symbol}`);
    return res.status(200).json(historyRes.data);
  } catch (error) {
    console.error("Backend error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}
