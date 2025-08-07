export default async function handler(req, res) {
  const isLogin = req.url.includes("/login");
  const isCallback = req.url.includes("/callback");

  // === FYERS LOGIN STEP ===
  if (isLogin) {
    const { client_id, secret, appIdHash } = req.query;

    const redirect_uri = "https://fyers-redirect-9ubf.vercel.app/api/fyers/callback";

    if (!client_id || !secret || !appIdHash) {
      return res.status(400).json({
        success: false,
        error: "Missing client_id, secret, or appIdHash",
      });
    }

    const stateObj = { appIdHash, client_id, secret };
    const stateStr = encodeURIComponent(JSON.stringify(stateObj));

    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode` +
      `?client_id=${encodeURIComponent(client_id)}` +
      `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
      `&response_type=code` +
      `&state=${stateStr}`;

    return res.redirect(authUrl);
  }

  // === FYERS CALLBACK TOKEN EXCHANGE ===
  if (isCallback) {
    let code, client_id, secret, appIdHash;

    // Support both GET with state or POST with raw body
    if (req.method === "GET") {
      const { state, code: queryCode } = req.query;
      if (!state || !queryCode) {
        return res.status(400).json({ success: false, error: "Missing code or state" });
      }

      try {
        const parsedState = JSON.parse(decodeURIComponent(state));
        client_id = parsedState.client_id;
        secret = parsedState.secret;
        appIdHash = parsedState.appIdHash;
        code = queryCode;
      } catch {
        return res.status(400).json({ success: false, error: "Invalid state format" });
      }

    } else if (req.method === "POST") {
      try {
        const body = await req.json();
        ({ code, client_id, secret, appIdHash } = body);

        if (!code || !client_id || !secret || !appIdHash) {
          return res.status(400).json({ success: false, error: "Missing values in body" });
        }

      } catch {
        return res.status(400).json({ success: false, error: "Invalid JSON in request body" });
      }

    } else {
      return res.status(405).json({ success: false, error: "Method not allowed" });
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
          refreshToken: tokenData.refresh_token || null
        });
      } else {
        return res.status(500).json({ success: false, error: tokenData });
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
    error: "Invalid route: use /login (GET) or /callback (GET/POST)"
  });
}
