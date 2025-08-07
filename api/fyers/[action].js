// pages/api/fyers/[action].js
import { MongoClient } from "mongodb";

const REDIRECT_URI = "https://fyers-redirect-9ubf.vercel.app/api/fyers/callback";
const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = "fyersdb";
const COLLECTION = "tokens";

async function getDb() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  return client.db(DB_NAME).collection(COLLECTION);
}

export default async function handler(req, res) {
  const path = req.url || "";
  const method = req.method;

  const client_id = process.env.FYERS_CLIENT_ID;
  const secret = process.env.FYERS_SECRET_ID;
  const appIdHash = process.env.FYERS_APP_ID_HASH;

  if (!client_id || !secret || !appIdHash || !MONGO_URI) {
    return res.status(500).json({ error: "Missing environment variables" });
  }

  const tokenCollection = await getDb();

  // === LOGIN ===
  if (path.includes("/login") && method === "GET") {
    const stateObj = { client_id, secret, appIdHash };
    const state = encodeURIComponent(JSON.stringify(stateObj));

    const authUrl = `https://api-t1.fyers.in/api/v3/generate-authcode?client_id=${client_id}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&state=${state}`;

    return res.redirect(authUrl);
  }

  // === CALLBACK ===
  if (path.includes("/callback")) {
    let code;

    if (method === "GET") {
      const { auth_code, state } = req.query;
      if (!auth_code || !state) {
        return res.status(400).json({ error: "Missing auth_code or state" });
      }
      code = auth_code;
    } else if (method === "POST") {
      const body = req.body;
      if (!body?.code || body.appIdHash !== appIdHash) {
        return res.status(403).json({ error: "Invalid or missing code/appIdHash" });
      }
      code = body.code;
    } else {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const response = await fetch("https://api-t1.fyers.in/api/v3/validate-authcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", appIdHash, code }),
    });
    const data = await response.json();

    if (!data.access_token) {
      return res.status(500).json({ error: "Token exchange failed", detail: data });
    }

    // Save to DB
    await tokenCollection.updateOne(
      { client_id },
      {
        $set: {
          client_id,
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return res.status(200).json({ success: true, accessToken: data.access_token });
  }

  // === FETCH HISTORICAL DATA ===
  if (path.includes("/historical") && method === "GET") {
    const { symbol, resolution, from, to } = req.query;

    if (!symbol || !resolution || !from || !to) {
      return res.status(400).json({ error: "Missing query parameters" });
    }

    const tokenDoc = await tokenCollection.findOne({ client_id });
    if (!tokenDoc?.access_token) {
      return res.status(401).json({ error: "Access token not found" });
    }

    const dataResponse = await fetch(
      `https://api.fyers.in/data-rest/v2/history/?symbol=${symbol}&resolution=${resolution}&date_format=1&range_from=${from}&range_to=${to}&cont_flag=1`,
      {
        headers: {
          Authorization: `Bearer ${tokenDoc.access_token}`,
        },
      }
    );

    const historicalData = await dataResponse.json();
    return res.status(200).json(historicalData);
  }

  // === LOGOUT ===
  if (path.includes("/logout") && method === "POST") {
    await tokenCollection.deleteOne({ client_id });
    return res.status(200).json({ success: true, message: "Logged out" });
  }

  return res.status(404).json({ error: "Invalid route" });
}
