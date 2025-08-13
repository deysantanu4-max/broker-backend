// api/angel/logout.js

import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const API_KEY = process.env.ANGEL_API_KEY;
  const ANGEL_API_BASE = "https://apiconnect.angelone.in";

  const { clientcode, token } = req.body;

  if (!clientcode || !token) {
    return res.status(400).json({ error: "Missing clientcode or token" });
  }

  const payload = {
    clientcode
  };

  try {
    const response = await axios({
      method: "post",
      url: `${ANGEL_API_BASE}/rest/secure/angelbroking/user/v1/logout`,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-UserType": "USER",
        "X-SourceID": "WEB",
        "X-ClientLocalIP": req.headers["x-forwarded-for"] || req.connection.remoteAddress || "127.0.0.1",
        "X-ClientPublicIP": req.headers["x-forwarded-for"] || req.connection.remoteAddress || "127.0.0.1",
        "X-MACAddress": "00:00:00:00:00:00",
        "X-PrivateKey": API_KEY
      },
      data: JSON.stringify(payload),
      validateStatus: () => true
    });

    console.log("Logout API response:", response.data);

    if (response.data?.status) {
      return res.status(200).json({
        status: "success",
        message: response.data.message || "Logout successful"
      });
    } else {
      return res.status(200).json({
        status: "error",
        message: response.data?.message || "Logout failed",
        details: response.data
      });
    }

  } catch (error) {
    console.error("Logout error:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message || "Internal server error"
    });
  }
}
