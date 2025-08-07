export default async function handler(req, res) {
  const { method, query, body, url } = req;

  const action = query.action; // expected: login or callback

  // ✅ Environment variables
  const client_id = process.env.FYERS_CLIENT_ID;
  const secret = process.env.FYERS_SECRET_ID;
  const appIdHash = process.env.FYERS_APP_ID_HASH;
  const redirect_uri = process.env.FYERS_REDIRECT_URI;

  console.log("ENV:", client_id, secret, appIdHash);

  if (!client_id || !secret || !appIdHash || !redirect_uri) {
    console.error("❌ Missing environment variables");
    return res.status(500).json({ success: false, error: "Missing environment variables" });
  }

  // === STEP 1: LOGIN - Generate Fyers Auth URL ===
  if (action === "login" && method === "GET") {
    const { state } = query;

    if (!state) {
      return res.status(400).json({ success: false, error: "Missing state" });
    }

    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${client_id}&redirect_uri=${encodeURIComponent(
      redirect_uri
    )}&response_type=code&state=${encodeURIComponent(state)}`;

    return res.status(200).json({ success: true, authUrl });
  }

  // === STEP 2: CALLBACK - Validate the auth code ===
  if (action === "callback") {
    let codeFromClient = null;

    if (method === "GET") {
      const { code, state } = query;

      if (!code || !state) {
        return res.status(400).json({ success: false, error: "Missing code or state" });
      }

      codeFromClient = code;
    } else if (method === "POST") {
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

    // ✅ Send code to Fyers
    console.log("Sending code to Fyers:", codeFromClient);

    try {
      const response = await fetch("https://api-t1.fyers.in/api/v3/validate-authcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          appIdHash,
          code: codeFromClient,
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
        console.error("❌ Fyers error:", data);
        return res.status(500).json({ success: false, error: data });
      }
    } catch (err) {
      console.error("❌ Token exchange failed:", err.message);
      return res.status(500).json({ success: false, error: err.message || "Token exchange failed" });
    }
  }

  // === Catch-all fallback ===
  return res.status(404).json({ success: false, error: "Invalid route" });
}
