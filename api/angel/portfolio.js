import axios from "axios";

let feedToken = "";
let authToken = "";

const API_KEY = process.env.ANGEL_API_KEY;
const CLIENT_CODE = process.env.ANGEL_CLIENT_CODE;
const PASSWORD = process.env.ANGEL_PASSWORD;
const TOTP = process.env.ANGEL_TOTP;

// Login (same style as historical.js)
async function angelLogin() {
  try {
    const loginResponse = await axios.post(
      "https://apiconnect.angelbroking.com/rest/auth/angelbroking/user/v1/loginByPassword",
      {
        clientcode: CLIENT_CODE,
        password: PASSWORD,
        totp: TOTP
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-UserType": "USER",
          "X-SourceID": "WEB",
          "X-ClientLocalIP": "127.0.0.1",
          "X-ClientPublicIP": "127.0.0.1",
          "X-MACAddress": "00:00:00:00:00:00",
          "X-PrivateKey": API_KEY
        }
      }
    );

    if (loginResponse.data.status === true) {
      feedToken = loginResponse.data.data.feedToken;
      authToken = loginResponse.data.data.jwtToken;
      console.log("Angel Login Successful");
    } else {
      throw new Error(loginResponse.data.message || "Login failed");
    }
  } catch (error) {
    console.error("Angel Login Error:", error.response?.data || error.message);
    throw error;
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      if (!authToken) {
        await angelLogin();
      }

      // Fetch Holdings
      const holdings = await axios.get(
        "https://apiconnect.angelbroking.com/rest/secure/angelbroking/portfolio/v1/getPortfolioHoldings",
        {
          headers: {
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1",
            "X-MACAddress": "00:00:00:00:00:00",
            "X-PrivateKey": API_KEY
          }
        }
      );

      // Fetch Positions
      const positions = await axios.get(
        "https://apiconnect.angelbroking.com/rest/secure/angelbroking/portfolio/v1/getPortfolioPositions",
        {
          headers: {
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1",
            "X-MACAddress": "00:00:00:00:00:00",
            "X-PrivateKey": API_KEY
          }
        }
      );

      res.status(200).json({
        holdings: holdings.data,
        positions: positions.data
      });

    } catch (error) {
      console.error("Portfolio Fetch Error:", error.response?.data || error.message);
      res.status(500).json({
        message: "Error fetching portfolio",
        error: error.response?.data || error.message
      });
    }
  } else if (req.method === "POST") {
    // Convert Position
    try {
      const { symboltoken, exchange, transactiontype, positiontype, producttype, quantity } = req.body;

      if (!authToken) {
        await angelLogin();
      }

      const convertResponse = await axios.post(
        "https://apiconnect.angelbroking.com/rest/secure/angelbroking/portfolio/v1/convertPosition",
        {
          symboltoken,
          exchange,
          transactiontype,
          positiontype,
          producttype,
          quantity
        },
        {
          headers: {
            "Authorization": `Bearer ${authToken}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "127.0.0.1",
            "X-MACAddress": "00:00:00:00:00:00",
            "X-PrivateKey": API_KEY
          }
        }
      );

      res.status(200).json(convertResponse.data);

    } catch (error) {
      console.error("Convert Position Error:", error.response?.data || error.message);
      res.status(500).json({
        message: "Error converting position",
        error: error.response?.data || error.message
      });
    }
  } else {
    res.status(405).json({ message: "Method Not Allowed" });
  }
}
