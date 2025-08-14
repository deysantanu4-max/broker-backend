// api/angel/live.js
import { Router } from 'express';
import WebSocket from 'ws';

const router = Router();
const API_KEY = process.env.ANGEL_API_KEY;

if (!API_KEY) {
  console.error('❌ Missing API key in env (ANGEL_API_KEY)');
}

// clientCode -> { socket, liveData: {}, hbTimer }
const userData = new Map();

function generateCorrelationId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 10; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function getExchangeType(exchange) {
  const ex = String(exchange || '').toUpperCase();
  if (ex === 'BSE') return 2;
  // Default NSE
  return 1;
}

// POST /api/angel/live/stream
router.post('/api/angel/live/stream', (req, res) => {
  console.log('[live] [REQ] POST /api/angel/live/stream body:', req.body);

  const { clientCode, feedToken, tokens, exchange } = req.body || {};

  if (!clientCode || !feedToken || !tokens || !Array.isArray(tokens) || tokens.length === 0) {
    console.warn('[live] [WARN] Missing required params (clientCode, feedToken, tokens[])');
    return res.status(400).json({ error: 'Missing clientCode, feedToken, or tokens[]' });
  }

  const cleanTokens = tokens.map(t => String(t)).filter(Boolean);
  const exchangeType = getExchangeType(exchange);

  // If an old socket exists, close it first
  if (userData.has(clientCode)) {
    console.log(`[live] [INFO] Closing existing WebSocket for ${clientCode}`);
    const existing = userData.get(clientCode);
    try { existing?.socket?.close(); } catch {}
    if (existing?.hbTimer) clearInterval(existing.hbTimer);
    userData.delete(clientCode);
  }

  const wsUrl = `wss://smartapisocket.angelone.in/smart-stream?clientCode=${clientCode}&feedToken=${feedToken}&apiKey=${API_KEY}`;
  console.log('[live] [CONNECT] Connecting WS:', wsUrl);

  const socket = new WebSocket(wsUrl);
  const liveData = {};

  socket.on('open', () => {
    console.log(`[live] ✅ [OPEN] WebSocket connected for ${clientCode}`);

    const subscriptionReq = {
      correlationID: generateCorrelationId(),
      action: 1, // subscribe
      params: {
        mode: 1, // 1 = LTP mode (as per Angel SmartStream)
        tokenList: [
          { exchangeType, tokens: cleanTokens }
        ]
      }
    };

    console.log(`[live] [SEND] Subscription payload for ${clientCode}:`, subscriptionReq);
    socket.send(JSON.stringify(subscriptionReq));

    // Heartbeat every 30s
    const hbTimer = setInterval(() => {
      try {
        console.log(`[live] [PING] Sending heartbeat for ${clientCode}`);
        socket.send('ping');
      } catch (e) {
        console.warn(`[live] [PING] Heartbeat send failed for ${clientCode}:`, e.message);
      }
    }, 30000);

    userData.set(clientCode, { socket, liveData, hbTimer });
  });

  socket.on('message', (data) => {
    if (data?.toString && data.toString() === 'pong') {
      console.log(`[live] [PONG] Heartbeat received from ${clientCode}`);
      return;
    }

    if (Buffer.isBuffer(data)) {
      console.log(`[live] [DATA] Binary tick (${data.length} bytes) for ${clientCode}`);
      try {
        const buf = Buffer.from(data);

        // These offsets are based on Angel SmartStream samples the user had
        const token = buf.slice(2, 27).toString('utf8').replace(/\0/g, '');
        const ltpRaw = buf.readInt32LE(43);
        const ltp = ltpRaw / 100;

        console.log(`[live] [TICK] ${clientCode} token=${token} ltp=${ltp}`);
        liveData[token] = { token, ltp, updatedAt: Date.now() };
      } catch (err) {
        console.error(`[live] [ERROR] Failed to parse binary tick for ${clientCode}:`, err);
      }
      return;
    }

    // Try JSON or text log
    try {
      const jsonMsg = JSON.parse(data);
      console.log(`[live] [JSON] Message from ${clientCode}:`, jsonMsg);
    } catch {
      console.log(`[live] [TEXT] Message from ${clientCode}:`, data?.toString?.());
    }
  });

  socket.on('error', (err) => {
    console.error(`[live] ❌ [ERROR] WebSocket error for ${clientCode}:`, err?.message || err);
  });

  socket.on('close', (code, reason) => {
    console.warn(`[live] 🔌 [CLOSE] WebSocket closed for ${clientCode} code=${code} reason=${reason}`);
    const rec = userData.get(clientCode);
    if (rec?.hbTimer) clearInterval(rec.hbTimer);
    userData.delete(clientCode);
  });

  // Set entry early (will be overwritten on 'open' with hbTimer)
  userData.set(clientCode, { socket, liveData, hbTimer: null });

  console.log(`[live] [STATE] WebSocket session stored for ${clientCode} (waiting open)`);
  return res.json({ message: `WebSocket starting for ${clientCode}`, tokens: cleanTokens, exchangeType });
});

// GET /api/angel/live/prices
router.get('/api/angel/live/prices', (req, res) => {
  console.log('[live] [REQ] GET /api/angel/live/prices query:', req.query);

  const clientCode = req.query?.clientCode;
  if (!clientCode) {
    console.warn('[live] [WARN] Missing clientCode query param');
    return res.status(400).json({ error: 'Missing clientCode query param' });
  }

  const user = userData.get(clientCode);
  if (!user) {
    console.warn(`[live] [WARN] No active stream found for ${clientCode}`);
    return res.status(404).json({ error: 'No active stream for this clientCode' });
  }

  console.log(`[live] [RESP] Sending live data for ${clientCode}`);
  return res.json(user.liveData);
});

export default router;
