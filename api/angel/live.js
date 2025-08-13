import { Router } from 'express';
import WebSocket from 'ws';

const router = Router();
const API_KEY = process.env.ANGEL_API_KEY;

if (!API_KEY) {
  console.error('❌ Missing API key in env (ANGEL_API_KEY)');
}

// Store per-user tick data and sockets
const userData = new Map(); // clientCode -> { socket, liveData }

// Generate 10-character alphanumeric correlation ID
function generateCorrelationId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// POST /angel/live/stream
// Body: { clientCode: "USER_CLIENT_CODE", feedToken: "USER_FEED_TOKEN", tokens: ["10626", "5290"] }
router.post('/stream', (req, res) => {
  const { clientCode, feedToken, tokens } = req.body;

  if (!clientCode || !feedToken || !tokens || !tokens.length) {
    return res.status(400).json({ error: 'Missing clientCode, feedToken, or tokens' });
  }

  // If already streaming for this client, close old socket
  if (userData.has(clientCode)) {
    const existing = userData.get(clientCode);
    if (existing.socket) existing.socket.close();
    userData.delete(clientCode);
  }

  const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${clientCode}&feedToken=${feedToken}&apiKey=${API_KEY}`;
  const userSocket = new WebSocket(wsUrl);

  const liveData = {};

  userSocket.on('open', () => {
    console.log(`✅ WebSocket connected for ${clientCode}`);

    const subscriptionReq = {
      correlationID: generateCorrelationId(),
      action: 1, // subscribe
      params: {
        mode: 1, // 1 = LTP
        tokenList: [
          { exchangeType: 1, tokens } // NSE tokens
        ]
      }
    };
    userSocket.send(JSON.stringify(subscriptionReq));

    // Heartbeat
    setInterval(() => userSocket.send("ping"), 30000);
  });

  userSocket.on('message', (data) => {
    if (data.toString() === "pong") return; // heartbeat

    if (Buffer.isBuffer(data)) {
      const buf = Buffer.from(data);
      const token = buf.slice(2, 27).toString('utf8').replace(/\0/g, '');
      const ltp = buf.readInt32LE(43) / 100;

      liveData[token] = { token, ltp, updatedAt: Date.now() };
    } else {
      try {
        console.log(`📩 ${clientCode} JSON:`, JSON.parse(data));
      } catch {
        console.log(`📄 ${clientCode} Text:`, data.toString());
      }
    }
  });

  userSocket.on('error', (err) => {
    console.error(`❌ WebSocket error for ${clientCode}:`, err);
  });

  userSocket.on('close', () => {
    console.log(`🔌 WebSocket closed for ${clientCode}`);
    userData.delete(clientCode);
  });

  // Store reference
  userData.set(clientCode, { socket: userSocket, liveData });

  res.json({ message: `WebSocket started for ${clientCode}`, tokens });
});

// GET /angel/live/prices?clientCode=USER_CLIENT_CODE
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
