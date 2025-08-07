export default async function handler(req, res) {
  const isLogin = req.url.includes("/login");
  const isCallback = req.url.includes("/callback");

  // Redirect URI - must match the one registered in Fyers app settings
  const REDIRECT_URI = "https://fyers-redirect-9ubf.vercel.app/api/fyers/callback";

  // Load credentials from environment variables
  const client_id = process.env.FYERS_APP_ID;
  const secret = process.env.FYERS_SECRET;
  const appIdHash = process.env.FYERS_APP_ID_HASH;

  if (!client_id || !secret || !appIdHash) {
    return res.status(500).json({
      success: false,
      error: "Missing environment variables. Please check Vercel settings.",
    });
  }

  // === STEP 1: Redirect user to Fyers login ===
  if (isLogin) {
    const stateObj = { client_id, secret, appIdHash };
    const state = encodeURIComponent(JSON.stringify(stateObj));

    const authUrl =
      `https://api-t1.fyers.in/api/v3/generate-authcode` +
      `?client_id=${encodeURIComponent(client_id)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code` +
      `&state=${state}`;

    return res.redirect(authUrl);
  }

  // === STEP 2: Handle Fyers callback and exchange code ===
  if (isCallback) {
    let code;

    if (req.method === "GET") {
      const { code: queryCode, state } = req.query;

      if (!queryCode || !state) {
        return res.status(400).json({ success: false, error: "Missing code or state" });
      }

      try {
        // Optional: parse state, even though we already have credentials from env
        const parsed = JSON.parse(decodeURIComponent(state));
        code = queryCode;
      } catch (e) {
        return res.status(400).json({ success: false, error: "Invalid state format" });
      }
    } else {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    try {
      const response = await fetch("https://api-t1.fyers.in/api/v3/validate-authcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          appIdHash,
          code,
        }),
      });

      const data = await response.json();

      if (data.access_token) {
        return res.status(200).json({
          success: true,
          accessToken: data.access_token,
          refreshToken: data.refresh_token || null,
        });
      } else {
        return res.status(500).json({
          success: false,
          error: data,
        });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message || "Token exchange failed",
      });
    }
  }

  return res.status(400).json({
    success: false,
    error: "Invalid route",
  });
}
