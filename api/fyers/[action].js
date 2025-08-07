export default async function handler(req, res) {
  const method = req.method;

  const client_id = process.env.FYERS_CLIENT_ID;
  const secret = process.env.FYERS_SECRET_ID;
  const appIdHash = process.env.FYERS_APP_ID_HASH;

  console.log("ENV:", client_id, secret, appIdHash);  // ✅ LOG HERE

  if (!client_id || !secret || !appIdHash) {
    console.error("Missing env vars");
    return res.status(500).json({ error: "Missing environment variables" });
  }
  // LOGIN ENDPOINT: Generate Fyers Auth URL
  if (req.method === 'GET') {
    const { state } = req.query;

    if (!state) {
      return res.status(400).json({ success: false, error: "Missing state" });
    }

    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${appId}&redirect_uri=https://fyers-redirect-9ubf.vercel.app/api/fyers/callback&response_type=code&state=${encodeURIComponent(state)}`;

    return res.status(200).json({
      success: true,
      authUrl,
    });
  }

  // CALLBACK ENDPOINT: Handle both GET (browser) and POST (mobile) OAuth code exchange
  if (isCallback) {
    let codeFromClient;

    if (req.method === "GET") {
      const { code, state } = req.query;
      if (!code || !state) {
        return res.status(400).json({ success: false, error: "Missing code or state" });
      }
      codeFromClient = code;

    } else if (req.method === "POST") {
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
        return res.status(200).json({
          success: true,
          accessToken: data.access_token,
          refreshToken: data.refresh_token || null,
        });
      } else {
        return res.status(500).json({ success: false, error: data });
      }
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message || "Token exchange failed",
      });
    }
  }

  // Fallback for unmatched routes
  return res.status(404).json({ success: false, error: "Invalid route" });
}
