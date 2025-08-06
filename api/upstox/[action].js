// api/upstox/[action].js

let accessToken = null;

export default async function handler(req, res) {
  const { action } = req.query;

  const clientId = process.env.UPSTOX_CLIENT_ID;
  const clientSecret = process.env.UPSTOX_SECRET_ID;
  const redirectUri = process.env.UPSTOX_REDIRECT_URI;

  // 1. Login URL (OAuth)
  if (action === "login") {
    const authUrl = `https://api.upstox.com/v2/login/authorization/dialog?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&state=xyz123`;
    return res.redirect(authUrl);
  }

  // 2. Callback Handler
  if (action === "callback") {
    const { code } = req.query;

    try {
      const response = await fetch("https://api.upstox.com/v2/login/authorization/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });

      const data = await response.json();

      if (data.access_token) {
        accessToken = data.access_token;
        return res.status(200).json({ success: true, accessToken });
      } else {
        return res.status(500).json({ success: false, error: data });
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // 3. Status Check
  if (action === "status") {
    if (accessToken) {
      return res.status(200).json({ connected: true, token: accessToken });
    } else {
      return res.status(200).json({ connected: false });
    }
  }

  // 4. Price Fetch
  if (action === "price") {
    if (!accessToken) {
      return res.status(401).json({ error: "Upstox not authenticated" });
    }

    const { symbol } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: "Missing symbol" });
    }

    try {
      const response = await fetch(`https://api.upstox.com/v2/market-quote/ltp?symbol=${symbol}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await response.json();
      const price = data?.data?.[symbol]?.last_price;

      if (price) {
        return res.status(200).json({
          symbol,
          price,
          message: "Price fetched successfully",
        });
      } else {
        return res.status(404).json({ error: "Price not found", raw: data });
      }
    } catch (err) {
      console.error("Upstox Price Error:", err);
      return res.status(500).json({ error: "Failed to fetch price", message: err.message });
    }
  }

  // 5. Fallback
  return res.status(404).json({ error: "Invalid action" });
}
