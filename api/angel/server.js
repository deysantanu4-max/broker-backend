import express from 'express';
import historicalRouter from './api/angel/historical.js';

const app = express();
app.use(express.json());

app.use('/angel', historicalRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
