import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { initMongo, migratePostgresOnce, db } from './src/mongo.js';
import enhancementRoutes from './src/enhancement-routes.js';
import studentRoutes from './src/student-routes.js';
import adminRoutes from './src/admin-routes.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');

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

app.use('/api', enhancementRoutes);
app.use('/api', studentRoutes);
app.use('/api', adminRoutes);

async function renderEnhancedHtml(fileName, cssHref, jsSrc) {
  let html = await readFile(path.join(publicDir, fileName), 'utf8');
  if (cssHref && !html.includes(cssHref)) html = html.replace('</head>', `<link rel="stylesheet" href="${cssHref}"></head>`);
  if (jsSrc && !html.includes(jsSrc)) html = html.replace('</body>', `<script src="${jsSrc}" defer></script></body>`);
  return html;
}

app.get(['/', '/index.html'], async (_req, res, next) => {
  try {
    res.type('html').send(await renderEnhancedHtml('index.html', '/pro-enhance.css', '/pro-enhance.js'));
  } catch (e) { next(e); }
});

app.get('/admin.html', async (_req, res, next) => {
  try {
    res.type('html').send(await renderEnhancedHtml('admin.html', '/admin-enhance.css', '/admin-enhance.js'));
  } catch (e) { next(e); }
});

app.use(express.static(publicDir));
app.get('*', async (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  try {
    res.type('html').send(await renderEnhancedHtml('index.html', '/pro-enhance.css', '/pro-enhance.js'));
  } catch (e) { next(e); }
});

app.use((err, _req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Server error. Please try again.' });
});

await initMongo();
await migratePostgresOnce();
app.listen(port, '0.0.0.0', () => console.log(`SELFISH LEARNING ACADEMY listening on ${port}`));
