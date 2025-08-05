export default function handler(req, res) {
  const clientId = process.env.ZERODHA_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.ZERODHA_REDIRECT_URI);
  const state = "zerodha-login";

  const url = `https://kite.zerodha.com/connect/login?v=3&api_key=${clientId}&redirect_uri=${redirectUri}&state=${state}`;
  res.redirect(url);
}
