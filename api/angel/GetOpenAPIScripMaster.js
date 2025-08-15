import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  try {
    const { query } = req.query; // from ?query=TCS
    const filePath = path.join(process.cwd(), 'api', 'angel', 'OpenAPIScripMaster.json');
    const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    let results = jsonData;

    if (query) {
      const q = query.toLowerCase();
      const seen = new Set();

      results = jsonData.filter(item => {
        const symbol = (item.symbol || '').toLowerCase();
        const baseSymbol = symbol.split('-')[0];
        const exchange = (item.exch_seg || '').toUpperCase();

        if (!baseSymbol.startsWith(q)) return false;

        // Track by baseSymbol + exchange so NSE and BSE both appear
        const key = `${baseSymbol}-${exchange}`;
        if (seen.has(key)) return false;
        seen.add(key);

        return true;
      }).slice(0, 20);
    }

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load scrip data' });
  }
}
