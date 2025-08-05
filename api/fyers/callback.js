import axios from "axios";

let fyersToken = null;

export function getFyersToken() {
  return fyersToken;
}

export default async function handler(req, res) {
  const { code } = req.query;

  const response = await axios.post("https://api.fyers.in/api/v2/token", {
    client_id: process.env.FYERS_CLIENT_ID,
    secret_key: process.env.FYERS_SECRET_ID,
    grant_type: "authorization_code",
    code,
  });

  fyersToken = response.data.access_token;
  res.status(200).json({ success: true, token: fyersToken });
}
