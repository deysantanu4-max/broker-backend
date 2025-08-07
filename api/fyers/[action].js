export default async function handler(req, res) {
  const { client_id, redirect_uri, appIdHash, code, state } = req.query;

  if (req.url.includes("/login")) {
    if (!client_id || !redirect_uri || !appIdHash) {
      return res.status(400).json({
        success: false,
        error: "Missing client_id, redirect_uri, or appIdHash",
      });
    }

    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${encodeURIComponent(
      client_id
    )}&redirect_uri=${encodeURIComponent(
      redirect_uri
    )}&response_type=code&state=${encodeURIComponent(appIdHash)}`;

    return res.redirect(authUrl);
  }

  if (req.url.includes("/callback")) {
    if (!code || !state) {
      return res.status(400).json({
        success: false,
        error: "Missing code or state",
      });
    }

    try {
      const tokenResponse = await fetch(
        "https://api-t1.fyers.in/api/v3/validate-authcode",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            appIdHash: state,
            code,
          }),
        }
      );

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

  return res.status(400).json({
    success: false,
    error: "Invalid route: use /login or /callback",
  });
}
