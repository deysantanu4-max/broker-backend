export default async function handler(req, res) {
  const { code, state } = req.query;

  // === FYERS LOGIN STEP ===
  if (req.url.includes("/login")) {
    const { client_id, secret, appIdHash } = req.query;

    // ⚠️ This must exactly match what you saved in Fyers dashboard!
    const redirect_uri = "https://fyers-redirect-9ubf.vercel.app/api/fyers/callback";

    if (!client_id || !secret || !appIdHash) {
      return res.status(400).json({
        success: false,
        error: "Missing client_id, secret, or appIdHash",
      });
    }

    const stateObj = {
      appIdHash,
      client_id,
      secret
    };

    const stateStr = encodeURIComponent(JSON.stringify(stateObj));

    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode` +
      `?client_id=${encodeURIComponent(client_id)}` +
      `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
      `&response_type=code` +
      `&state=${stateStr}`;

    return res.redirect(authUrl);
  }

  // === FYERS TOKEN STEP ===
  if (req.method === "GET" && req.url.includes("/callback")) {
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

    const { appIdHash, client_id, secret } = parsedState;

    if (!client_id || !secret || !appIdHash) {
      return res.status(400).json({
        success: false,
        error: "Missing values in state",
      });
    }

    try {
      const tokenRes = await fetch("https://api-t1.fyers.in/api/v3/validate-authcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          appIdHash,
          code
        })
      });

      const tokenData = await tokenRes.json();

      if (tokenData.access_token) {
        return res.status(200).json({
          success: true,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token
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
        error: err.message || "Token request failed"
      });
    }
  }

  // === Invalid fallback ===
  return res.status(400).json({
    success: false,
    error: "Invalid route: use /login (GET) or /callback (GET)"
  });
}
