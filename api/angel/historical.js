// historical.js

const axios = require('axios');

let scripMasterCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

async function getScripMaster() {
  const now = Date.now();

  if (scripMasterCache && (now - cacheTimestamp) < CACHE_DURATION) {
    return scripMasterCache;
  }

  try {
    const response = await axios.get('https://public-api.angelbroking.com/rest/secure/angelbrokingapiscripmaster');
    scripMasterCache = response.data;
    cacheTimestamp = now;
    console.log('Scrip master cache refreshed');
    return scripMasterCache;
  } catch (error) {
    console.error('Error fetching scrip master:', error.message);
    throw error;
  }
}

async function findSymbolToken(symbol, exchange) {
  const scripMaster = await getScripMaster();

  const match = scripMaster.find(
    (s) =>
      s.symbol.toUpperCase() === symbol.toUpperCase() &&
      s.exchange === exchange
  );

  if (!match) {
    throw new Error(`Symbol '${symbol}' not found on exchange '${exchange}'`);
  }

  return match.token;
}

async function fetchCandleData(symbol, exchange, fromDate, toDate, interval) {
  try {
    const symbolToken = await findSymbolToken(symbol, exchange);

    const payload = {
      exchange: exchange,
      symboltoken: symbolToken,
      interval: interval,
      fromdate: fromDate,
      todate: toDate,
    };

    const response = await axios.post(
      'https://public-api.angelbroking.com/rest/secure/angelbrokingapiscripmaster/candleData',
      payload
    );

    return response.data;
  } catch (error) {
    throw new Error(`Error fetching candle data: ${error.message}`);
  }
}

module.exports = async (req, res) => {
  const { symbol, exchange, fromDate, toDate, interval } = req.body;

  if (!symbol || !exchange || !fromDate || !toDate || !interval) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const candleData = await fetchCandleData(symbol, exchange, fromDate, toDate, interval);
    res.json(candleData);
  } catch (error) {
    console.error('Fetch-data error:', error.message);
    res.status(500).json({ error: error.message });
  }
};
