export default async function handler(req, res) {
  const { broker, action } = req.query;

  // -------------------------
  // FYERS LOGIN (v3)
  // -------------------------
  if (broker === "fyers" && action === "login") {
    const redirectUri = process.env.FYERS_REDIRECT_URI; // e.g. https://fyers-redirect-9ubf.vercel.app/api/fyers/callback
    const authUrl = `https://api.fyers.in/api/v3/generate-authcode?client_id=${process.env.FYERS_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&state=xyz123`;

    return res.redirect(authUrl);
  }

  // -------------------------
  // FYERS CALLBACK (v3)
  // -------------------------
  if (broker === "fyers" && action === "callback") {
    const { code } = req.query;

    if (!code) {
      return res.status(400).json({ success: false, error: "Missing code parameter" });
    }

    try {
      const tokenResponse = await fetch("https://api.fyers.in/api/v3/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          appId: process.env.FYERS_CLIENT_ID,
          code: code,
          secret_key: process.env.FYERS_SECRET_ID,
          redirect_uri: process.env.FYERS_REDIRECT_URI
        }),
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.access_token) {
        // TODO: Save token securely (DB, cache, etc.)
        return res.status(200).json({ success: true, accessToken: tokenData.access_token });
      } else {
        return res.status(500).json({ success: false, error: tokenData });
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // -------------------------
  // OTHER BROKER HANDLING...
  // -------------------------
  // Keep your existing code for Upstox, Zerodha, etc. here exactly as before.
}
