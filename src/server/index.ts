import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Serve static files from the client build
const clientBuildPath = path.join(__dirname, '..', '..', 'dist', 'client');
app.use(express.static(clientBuildPath));

// API routes (placeholder for future expansion)
app.use('/api', express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Catch all handler: send back React's index.html file for SPA routing
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Tix Kanban server running on port ${PORT}`);
  console.log(`📁 Serving static files from: ${clientBuildPath}`);
});