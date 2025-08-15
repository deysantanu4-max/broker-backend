import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  try {
    const { query } = req.query; // from ?query=TCS
    const filePath = path.join(process.cwd(), 'api', 'angel', 'OpenAPIScripMaster.json');
    const jsonData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // If query is provided, filter results
    let results = jsonData;
    if (query) {
      const q = query.toLowerCase();
      results = jsonData.filter(item => {
        const tradingsymbol = item.tradingsymbol || '';
        const symbol = item.symbol || '';
        const name = item.name || '';
        return (
          tradingsymbol.toLowerCase().includes(q) ||
          symbol.toLowerCase().includes(q) ||
          name.toLowerCase().includes(q)
        );
      }).slice(0, 20); // limit to 20 results
    }

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load scrip data' });
  }
}
