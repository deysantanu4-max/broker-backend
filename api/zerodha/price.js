export default function handler(req, res) {
  const symbol = req.query.symbol || "Unknown";

  return res.status(200).json({
    symbol,
    price: 2742.55,
    status: "Success",
    note: "This is a test response"
  });
}
