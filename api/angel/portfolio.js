import express from 'express';
import axios from 'axios';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Helper function to build headers from incoming request
function buildAngelHeaders(req) {
  return {
    Authorization: req.headers['authorization'] || '', // Bearer token
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': req.headers['x-clientlocalip'] || '127.0.0.1',
    'X-ClientPublicIP': req.headers['x-clientpublicip'] || '127.0.0.1',
    'X-MACAddress': req.headers['x-macaddress'] || '00:00:00:00:00:00',
    'X-PrivateKey': req.headers['x-privatekey'] || 'API_KEY', // Replace with env var or secure value
  };
}

// GET All Holdings
app.get('/api/holdings', async (req, res) => {
console.log('Received /api/holdings request:', {
    headers: req.headers,
    query: req.query,
  });
  try {
    const headers = buildAngelHeaders(req);

    const response = await axios.get(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getAllHolding',
      { headers }
    );

    console.log('Angel API response:', response.data);
    res.json(response.data);
  } catch (error) {
    console.error('Error in /api/holdings:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message || 'Internal Server Error',
    });
  }
});

// GET Positions
app.get('/api/positions', async (req, res) => {
console.log('Received request for /api/positions');
console.log('Request headers:', req.headers);
  try {
    const headers = buildAngelHeaders(req);
    console.log('Built headers for Angel API:', headers);

    const response = await axios.get(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getPosition',
      { headers }
    );

    console.log('Angel API /getPosition response:', response.data);
    res.json(response.data);
  } catch (error) {
    console.error('Error in /api/positions:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message || 'Internal Server Error',
    });
  }
});

// POST Convert Position
app.post('/api/convert-position', async (req, res) => {
  try {
    const headers = buildAngelHeaders(req);
    const body = req.body;

    const response = await axios.post(
      'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/convertPosition',
      body,
      { headers }
    );

    res.json(response.data);
  } catch (error) {
    console.error('Error in /api/convert-position:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message || 'Internal Server Error',
    });
  }
});

app.listen(port, () => {
  console.log(`Angel One API Proxy server running on port ${port}`);
});
