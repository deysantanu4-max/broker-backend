export default async function handler(req, res) {
  const method = req.method;
  const path = req.url || "";

  const client_id = process.env.FYERS_CLIENT_ID;
  const secret = process.env.FYERS_SECRET_ID;
  const appIdHash = process.env.FYERS_APP_ID_HASH;

  console.log("ENV:", client_id, secret, appIdHash);

  if (!client_id || !secret || !appIdHash) {
    console.error("❌ Missing environment variables");
    return res.status(500).json({ error: "Missing environment variables" });
  }

  const REDIRECT_URI = "https://fyers-redirect-9ubf.vercel.app/api/fyers/callback";

  // === LOGIN ENDPOINT ===
  if (path.includes("/login") && method === "GET") {
    const stateObj = { client_id, secret, appIdHash };
    const state = encodeURIComponent(JSON.stringify(stateObj));

    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${client_id}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&state=${state}`;

    return res.redirect(authUrl); // 🚀 Launches Fyers login

  }

  // === CALLBACK ENDPOINT ===
  if (path.includes("/callback")) {
    let codeFromClient;

    if (method === "GET") {
      const { auth_code, state } = req.query;

      if (!auth_code || !state) {
        return res.status(400).json({ success: false, error: "Missing auth_code or state" });
      }

      try {
        const parsedState = JSON.parse(decodeURIComponent(state));
        codeFromClient = auth_code;
        console.log("✅ Received auth_code:", codeFromClient);
      } catch (err) {
        return res.status(400).json({ success: false, error: "Invalid state format" });
      }

    } else if (method === "POST") {
      const body = req.body;

      if (!body || !body.code || !body.appIdHash) {
        return res.status(400).json({ success: false, error: "Missing POST body parameters" });
      }

      if (body.appIdHash !== appIdHash) {
        return res.status(403).json({ success: false, error: "Invalid appIdHash" });
      }

      codeFromClient = body.code;

    } else {
      return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    // Exchange code for access token
    try {
      const response = await fetch("https://api-t1.fyers.in/api/v3/validate-authcode", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grant_type: "authorization_code",
          appIdHash,
          code: codeFromClient,
        }),
      });

      const data = await response.json();

      if (data.access_token) {
        console.log("✅ Access Token Received");
        return res.status(200).json({
          success: true,
          accessToken: data.access_token,
          refreshToken: data.refresh_token || null,
        });
      } else {
        console.error("❌ Token exchange failed:", data);
        return res.status(500).json({ success: false, error: data });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message || "Token exchange failed",
      });
    }
  }

  // === Unknown route ===
  return res.status(404).json({ success: false, error: "Invalid route" });
}
