export default function handler(req, res) {
  const clientId = process.env.FYERS_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.FYERS_REDIRECT_URI);
  const state = "fyers-login";

  const url = `https://api.fyers.in/api/v2/generate-authcode?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${state}`;
  res.redirect(url);
}
