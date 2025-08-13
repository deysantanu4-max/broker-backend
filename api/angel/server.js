import express from 'express';
import historicalRouter from './historical.js';
import liveRouter from './live.js'; // <-- New live WebSocket router

const app = express();
app.use(express.json());

// Mount routers
app.use('/angel/historical', historicalRouter);
app.use('/angel/live', liveRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
});
