export default async function handler(req, res) {
  const client_id = process.env.FYERS_CLIENT_ID;
  const secret = process.env.FYERS_SECRET_ID;
  const appIdHash = process.env.FYERS_APP_ID_HASH;

  console.log("ENV:", client_id, secret, appIdHash);

  if (!client_id || !secret || !appIdHash) {
    return res.status(500).json({ error: "Missing environment variables" });
  }

  // LOGIN ENDPOINT (Mobile starts auth flow)
  if (req.method === 'GET') {
    const { state } = req.query;

    if (!state) {
      return res.status(400).json({ success: false, error: "Missing state" });
    }

    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${client_id}&redirect_uri=https://fyers-redirect-9ubf.vercel.app/api/fyers/callback&response_type=code&state=${encodeURIComponent(state)}`;

    return res.status(200).json({
      success: true,
      authUrl,
    });
  }

  // CALLBACK ENDPOINT (called by Fyers after login)
  if (req.method === "GET") {
    const { code, auth_code } = req.query;

    const finalCode = auth_code || code;
    if (!finalCode) {
      return res.status(400).json({ success: false, error: "Missing code/auth_code" });
    }

    try {
      const response = await fetch("https://api-t1.fyers.in/api/v3/validate-authcode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          appIdHash,
          code: finalCode,
        }),
      });

      const data = await response.json();

      if (data.access_token) {
        const accessToken = data.access_token;

        // ✅ Redirect to Android app via deep link intent
        const androidRedirect = `intent://callback?access_token=${accessToken}#Intent;scheme=aistocksignal;package=com.aistocksignal;end;`;

        return res.redirect(androidRedirect);
      } else {
        return res.status(500).json({ success: false, error: data });
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // POST (optional: mobile exchange)
  if (req.method === "POST") {
    const { code, appIdHash: incomingHash } = req.body;

    if (!code || !incomingHash || incomingHash !== appIdHash) {
      return res.status(400).json({ success: false, error: "Invalid request body" });
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
        return res.status(500).json({ success: false, error: data });
      }
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  return res.status(404).json({ success: false, error: "Invalid route" });
}
