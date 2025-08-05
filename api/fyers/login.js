export default function handler(req, res) {
  const clientId = process.env.FYERS_CLIENT_ID;
  const redirectUri = process.env.FYERS_REDIRECT_URI;
  const state = "state123";

  const url = `https://api.fyers.in/api/v3/generate-authcode?client_id=${clientId}&redirect_uri=${encodeURIComponent(
    redirectUri
  )}&response_type=code&state=${state}`;

  res.redirect(url);
}
