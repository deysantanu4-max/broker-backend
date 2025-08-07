export default async function handler(req, res) {
  const { code, state } = req.query;

  // FYERS LOGIN
  if (req.url.includes("/login")) {
    const { client_id, secret, redirect_uri, appIdHash } = req.query;

    if (!client_id || !secret || !redirect_uri || !appIdHash) {
      return res.status(400).json({
        success: false,
        error: "Missing client_id, secret, redirect_uri, or appIdHash",
      });
    }

    const stateObj = {
      appIdHash,
      client_id,
      secret,
      redirect_uri,
    };

    const stateStr = encodeURIComponent(JSON.stringify(stateObj));

    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode` +
      `?client_id=${encodeURIComponent(client_id)}` +
      `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
      `&response_type=code` +
      `&state=${stateStr}`;

    return res.redirect(authUrl);
  }

  // FYERS CALLBACK
  if (req.url.includes("/callback")) {
    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: "Missing code or state",
      });
    }

    let parsedState;
    try {
      parsedState = JSON.parse(decodeURIComponent(state));
    } catch {
      return res.status(400).json({
        success: false,
        error: "Invalid state format",
      });
    }

    const { appIdHash, client_id, secret, redirect_uri } = parsedState;

    if (!client_id || !secret || !redirect_uri) {
      return res.status(400).json({
        success: false,
        error: "Missing values in state",
      });
    }

    try {
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
    error: "Invalid route: use /login or /callback",
  });
}
