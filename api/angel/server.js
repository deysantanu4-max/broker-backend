const express = require('express');
const app = express();
const historicalHandler = require('./historical'); // Make sure path is correct

app.use(express.json());

app.post('/angel/historical', historicalHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
