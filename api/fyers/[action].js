// api/fyers/[action].js

let accessToken = null;

export default async function handler(req, res) {
  const { action } = req.query;

  // ========================
  // Handle Login (redirect)
  // ========================
  if (action === "login") {
    const redirectUri = process.env.FYERS_REDIRECT_URI;
    const clientId = process.env.FYERS_CLIENT_ID;
    const state = "xyz123";

    const authUrl = `https://api.fyers.in/api/v2/generate-authcode?client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&state=${state}`;

    return res.redirect(authUrl);
  }

  // ========================
  // Handle Callback (exchange code for token)
  // ========================
  if (action === "callback") {
    const { code } = req.query;

    const response = await fetch("https://api.fyers.in/api/v2/accessToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: process.env.FYERS_CLIENT_ID,
        secret_key: process.env.FYERS_SECRET_ID,
        grant_type: "authorization_code",
        code: code,
      }),
    });

    const data = await response.json();
    if (data.access_token) {
      accessToken = data.access_token;
      return res.status(200).json({ success: true, accessToken });
    } else {
      return res.status(500).json({ success: false, error: data });
    }
  }

  // ========================
  // Status: check if token is saved
  // ========================
  if (action === "status") {
    if (accessToken) {
      return res.status(200).json({ connected: true, token: accessToken });
    } else {
      return res.status(200).json({ connected: false });
    }
  }

  // ========================
  // Price fetch (Fyers v3)
  // ========================
  if (action === "price") {
    return await (async () => {
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
          body: JSON.stringify({ symbols: [symbol] }),
        });

        const data = await response.json();
        const price = data?.d?.[0]?.v?.lp;

        if (price) {
          return res.status(200).json({ symbol, price, message: "Price fetched successfully" });
        } else {
          return res.status(404).json({ error: "Price not found", raw: data });
        }
      } catch (err) {
        console.error("Error fetching price:", err);
        return res.status(500).json({ error: "Failed to fetch price", message: err.message });
      }
    })();
  }

  // ========================
  // Invalid action
  // ========================
  return res.status(404).json({ error: "Invalid action" });
}
