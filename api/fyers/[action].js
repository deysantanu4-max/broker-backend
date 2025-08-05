import { URLSearchParams } from "url";

let accessToken = null; // stored in memory

export default async function handler(req, res) {
  const { action } = req.query;

  if (action === "login") {
    const clientId = process.env.FYERS_CLIENT_ID;
    const redirectUri = process.env.FYERS_REDIRECT_URI;
    const state = "santanu123";

    const url = `https://api.fyers.in/api/v3/generate-authcode?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${state}`;
    return res.redirect(url);
  }

  if (action === "callback") {
    const { code } = req.query;

    if (!code) {
      return res.status(400).json({ error: "Missing auth code" });
    }

    const response = await fetch("https://api.fyers.in/api/v3/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        appIdHash: process.env.FYERS_CLIENT_ID,
        code,
        secretKey: process.env.FYERS_SECRET_ID,
        redirect_uri: process.env.FYERS_REDIRECT_URI,
      }),
    });

    const data = await response.json();

    if (data.access_token) {
      accessToken = data.access_token;
      return res.status(200).send("Login successful! You can return to the app.");
    } else {
      return res.status(500).json({ error: "Token exchange failed", data });
    }
  }

  if (action === "status") {
    if (accessToken) {
      return res.status(200).json({ connected: true, token: accessToken });
    } else {
      return res.status(200).json({ connected: false });
    }
  }

  if (action === "price") {
    if (!accessToken) {
      return res.status(401).json({ error: "Fyers not authenticated" });
    }

    const { symbol } = req.query;
    if (!symbol) {
      return res.status(400).json({ error: "Missing symbol" });
    }

    const response = await fetch(`https://api.fyers.in/v3/quotes/${symbol}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    const data = await response.json();
    const price = data?.d?.[0]?.v?.lp;

    if (price) {
      return res.status(200).json({ symbol, price });
    } else {
      return res.status(404).json({ error: "Price not found", raw: data });
    }
  }

  return res.status(404).json({ error: "Invalid action" });
}
