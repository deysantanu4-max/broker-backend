import express from 'express';
import axios from 'axios';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

function buildAngelHeaders(req) {
  return {
    Authorization: req.headers['authorization'] || '',
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': req.headers['x-clientlocalip'] || '127.0.0.1',
    'X-ClientPublicIP': req.headers['x-clientpublicip'] || '127.0.0.1',
    'X-MACAddress': req.headers['x-macaddress'] || '00:00:00:00:00:00',
    'X-PrivateKey': req.headers['x-privatekey'] || 'API_KEY', // put your real key here or env var
  };
}

app.all('/api/angel/portfolio', async (req, res) => {
  try {
    const headers = buildAngelHeaders(req);

    // Determine action either from query param or body param
    // For GET: use req.query.action, for POST: use req.body.action
    const action = req.method === 'GET' ? req.query.action : req.body.action;

    if (!action) {
      return res.status(400).json({ error: 'Missing action parameter' });
    }

    let apiResponse;

    if (action === 'holdings') {
      apiResponse = await axios.get(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getAllHolding',
        { headers }
      );
    } else if (action === 'positions') {
      apiResponse = await axios.get(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getPosition',
        { headers }
      );
    } else if (action === 'convertPosition') {
      // For convertPosition, expect POST with body
      if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed. Use POST for convertPosition.' });
      }
      apiResponse = await axios.post(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/convertPosition',
        req.body.data || {}, // assuming payload is inside `data` key
        { headers }
      );
    } else {
      return res.status(400).json({ error: 'Invalid action parameter' });
    }

    res.json(apiResponse.data);

  } catch (error) {
    console.error('Error in /api/angel/portfolio:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data || error.message || 'Internal Server Error',
    });
  }
});

app.listen(port, () => {
  console.log(`Angel One API Proxy server running on port ${port}`);
});
