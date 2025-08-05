import axios from 'axios';

export default async function handler(req, res) {
  const symbol = req.query.symbol || 'AAPL'; // default if none provided
  const API_KEY = process.env.ALPHA_VANTAGE_KEY;

  try {
    const response = await axios.get(
      `https://www.alphavantage.co/query`,
      {
        params: {
          function: 'TIME_SERIES_INTRADAY',
          symbol,
          interval: '1min',
          apikey: API_KEY,
        },
      }
    );

    const data = response.data;
    const latestTime = Object.keys(data["Time Series (1min)"] || {})[0];
    const price = data["Time Series (1min)"]?.[latestTime]?.["1. open"];

    if (!price) throw new Error("Price not found");

    res.status(200).json({
      success: true,
      symbol,
      time: latestTime,
      price,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to fetch price',
    });
  }
}
