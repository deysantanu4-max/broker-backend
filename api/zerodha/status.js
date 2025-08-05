import { getZerodhaToken } from "./callback";

export default function handler(req, res) {
  const token = getZerodhaToken();

  if (token) {
    res.status(200).json({
      connected: true,
      broker: "Zerodha",
      message: "Zerodha token is stored in backend (in memory)."
    });
  } else {
    res.status(200).json({
      connected: false,
      broker: "Zerodha",
      message: "User is not logged in to Zerodha yet."
    });
  }
}
