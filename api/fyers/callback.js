let fyersAccessToken = null;

export default async function handler(req, res) {
  const code = req.query.code;
  const clientId = process.env.FYERS_CLIENT_ID;
  const secretId = process.env.FYERS_SECRET_ID;
  const redirectUri = process.env.FYERS_REDIRECT_URI;

  try {
    const payload = {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      secret_key: secretId,
      redirect_uri: redirectUri,
    };

    const response = await fetch("https://api.fyers.in/api/v3/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.access_token) {
      fyersAccessToken = data.access_token;
      res.status(200).json({ success: true, access_token: fyersAccessToken });
    } else {
      res.status(400).json({ success: false, error: data });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export function getFyersToken() {
  return fyersAccessToken;
}
