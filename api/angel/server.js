import express from 'express';
import historicalRouter from './historical.js';
import liveRouter from './live.js';

const app = express();
app.use(express.json());

// Debug log for all requests
app.use((req, res, next) => {
  console.log(`[server] ${req.method} ${req.originalUrl}`);
  next();
});

// Historical API routes
app.use('/api/angel/historical', historicalRouter);

// Live API routes (with debug log to confirm hits)
app.use('/api/angel/live', (req, res, next) => {
  console.log(`[server] Live route hit: ${req.method} ${req.originalUrl}`);
  next();
}, liveRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});
