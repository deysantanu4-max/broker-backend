import { Router } from 'express';
import WebSocket from 'ws';
import { SmartAPI } from 'smartapi-javascript';
import otp from 'otplib';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

const API_KEY = process.env.ANGEL_MARKET_DATA_API_KEY;
const CLIENT_ID = process.env.ANGEL_CLIENT_ID;
const PASSWORD = process.env.ANGEL_PASSWORD;
const TOTP_SECRET = process.env.ANGEL_TOTP_SECRET;

if (!API_KEY || !CLIENT_ID || !PASSWORD || !TOTP_SECRET) {
  console.error('❌ Missing required env vars for live data');
}

let authToken = null;
let feedToken = null;

const userData = new Map(); // clientCode -> { socket, liveData }

function generateCorrelationId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

async function angelLogin() {
  try {
    console.log('🔑 [LOGIN] Starting Angel market data login...');
    const smart_api = new SmartAPI({ api_key: API_KEY });

    const totp = otp.authenticator.generate(TOTP_SECRET);
    console.log(`📟 [LOGIN] Generated TOTP: ${totp} (masked: *****)`);

    const session = await smart_api.generateSession(CLIENT_ID, PASSWORD, totp);
    console.log('✅ [LOGIN] Login success');

    authToken = session.data.jwtToken;
    feedToken = session.data.feedToken;

    console.log(`📡 [LOGIN] JWT Token received (len=${authToken.length})`);
    console.log(`📡 [LOGIN] FeedToken: ${feedToken}`);

    return { authToken, feedToken };
  } catch (err) {
    console.error('❌ [LOGIN] Angel login failed:', err.message || err);
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
      console.log('[STREAM] No feedToken, logging in...');
      await angelLogin();
    } else {
      console.log('[STREAM] Using existing feedToken');
    }

    const clientCode = CLIENT_ID;

    if (userData.has(clientCode)) {
      console.log(`[STREAM] Closing existing WebSocket for ${clientCode}`);
      const existing = userData.get(clientCode);
      if (existing.socket) existing.socket.close();
      userData.delete(clientCode);
    }

    const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${clientCode}&feedToken=${feedToken}&apiKey=${API_KEY}`;
    console.log(`[STREAM] Connecting WebSocket to: ${wsUrl}`);

    const userSocket = new WebSocket(wsUrl);
    const liveData = {};

    userSocket.on('open', () => {
      console.log(`✅ [WS-OPEN] Connected for ${clientCode}`);

      const subscriptionReq = {
        correlationID: generateCorrelationId(),
        action: 1,
        params: {
          mode: 1, // LTP
          tokenList: [
            { exchangeType: 1, tokens }
          ]
        }
      };

      console.log(`[WS-SEND] Subscription payload:`, subscriptionReq);
      userSocket.send(JSON.stringify(subscriptionReq));

      setInterval(() => {
        console.log(`[WS-PING] Sending heartbeat`);
        userSocket.send("ping");
      }, 30000);
    });

    userSocket.on('message', (data) => {
      if (data.toString() === "pong") {
        console.log(`[WS-PONG] Heartbeat received`);
        return;
      }

      if (Buffer.isBuffer(data)) {
        console.log(`[WS-DATA] Binary tick received (${data.length} bytes)`);
        try {
          const buf = Buffer.from(data);
          const token = buf.slice(2, 27).toString('utf8').replace(/\0/g, '');
          const ltp = buf.readInt32LE(43) / 100;
          console.log(`[WS-TICK] Token=${token} LTP=${ltp}`);
          liveData[token] = { token, ltp, updatedAt: Date.now() };
        } catch (err) {
          console.error(`[WS-ERROR] Failed to parse binary tick:`, err);
        }
      } else {
        try {
          const jsonMsg = JSON.parse(data);
          console.log(`[WS-JSON] Message:`, jsonMsg);
        } catch {
          console.log(`[WS-TEXT] Message: ${data.toString()}`);
        }
      }
    });

    userSocket.on('error', (err) => {
      console.error(`❌ [WS-ERROR] WebSocket error:`, err);
    });

    userSocket.on('close', (code, reason) => {
      console.warn(`🔌 [WS-CLOSE] Closed code=${code} reason=${reason}`);
      userData.delete(clientCode);
    });

    userData.set(clientCode, { socket: userSocket, liveData });

    console.log(`[STREAM] WebSocket session stored for ${clientCode}`);
    res.json({ message: `WebSocket started for ${clientCode}`, tokens });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start live stream', details: err.message });
  }
});

// GET /angel/live/prices
// GET /angel/live/prices
router.get('/prices', (req, res) => {
  const clientCode = CLIENT_ID;
  const user = userData.get(clientCode);

  if (!user) {
    console.warn(`[PRICES] No active stream for ${clientCode}`);
    // Always return 200 OK with empty JSON object instead of 404 HTML
    return res.json({});
  }

  console.log(`[PRICES] Sending ${Object.keys(user.liveData).length} instruments`);
  res.json(user.liveData || {});
});

export default router;
