import { getFyersToken } from "./callback";

export default function handler(req, res) {
  const token = getFyersToken();
  if (token) {
    res.status(200).json({ connected: true, token });
  } else {
    res.status(200).json({ connected: false });
  }
}
