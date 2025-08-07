export default async function handler(req, res) {
  const { code, state } = req.query;

  // FYERS LOGIN (Redirects to Fyers login page)
  if (req.url.includes("/login")) {
    const { client_id, secret, appIdHash } = req.query;

    const redirect_uri = "https://trade.fyers.in/api-login/redirect-uri/index.html"; // ✅ fixed as per Fyers docs

    if (!client_id || !secret || !appIdHash) {
      return res.status(400).json({
        success: false,
        error: "Missing client_id, secret, or appIdHash",
      });
    }

    const stateObj = {
      appIdHash,
      client_id,
      secret,
      redirect_uri,
    };

    const stateStr = encodeURIComponent(JSON.stringify(stateObj));

    // ✅ Fyers-approved login endpoint
    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode` +
      `?client_id=${encodeURIComponent(client_id)}` +
      `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
      `&response_type=code` +
      `&state=${stateStr}`;

    return res.redirect(authUrl);
  }

  // FYERS TOKEN EXCHANGE (Manually triggered from app using code)
  if (req.method === "POST" && req.url.includes("/callback")) {
    try {
      const { code, appIdHash, client_id, secret } = req.body;

      const redirect_uri = "https://trade.fyers.in/api-login/redirect-uri/index.html"; // ✅ must match

      if (!code || !appIdHash || !client_id || !secret) {
        return res.status(400).json({
          success: false,
          error: "Missing required fields in POST body",
        });
      }

      const tokenResponse = await fetch("https://api-t1.fyers.in/api/v3/validate-authcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          appIdHash,
          code,
          client_id,
          secret,
          redirect_uri,
        }),
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.access_token) {
        return res.status(200).json({
          success: true,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
        });
      } else {
        return res.status(500).json({
          success: false,
          error: tokenData,
        });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message || "Unexpected error",
      });
    }
  }

  // Invalid route
  return res.status(400).json({
    success: false,
    error: "Invalid route: use /login (GET) or /callback (POST)",
  });
}
