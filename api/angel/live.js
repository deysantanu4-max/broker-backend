import { Router } from 'express';
import WebSocket from 'ws';

const router = Router();
const API_KEY = process.env.ANGEL_API_KEY;

if (!API_KEY) {
  console.error('❌ Missing API key in env (ANGEL_API_KEY)');
}

// Store per-user tick data and sockets
const userData = new Map(); // clientCode -> { socket, liveData }

function generateCorrelationId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 10 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
}

const exchangeMap = {
  NSE: 1,
  BSE: 3,
  MCX: 2,
  NFO: 4
};

// POST /angel/live/stream
router.post('/stream', (req, res) => {
  console.log(`[REQ] POST /angel/live/stream body:`, req.body);

  const { clientCode, feedToken, tokens, exchange } = req.body;

  if (!clientCode || !feedToken || !tokens || !tokens.length || !exchange) {
    return res.status(400).json({ error: 'Missing clientCode, feedToken, exchange, or tokens' });
  }

  const exchangeType = exchangeMap[exchange.toUpperCase()] || 1;

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
          { exchangeType, tokens }
        ]
      }
    };

    userSocket.send(JSON.stringify(subscriptionReq));

    setInterval(() => {
      userSocket.send("ping");
    }, 30000);
  });

  userSocket.on('message', (data) => {
    if (data.toString() === "pong") return;
    if (Buffer.isBuffer(data)) {
      try {
        const buf = Buffer.from(data);
        const token = buf.slice(2, 27).toString('utf8').replace(/\0/g, '');
        const ltp = buf.readInt32LE(43) / 100;
        liveData[token] = { token, ltp, updatedAt: Date.now() };
      } catch (err) {
        console.error(`[ERROR] Failed to parse binary tick for ${clientCode}:`, err);
      }
    }
  });

  userSocket.on('close', () => {
    userData.delete(clientCode);
  });

  userData.set(clientCode, { socket: userSocket, liveData });
  res.json({ message: `WebSocket started for ${clientCode}`, tokens, exchange });
});

// GET /angel/live/prices
router.get('/prices', (req, res) => {
  const { clientCode } = req.query;
  if (!clientCode) {
    return res.status(400).json({ error: 'Missing clientCode query param' });
  }

  const user = userData.get(clientCode);
  if (!user) {
    return res.status(404).json({ error: 'No active stream for this clientCode' });
  }

  res.json(user.liveData);
});

export default router;
