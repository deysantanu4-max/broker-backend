import express from 'express';
import historicalRouter from './historical.js';
import liveRouter from './live.js'; // <-- Live WebSocket router

const app = express();
app.use(express.json());

// ✅ Mount routers under /api to match existing requests
app.use('/api/angel/historical', historicalRouter);
app.use('/api/angel/live', liveRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});
