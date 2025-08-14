import { Router } from 'express';
import WebSocket from 'ws';
import { SmartAPI } from 'smartapi-javascript';
import otp from 'otplib';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

// Use the market data API key from Vercel
const API_KEY = process.env.ANGEL_MARKET_DATA_API_KEY;
const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const PASSWORD = process.env.ANGEL_PASSWORD;
const TOTP_SECRET = process.env.ANGEL_TOTP_SECRET;

if (!API_KEY || !CLIENT_ID || !PASSWORD || !TOTP_SECRET) {
  console.error('❌ Missing required env vars for live data');
}

let authToken = null;
let feedToken = null;

// Store per-user tick data and sockets
const userData = new Map(); // clientCode -> { socket, liveData }

function generateCorrelationId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Login to Angel API & get feed token
async function angelLogin() {
  try {
    console.log('🔑 Logging in to Angel API for market data...');
    const smart_api = new SmartAPI({ api_key: API_KEY });
    const totp = otp.authenticator.generate(TOTP_SECRET);
    const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);

    authToken = session.data.jwtToken;
    feedToken = session.data.feedToken;

    console.log('✅ Angel login successful for market data');
    return { authToken, feedToken };
  } catch (err) {
    console.error('❌ Angel login failed:', err.message || err);
    throw err;
  }
}

// POST /angel/live/stream
router.post('/stream', async (req, res) => {
  console.log(`[REQ] POST /angel/live/stream body:`, req.body);

  const { tokens } = req.body;

  if (!tokens || !tokens.length) {
    return res.status(400).json({ error: 'Missing tokens array' });
  }

  try {
    if (!feedToken) {
      await angelLogin();
    }

    const clientCode = CLIENT_ID; // Using our own account
    if (userData.has(clientCode)) {
      console.log(`[INFO] Closing existing WebSocket for ${clientCode}`);
      const existing = userData.get(clientCode);
      if (existing.socket) existing.socket.close();
      userData.delete(clientCode);
    }

    const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${clientCode}&feedToken=${feedToken}&apiKey=${API_KEY}`;
    console.log(`[CONNECT] Connecting to: ${wsUrl}`);

    const userSocket = new WebSocket(wsUrl);
    const liveData = {};

    userSocket.on('open', () => {
      console.log(`✅ [OPEN] WebSocket connected for ${clientCode}`);

      const subscriptionReq = {
        correlationID: generateCorrelationId(),
        action: 1,
        params: {
          mode: 1, // LTP mode
          tokenList: [
            { exchangeType: 1, tokens } // NSE tokens
          ]
        }
      };

      console.log(`[SEND] Subscription payload for ${clientCode}:`, subscriptionReq);
      userSocket.send(JSON.stringify(subscriptionReq));

      setInterval(() => {
        console.log(`[PING] Sending heartbeat for ${clientCode}`);
        userSocket.send("ping");
      }, 30000);
    });

    userSocket.on('message', (data) => {
      if (data.toString() === "pong") {
        console.log(`[PONG] Heartbeat received from ${clientCode}`);
        return;
      }

      if (Buffer.isBuffer(data)) {
        try {
          const buf = Buffer.from(data);
          const token = buf.slice(2, 27).toString('utf8').replace(/\0/g, '');
          const ltp = buf.readInt32LE(43) / 100;
          console.log(`[TICK] Token=${token} LTP=${ltp}`);
          liveData[token] = { token, ltp, updatedAt: Date.now() };
        } catch (err) {
          console.error(`[ERROR] Failed to parse binary tick:`, err);
        }
      } else {
        try {
          const jsonMsg = JSON.parse(data);
          console.log(`[JSON]`, jsonMsg);
        } catch {
          console.log(`[TEXT]`, data.toString());
        }
      }
    });

    userSocket.on('error', (err) => {
      console.error(`❌ [ERROR] WebSocket error:`, err);
    });

    userSocket.on('close', (code, reason) => {
      console.warn(`🔌 [CLOSE] WebSocket closed code=${code} reason=${reason}`);
      userData.delete(clientCode);
    });

    userData.set(clientCode, { socket: userSocket, liveData });

    console.log(`[STATE] WebSocket session stored for ${clientCode}`);
    res.json({ message: `WebSocket started for ${clientCode}`, tokens });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start live stream', details: err.message });
  }
});

// GET /angel/live/prices
router.get('/prices', (req, res) => {
  const clientCode = CLIENT_ID;
  const user = userData.get(clientCode);
  if (!user) {
    return res.status(404).json({ error: 'No active stream for this client' });
  }
  res.json(user.liveData);
});

export default router;
