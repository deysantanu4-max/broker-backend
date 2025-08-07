export default async function handler(req, res) {
  const { action } = req.query;

  // -------------------------
  // FYERS LOGIN (just redirect)
  // -------------------------
  if (action === "login") {
    const { client_id, redirect_uri, appIdHash } = req.query;

    if (!client_id || !redirect_uri || !appIdHash) {
      return res.status(400).json({ success: false, error: "Missing required parameters" });
    }

    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${client_id}&redirect_uri=${encodeURIComponent(
      redirect_uri
    )}&response_type=code&state=${appIdHash}`; // Using state to pass hash (optional)

    return res.redirect(authUrl);
  }

  // -------------------------
  // FYERS CALLBACK
  // -------------------------
  if (action === "callback") {
    const { code, state } = req.query; // 'state' is appIdHash
    const appIdHash = state;

    if (!code || !appIdHash) {
      return res.status(400).json({ success: false, error: "Missing code or appIdHash" });
    }

    try {
      const tokenResponse = await fetch(
        "https://api-t1.fyers.in/api/v3/validate-authcode",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            appIdHash: appIdHash,
            code: code,
          }),
        }
      );

      const tokenData = await tokenResponse.json();

      if (tokenData.access_token) {
        return res.status(200).json({
          success: true,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
        });
      } else {
        return res.status(500).json({ success: false, error: tokenData });
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(400).json({ success: false, error: "Invalid Fyers action" });
}
