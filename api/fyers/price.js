import { getFyersToken } from "./callback";

export default async function handler(req, res) {
  const token = getFyersToken();
  const { symbol } = req.query;

  if (!token) {
    return res.status(401).json({ error: "Fyers not authenticated" });
  }

  if (!symbol) {
    return res.status(400).json({ error: "Missing symbol" });
  }

  try {
    const response = await fetch(`https://api.fyers.in/v3/quotes/${symbol}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const data = await response.json();

    const price = data?.d?.[0]?.v?.lp;

    if (price) {
      res.status(200).json({ symbol, price });
    } else {
      res.status(404).json({ error: "Price not found", raw: data });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
