import express from 'express';
import historicalRouter from './historical.js';

const app = express();
app.use(express.json());

// Mount the router under /angel
app.use('/angel', historicalRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
