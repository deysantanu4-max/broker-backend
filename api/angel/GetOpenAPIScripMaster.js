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

      // Use a Set to avoid duplicates based on baseSymbol
      const seen = new Set();

      results = jsonData.filter(item => {
        const symbol = (item.symbol || '').toLowerCase();
        const baseSymbol = symbol.split('-')[0]; // remove EQ/BE suffix
        if (!baseSymbol.startsWith(q)) return false; // match only from start
        if (seen.has(baseSymbol)) return false; // skip duplicates
        seen.add(baseSymbol);
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
