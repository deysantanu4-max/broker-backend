import { getZerodhaToken } from "./callback";

export default async function handler(req, res) {
  const token = getZerodhaToken();

  if (!token) {
    return res.status(401).json({ success: false, error: "Zerodha not connected." });
  }

  const symbol = req.query.symbol || "NSE:RELIANCE";

  const response = await fetch(`https://api.kite.trade/quote?i=${symbol}`, {
    headers: {
      "Authorization": `token ${process.env.ZERODHA_CLIENT_ID}:${token}`
    }
  });

  if (!response.ok) {
    const error = await response.text();
    return res.status(500).json({ success: false, error });
  }

  const data = await response.json();
  return res.status(200).json({ success: true, data });
}
