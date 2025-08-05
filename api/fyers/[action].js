if (action === "price") {
  if (!accessToken) {
    return res.status(401).json({ error: "Fyers not authenticated" });
  }

  const { symbol } = req.query;
  if (!symbol) {
    return res.status(400).json({ error: "Missing symbol" });
  }

  try {
    const response = await fetch("https://api.fyers.in/v3/quotes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        symbols: [symbol],
      }),
    });

    const data = await response.json();

    const price = data?.d?.[0]?.v?.lp;

    if (price) {
      return res.status(200).json({ symbol, price });
    } else {
      return res.status(404).json({ error: "Price not found", raw: data });
    }
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch price", message: err.message });
  }
}
