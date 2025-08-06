export default async function handler(req, res) {
  const { action } = req.query;

  // -------------------------
  // FYERS LOGIN (v3)
  // -------------------------
  if (action === "login") {
    const redirectUri = process.env.FYERS_REDIRECT_URI; // e.g. https://fyers-redirect-9ubf.vercel.app/api/fyers/callback
    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${process.env.FYERS_CLIENT_ID}&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&response_type=code&state=xyz123`;

    return res.redirect(authUrl);
  }

  // -------------------------
  // FYERS CALLBACK (v3)
  // -------------------------
  if (action === "callback") {
    const { code } = req.query;

    if (!code) {
      return res
        .status(400)
        .json({ success: false, error: "Missing code parameter" });
    }

    try {
      const tokenResponse = await fetch(
        "https://api-t1.fyers.in/api/v3/validate-authcode",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            appIdHash: process.env.FYERS_APP_ID_HASH, // SHA-256(client_id:secret_key)
            code: code
          }),
        }
      );

      const tokenData = await tokenResponse.json();

      if (tokenData.access_token) {
        // TODO: Save token securely (DB, cache, etc.)
        return res.status(200).json({
          success: true,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token
        });
      } else {
        return res.status(500).json({ success: false, error: tokenData });
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // -------------------------
  // INVALID ACTION
  // -------------------------
  return res
    .status(400)
    .json({ success: false, error: "Invalid Fyers action" });
}
