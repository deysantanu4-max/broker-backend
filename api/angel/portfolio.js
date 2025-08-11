import express from 'express';
import axios from 'axios';

const app = express();
const port = process.env.PORT || 3000;
const ANGEL_API_KEY = process.env.ANGEL_API_KEY; 

app.use(express.json());

function buildAngelHeaders(req) {
  const headers = {
    Authorization: req.headers['authorization'] || '',
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-UserType': 'USER',
    'X-SourceID': 'WEB',
    'X-ClientLocalIP': req.headers['x-clientlocalip'] || '127.0.0.1',
    'X-ClientPublicIP': req.headers['x-clientpublicip'] || '127.0.0.1',
    'X-MACAddress': req.headers['x-macaddress'] || '00:00:00:00:00:00',
    'X-PrivateKey': process.env.ANGEL_API_KEY, 
  };
  console.log('Built headers for Angel API:', headers);
  return headers;
}

app.all('/api/angel/portfolio', async (req, res) => {
  try {
    console.log(`Received request at /api/angel/portfolio - Method: ${req.method}`);
    console.log('Request headers:', req.headers);

    const headers = buildAngelHeaders(req);

    // Get action from query (GET) or body (POST)
    const action = req.method === 'GET' ? req.query.action : req.body.action;
    console.log('Determined action:', action);

    if (!action) {
      console.warn('Missing action parameter in request');
      return res.status(400).json({ error: 'Missing action parameter' });
    }

    let apiResponse;

    if (action === 'holdings') {
      console.log('Fetching holdings from Angel API...');
      apiResponse = await axios.get(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/portfolio/v1/getAllHolding',
        { headers }
      );
    } else if (action === 'positions') {
      console.log('Fetching positions from Angel API...');
      apiResponse = await axios.get(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/getPosition',
        { headers }
      );
    } else if (action === 'convertPosition') {
      if (req.method !== 'POST') {
        console.warn('Invalid method for convertPosition:', req.method);
        return res.status(405).json({ error: 'Method Not Allowed. Use POST for convertPosition.' });
      }
      console.log('Converting position with payload:', req.body.data);
      apiResponse = await axios.post(
        'https://apiconnect.angelone.in/rest/secure/angelbroking/order/v1/convertPosition',
        req.body.data || {},
        { headers }
      );
    } else {
      console.warn('Invalid action parameter:', action);
      return res.status(400).json({ error: 'Invalid action parameter' });
    }

    console.log(`Angel API response for action '${action}':`, apiResponse.data);
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
