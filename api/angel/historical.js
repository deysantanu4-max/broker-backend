// historical.js
const { SmartAPI } = require('smartapi-javascript');
const axios = require('axios');

// Load your credentials from environment variables
const API_KEY = process.env.ANGEL_API_KEY;
const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const PASSWORD = process.env.ANGEL_PASSWORD;

if (!API_KEY || !CLIENT_ID || !PASSWORD) {
  console.error("Please set ANGEL_API_KEY, ANGEL_CLIENT_ID and ANGEL_PASSWORD in env variables.");
  process.exit(1);
}

// Initialize SmartAPI instance
const smartApi = new SmartAPI({ api_key: API_KEY });

let cachedScripMaster = null;

// Fetch and cache scrip master JSON
async function getScripMaster() {
  if (cachedScripMaster) {
    console.log("Using cached scrip master");
    return cachedScripMaster;
  }
  try {
    console.log("Fetching scrip master from Angel public URL...");
    const response = await axios.get('https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json');
    cachedScripMaster = response.data;
    console.log(`Fetched ${cachedScripMaster.length} instruments`);
    return cachedScripMaster;
  } catch (error) {
    console.error('Error fetching scrip master:', error);
    throw error;
  }
}

// Get symbol token for given symbol and exchange
async function getSymbolToken(symbol, exchange) {
  const scripMaster = await getScripMaster();
  const upperSymbol = symbol.toUpperCase();
  const upperExchange = exchange.toUpperCase();

  const instrument = scripMaster.find(item =>
    item.tradingsymbol === upperSymbol && item.exchange === upperExchange
  );

  if (!instrument) {
    throw new Error(`Symbol '${symbol}' with exchange '${exchange}' not found in scrip master`);
  }
  console.log(`Found symbol token for ${symbol} on ${exchange}: ${instrument.token}`);
  return instrument.token;
}

// Generate session and get feed token
async function loginAndGetFeedToken() {
  try {
    console.log("Generating session...");
    await smartApi.generateSession(CLIENT_ID, PASSWORD);
    const feedToken = smartApi.getfeedToken();
    console.log("Feed Token obtained:", feedToken);
    return feedToken;
  } catch (error) {
    console.error("Error generating session:", error);
    throw error;
  }
}

// Fetch historical candle data using SmartAPI
async function getHistoricalData(feedToken, symbolToken, exchange) {
  const now = new Date();
  const toDate = now;
  const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const pad = n => n.toString().padStart(2, '0');
  const formatDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

  const payload = {
    exchange: exchange.toUpperCase(),
    symboltoken: symbolToken,
    interval: "ONE_MINUTE",
    fromdate: formatDate(fromDate),
    todate: formatDate(toDate),
  };

  try {
    console.log("Fetching historical data with payload:", payload);
    const response = await smartApi.getHistoricalData(payload);
    console.log('Historical data fetch successful');
    return response;
  } catch (error) {
    console.error('Error fetching historical data:', error);
    throw error;
  }
}

// Main API handler (assuming Express.js style)
async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed, use POST" });
  }

  const { symbol, exchange } = req.body;
  if (!symbol || !exchange) {
    return res.status(400).json({ error: "Missing 'symbol' or 'exchange' in request body" });
  }

  try {
    console.log(`Received request for symbol: '${symbol}', exchange: '${exchange}'`);

    // Login and get feed token
    await loginAndGetFeedToken();

    // Get symbol token from scrip master
    const symbolToken = await getSymbolToken(symbol, exchange);

    // Fetch historical data
    const historicalData = await getHistoricalData(smartApi.getfeedToken(), symbolToken, exchange);

    return res.status(200).json(historicalData);
  } catch (error) {
    console.error("Handler error:", error.message || error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

module.exports = handler;
