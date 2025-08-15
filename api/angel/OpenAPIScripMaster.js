import fs from 'fs';
import path from 'path';

export default function handler(req, res) {
  // Get absolute path to the JSON file
  const filePath = path.join(process.cwd(), 'api', 'angel', 'OpenAPIScripMaster.json');

  try {
    const jsonData = fs.readFileSync(filePath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(jsonData);
  } catch (error) {
    res.status(500).json({ error: 'File not found or cannot be read' });
  }
}
