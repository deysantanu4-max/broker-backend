import axios from "axios";

let upstoxToken = null;

export function getUpstoxToken() {
  return upstoxToken;
}

export default async function handler(req, res) {
  const { code } = req.query;

  try {
    const response = await axios.post(
      "https://api.upstox.com/v2/login/authorization/token",
      {
        client_id: process.env.UPSTOX_CLIENT_ID,
        client_secret: process.env.UPSTOX_CLIENT_SECRET,
        redirect_uri: process.env.UPSTOX_REDIRECT_URI,
        grant_type: "authorization_code",
        code: code,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    upstoxToken = response.data.access_token;
    res.status(200).json({ success: true, token: upstoxToken });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
