// api/angel/live.js
import { WebSocket } from "ws";
import fetch from "node-fetch";
import path from "path";

// Import ScripMaster directly (make sure it's in project root, not /public)
import scripMaster from "../../ScripMaster.json" assert { type: "json" };

let stream = null;
let feedToken = null;
let tokenMaps = { NSE: {}, BSE: {} };
let groupedTokens = { NSE: [], BSE: [] };

// ---- Load & Build Token Maps ----
function buildTokenMaps() {
  console.log(`📥 Loaded ScripMaster locally: ${scripMaster.length} instruments`);

  tokenMaps = { NSE: {}, BSE: {} };
  groupedTokens = { NSE: [], BSE: [] };

  for (const item of scripMaster) {
    const exch = item.exch?.toUpperCase();
    if (!["NSE", "BSE"].includes(exch)) continue;

    const symbol = item.symbol?.toUpperCase();
    const token = item.token;

    if (symbol && token) {
      tokenMaps[exch][symbol] = token;
    }
  }

  console.log(
    `✅ Built token maps: ${Object.keys(tokenMaps.NSE).length} (NSE EQ), ${Object.keys(
      tokenMaps.BSE
    ).length} (BSE EQ)`
  );
}

// ---- AngelOne login ----
async function loginAngel() {
  console.log("🔑 Logging in to AngelOne…");
  const res = await fetch("https://apiconnect.angelbroking.com/rest/auth/angelbroking/jwt/v1/generateToken", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-ClientLocalIP": "127.0.0.1",
      "X-ClientPublicIP": "127.0.0.1",
      "X-MACAddress": "xx:xx:xx:xx:xx:xx",
      "X-PrivateKey": process.env.ANGEL_API_KEY,
    },
    body: JSON.stringify({
      clientcode: process.env.ANGEL_CLIENT_CODE,
      password: process.env.ANGEL_PASSWORD,
      totp: process.env.ANGEL_TOTP,
    }),
  });

  const data = await res.json();
  feedToken = data?.data?.feedToken;
  console.log(`✅ Logged in, feedToken cached until ${new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString()}`);
  return feedToken;
}

// ---- Subscription builder ----
function buildSubscription(type, exchange) {
  if (type === "indices") {
    // Keep your existing indices subscription untouched
    return [
      { exch: "NSE", token: "999920000" }, // Nifty 50
      { exch: "NSE", token: "999920005" }, // BankNifty
      { exch: "NSE", token: "999920019" }, // FINNIFTY
    ];
  }

  if (type === "top25") {
    const top25NSE = [
      "RELIANCE","TCS","INFY","HDFCBANK","ICICIBANK","SBIN","HINDUNILVR","KOTAKBANK","LT","BHARTIARTL",
      "AXISBANK","BAJFINANCE","ITC","WIPRO","ASIANPAINT","ULTRACEMCO","MARUTI","SUNPHARMA","HCLTECH","POWERGRID",
      "TITAN","NTPC","ONGC","JSWSTEEL","ADANIPORTS"
    ];

    const top25BSE = [
      "RELIANCE","HDFCBANK","INFY","ICICIBANK","SBIN","TCS","KOTAKBANK","HINDUNILVR","BHARTIARTL","BAJFINANCE",
      "ITC","AXISBANK","LT","WIPRO","ASIANPAINT","ULTRACEMCO","MARUTI","SUNPHARMA","HCLTECH","POWERGRID",
      "TITAN","NTPC","ONGC","JSWSTEEL","ADANIPORTS"
    ];

    const list = exchange === "BSE" ? top25BSE : top25NSE;

    const subs = [];
    for (const sym of list) {
      const token = tokenMaps[exchange]?.[sym];
      if (token) {
        subs.push({ exch: exchange, token });
      } else {
        console.log(`⚠️ No token found for ${exchange}:${sym}`);
      }
    }

    console.log(`🔎 Built grouped token list for ${exchange}: ${subs.length} symbols`);
    return subs;
  }

  return [];
}

// ---- Handler ----
export default async function handler(req, res) {
  const { type = "indices", exchange = "NSE" } = req.query;
  console.log(`📩 /api/angel/live hit GET /api/angel/live?type=${type}&exchange=${exchange}`);

  if (!feedToken) {
    buildTokenMaps();
    await loginAngel();
  }

  const subs = buildSubscription(type, exchange.toUpperCase());

  if (!subs.length) {
    console.log(`🟢 GET ${type} (${exchange}) -> 0 items`);
    return res.status(200).json([]);
  }

  // Lazy stream init
  if (!stream) {
    console.log(`⏯️ Stream not active — starting (lazy) for ${exchange}`);
    stream = new WebSocket("wss://smartapisocket.angelone.in/smart-stream");

    stream.on("open", () => {
      console.log("🟢 WebSocket connected, sending subscription");
      const payload = {
        correlationID: "top25-sub",
        action: 1,
        params: {
          mode: 1,
          tokenList: subs,
        },
      };
      stream.send(JSON.stringify(payload));
    });

    stream.on("message", (msg) => {
      console.log("📊 Tick:", msg.toString());
    });

    stream.on("error", (err) => {
      console.error("❌ Stream error:", err);
    });

    stream.on("close", () => {
      console.log("🔴 WebSocket closed");
      stream = null;
    });
  }

  console.log(`🟢 GET ${type} (${exchange}) -> ${subs.length} items`);
  res.status(200).json(subs);
}
