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
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// POST /angel/live/stream
router.post('/stream', (req, res) => {
  console.log(`[REQ] POST /angel/live/stream body:`, req.body);

  const { clientCode, feedToken, tokens } = req.body;

  if (!clientCode || !feedToken || !tokens || !tokens.length) {
    console.warn(`[WARN] Missing required params for stream start`);
    return res.status(400).json({ error: 'Missing clientCode, feedToken, or tokens' });
  }

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
      console.log(`[DATA] Binary tick received (${data.length} bytes) for ${clientCode}`);
      try {
        const buf = Buffer.from(data);
        const token = buf.slice(2, 27).toString('utf8').replace(/\0/g, '');
        const ltp = buf.readInt32LE(43) / 100;

        console.log(`[TICK] ${clientCode} Token=${token} LTP=${ltp}`);
        liveData[token] = { token, ltp, updatedAt: Date.now() };
      } catch (err) {
        console.error(`[ERROR] Failed to parse binary tick for ${clientCode}:`, err);
      }
    } else {
      try {
        const jsonMsg = JSON.parse(data);
        console.log(`[JSON] Message from ${clientCode}:`, jsonMsg);
      } catch {
        console.log(`[TEXT] Message from ${clientCode}:`, data.toString());
      }
    }
  });

  userSocket.on('error', (err) => {
    console.error(`❌ [ERROR] WebSocket error for ${clientCode}:`, err);
  });

  userSocket.on('close', (code, reason) => {
    console.warn(`🔌 [CLOSE] WebSocket closed for ${clientCode} code=${code} reason=${reason}`);
    userData.delete(clientCode);
  });

  userData.set(clientCode, { socket: userSocket, liveData });

  console.log(`[STATE] WebSocket session stored for ${clientCode}`);
  res.json({ message: `WebSocket started for ${clientCode}`, tokens });
});

// GET /angel/live/prices
router.get('/prices', (req, res) => {
  console.log(`[REQ] GET /angel/live/prices query:`, req.query);

  const { clientCode } = req.query;
  if (!clientCode) {
    console.warn(`[WARN] Missing clientCode query param`);
    return res.status(400).json({ error: 'Missing clientCode query param' });
  }

  const user = userData.get(clientCode);
  if (!user) {
    console.warn(`[WARN] No active stream found for ${clientCode}`);
    return res.status(404).json({ error: 'No active stream for this clientCode' });
  }

  console.log(`[RESP] Sending live data for ${clientCode}`);
  res.json(user.liveData);
});

export default router;
