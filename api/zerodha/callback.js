let zerodhaToken = null;

export function getZerodhaToken() {
  return zerodhaToken;
}

export default async function handler(req, res) {
  const { request_token } = req.query;

  if (!request_token) {
    return res.status(400).json({ success: false, error: "Missing request_token" });
  }

  try {
    const payload = new URLSearchParams();
    payload.append("api_key", process.env.ZERODHA_CLIENT_ID);
    payload.append("request_token", request_token);
    payload.append("secret", process.env.ZERODHA_CLIENT_SECRET);

    const response = await fetch("https://api.kite.trade/session/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: payload.toString(),
    });

    const data = await response.json();
    zerodhaToken = data.data?.access_token;

    res.status(200).json({ success: true, token: zerodhaToken });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
