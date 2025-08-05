export default function handler(req, res) {
  const clientId = process.env.UPSTOX_CLIENT_ID;
  const redirectUri = encodeURIComponent(process.env.UPSTOX_REDIRECT_URI);
  const state = "upstox-login";

  const url = `https://api.upstox.com/v2/login/authorization/dialog?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&state=${state}`;
  res.redirect(url);
}
