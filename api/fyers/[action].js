export default async function handler(req, res) {
  const isLogin = req.url.includes("/login");
  const isCallback = req.url.includes("/callback");

  const REDIRECT_URI = "https://fyers-redirect-9ubf.vercel.app/api/fyers/callback";

  // === FYERS LOGIN STEP ===
  if (isLogin) {
    const { client_id, secret, appIdHash } = req.query;

    if (!client_id || !secret || !appIdHash) {
      return res.status(400).json({
        success: false,
        error: "Missing client_id, secret, or appIdHash",
      });
    }

    const stateObj = { client_id, secret, appIdHash };
    const state = encodeURIComponent(JSON.stringify(stateObj));

    const authUrl =
      `https://api-t1.fyers.in/api/v3/generate-authcode` +
      `?client_id=${encodeURIComponent(client_id)}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code` +
      `&state=${state}`;

    console.log("🔐 Redirecting to Fyers login:", authUrl);

    return res.redirect(authUrl);
  }

  // === FYERS CALLBACK TOKEN EXCHANGE ===
  if (isCallback) {
    console.log("🔁 Incoming callback hit");
    console.log("Request method:", req.method);
    console.log("Query:", req.query);

    let code, client_id, secret, appIdHash;

    if (req.method === "GET") {
      const { code: queryCode, state } = req.query;

      if (!queryCode || !state) {
        return res.status(400).json({ success: false, error: "Missing code or state" });
      }

      try {
        const parsed = JSON.parse(decodeURIComponent(state));
        client_id = parsed.client_id;
        secret = parsed.secret;
        appIdHash = parsed.appIdHash;
        code = queryCode;
        console.log("✅ Extracted from GET state:", { client_id, secret, appIdHash, code });
      } catch (e) {
        console.error("❌ Error parsing state:", e);
        return res.status(400).json({ success: false, error: "Invalid state" });
      }
    } else if (req.method === "POST") {
      try {
        const body = await req.json();
        ({ code, client_id, secret, appIdHash } = body);

        if (!code || !client_id || !secret || !appIdHash) {
          return res.status(400).json({ success: false, error: "Missing values in body" });
        }

        console.log("✅ Extracted from POST body:", { code, client_id, secret, appIdHash });
      } catch (e) {
        console.error("❌ Invalid JSON body:", e);
        return res.status(400).json({ success: false, error: "Invalid JSON body" });
      }
    } else {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    try {
      const payload = {
        grant_type: "authorization_code",
        appIdHash,
        code
      };

      console.log("📤 Sending to Fyers /validate-authcode:", payload);

      const response = await fetch("https://api-t1.fyers.in/api/v3/validate-authcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      console.log("📥 Fyers response:", data);

      if (data.access_token) {
        return res.status(200).json({
          success: true,
          accessToken: data.access_token,
          refreshToken: data.refresh_token || null
        });
      } else {
        return res.status(500).json({
          success: false,
          error: data,
        });
      }
    } catch (err) {
      console.error("❌ Token exchange failed:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Token exchange failed",
      });
    }
  }

  // === Invalid Route Fallback ===
  return res.status(400).json({
    success: false,
    error: "Invalid route",
  });
}
