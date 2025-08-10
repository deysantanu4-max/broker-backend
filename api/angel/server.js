import express from 'express';
import historicalRouter from './historical.js'; // your router

const app = express();
app.use(express.json());

// Correctly mount the router
app.use('/angel', historicalRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
