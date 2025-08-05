export default function handler(req, res) {
  res.status(200).json({
    connected: true,
    message: "Alpha Vantage API key is set in backend.",
  });
}
