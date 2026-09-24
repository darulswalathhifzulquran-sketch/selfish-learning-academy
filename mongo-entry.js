import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initMongo, migratePostgresOnce, db } from './src/mongo.js';
import studentRoutes from './src/student-routes.js';
import adminRoutes from './src/admin-routes.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const root = path.dirname(fileURLToPath(import.meta.url));

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.get('/health', async (_req, res) => {
  try {
    await db().command({ ping: 1 });
    res.json({ ok: true, database: 'MongoDB Atlas' });
  } catch {
    res.status(503).json({ ok: false });
  }
});
app.use('/api', studentRoutes);
app.use('/api', adminRoutes);
app.use(express.static(path.join(root, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(root, 'public', 'index.html'));
});
app.use((err, _req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Server error. Please try again.' });
});

await initMongo();
await migratePostgresOnce();
app.listen(port, '0.0.0.0', () => console.log(`SELFISH LEARNING ACADEMY listening on ${port}`));
