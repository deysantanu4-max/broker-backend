import { KiteConnect } from "kiteconnect";

let kc = null;
let accessToken = null;

export default async function handler(req, res) {
  const { action } = req.query;

  const apiKey = process.env.ZERODHA_API_KEY;
  const apiSecret = process.env.ZERODHA_API_SECRET;
  const redirectUri = process.env.ZERODHA_REDIRECT_URI;

  // ================
  // 1. Login (Redirect)
  // ================
  if (action === "login") {
    kc = new KiteConnect({ api_key: apiKey });
    const loginUrl = kc.getLoginURL();
    return res.redirect(loginUrl);
  }

  // ================
  // 2. Callback (Exchange token)
  // ================
  if (action === "callback") {
    const { request_token } = req.query;

    kc = new KiteConnect({ api_key: apiKey });

    try {
      const session = await kc.generateSession(request_token, apiSecret);
      accessToken = session.access_token;
      kc.setAccessToken(accessToken);
      return res.status(200).json({ success: true, accessToken });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // ================
  // 3. Status
  // ================
  if (action === "status") {
    if (accessToken) {
      return res.status(200).json({ connected: true, token: accessToken });
    } else {
      return res.status(200).json({ connected: false });
    }
  }

  // ================
  // 4. Price Fetch
  // ================
  if (action === "price") {
    if (!accessToken || !kc) {
      return res.status(401).json({ error: "Zerodha not authenticated" });
    }

    const { symbol } = req.query; // Example: "NSE:RELIANCE"
    if (!symbol) {
      return res.status(400).json({ error: "Missing symbol" });
    }

    try {
      const [exchange, tradingsymbol] = symbol.split(":");
      const quote = await kc.getQuote([`${exchange}:${tradingsymbol}`]);
      const price = quote?.[`${exchange}:${tradingsymbol}`]?.last_price;

      if (price) {
        return res.status(200).json({ symbol, price, message: "Price fetched successfully" });
      } else {
        return res.status(404).json({ error: "Price not found", raw: quote });
      }
    } catch (err) {
      return res.status(500).json({ error: "Failed to fetch price", message: err.message });
    }
  }

  // ================
  // 5. Default fallback
  // ================
  return res.status(404).json({ error: "Invalid action" });
}
