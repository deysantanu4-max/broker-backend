import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  try {
    const { query } = req.query;
    const filePath = path.join(process.cwd(), 'api', 'angel', 'OpenAPIScripMaster.json');
    const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    let results = jsonData;

    if (query) {
      const q = query.trim().toLowerCase(); // trim spaces
      const seen = new Set();

      results = jsonData.filter(item => {
        const symbol = ((item.symbol || '') + '').trim().toLowerCase();
        const baseSymbol = symbol.split('-')[0];
        const name = ((item.name || '') + '').trim().toLowerCase();
        const exchange = ((item.exch_seg || '') + '').trim().toUpperCase();

        // Match if query appears ANYWHERE in baseSymbol or company name
        if (!baseSymbol.includes(q) && !name.includes(q)) return false;

        // Allow both NSE and BSE entries separately
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
