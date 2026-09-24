import express from 'express';
import { col } from './mongo.js';
import { newSalt, hashAdmin, createAdminSession, adminState, requireAdmin, notify, digest, uuid } from './auth.js';

const router = express.Router();

router.get('/admin/auth/status', async (req, res, next) => {
  try { res.json(await adminState(req)); } catch (e) { next(e); }
});

router.post('/admin/auth/setup', async (req, res, next) => { try {
  const code = String(req.body?.code || '');
  const setupToken = String(req.body?.setupToken || '');
  if (code.length < 6 || code.length > 64) return res.status(400).json({ error: 'Admin access code must be 6–64 characters.' });
  const current = await col('admin_security').findOne({ _id: 'main' });
  if (current?.code_hash) return res.status(409).json({ error: 'Admin access code is already configured.' });
  const expected = String(process.env.ADMIN_SETUP_TOKEN || '');
  if (expected && setupToken !== expected) return res.status(403).json({ error: 'This is not the authorised first-time setup link.' });
  const salt = newSalt(), now = new Date();
  await col('admin_security').updateOne(
    { _id: 'main' },
    { $set: { code_salt: salt, code_hash: hashAdmin(code, salt), setup_token_hash: null, updated_at: now }, $setOnInsert: { created_at: now } },
    { upsert: true }
  );
  await createAdminSession(res);
  res.json({ ok: true });
} catch (e) { next(e); } });

router.post('/admin/auth/login', async (req, res, next) => { try {
  const code = String(req.body?.code || '');
  const current = await col('admin_security').findOne({ _id: 'main' });
  if (!current?.code_hash) return res.status(409).json({ error: 'Admin access code has not been created yet.' });
  if (hashAdmin(code, current.code_salt) !== current.code_hash) return res.status(401).json({ error: 'Incorrect admin access code.' });
  await createAdminSession(res);
  res.json({ ok: true });
} catch (e) { next(e); } });

router.post('/admin/auth/logout', async (req, res, next) => { try {
  const raw = req.cookies?.sla_admin_session;
  if (raw) await col('admin_sessions').deleteOne({ token_hash: digest(raw) });
  res.clearCookie('sla_admin_session', { path: '/' });
  res.json({ ok: true });
} catch (e) { next(e); } });

router.route('/admin/requests')
.get(async (req, res, next) => { try {
  if (!await requireAdmin(req, res)) return;
  const docs = await col('requests').find({}, { projection: { _id:0,price:0,payment_ref:0,payment_status:0 } }).sort({ created_at:-1 }).limit(500).toArray();
  res.json({ requests: docs });
} catch (e) { next(e); } })
.put(async (req, res, next) => { try {
  if (!await requireAdmin(req, res)) return;
  const b = req.body || {};
  const requestId = String(b.requestId || '');
  if (!requestId) return res.status(400).json({ error: 'requestId required' });
  const previous = await col('requests').findOne({ request_id: requestId });
  if (!previous) return res.status(404).json({ error: 'Request not found' });

  const set = { updated_at: new Date() };
  if (b.status != null) set.status = String(b.status).slice(0, 80);
  if (b.deliveryText != null) set.delivery_text = String(b.deliveryText).slice(0, 200);
  if (typeof b.accessGranted === 'boolean') set.access_granted = b.accessGranted;
  if (b.progress != null && Number.isFinite(Number(b.progress))) set.progress = Math.max(0, Math.min(100, Number(b.progress)));

  await col('requests').updateOne({ request_id: requestId }, { $set: set, $unset:{ price:'',payment_ref:'',payment_status:'' } });
  const current = await col('requests').findOne({ request_id: requestId });
  let note = null;
  if (current.access_granted && !previous.access_granted) {
    note = ['Learning access granted', `Your materials for ${requestId} are ready. Open your Learning Library to start.`, 'ready'];
  } else if (current.status !== previous.status) {
    note = ['Request updated', `${requestId} status is now “${current.status}”.`, 'status'];
  } else if ((current.delivery_text || '') !== (previous.delivery_text || '')) {
    note = ['Preparation update', `A preparation or delivery-time update is available for ${requestId}.`, 'status'];
  }
  if (note) await notify(previous.user_id, ...note);

  res.json({ request:{ request_id:current.request_id,status:current.status,delivery_text:current.delivery_text,access_granted:current.access_granted,progress:current.progress } });
} catch (e) { next(e); } });

router.route('/admin/materials')
.get(async (req, res, next) => { try {
  if (!await requireAdmin(req, res)) return;
  const docs = await col('materials').find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(500).toArray();
  res.json({ materials: docs });
} catch (e) { next(e); } })
.post(async (req, res, next) => { try {
  if (!await requireAdmin(req, res)) return;
  const b = req.body || {};
  const requestId = String(b.requestId || '').trim();
  const title = String(b.title || '').trim();
  const kind = String(b.kind || 'Resource').trim();
  const url = String(b.url || '').trim();
  if (!requestId || !title || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Valid request, title and URL required' });
  const owner = await col('requests').findOne({ request_id: requestId }, { projection: { _id: 0, user_id: 1 } });
  if (!owner) return res.status(404).json({ error: 'Request not found' });
  const material = {
    id: uuid(), request_id: requestId, title, kind, url,
    description: String(b.description || '').slice(0, 1000), created_at: new Date()
  };
  await col('materials').insertOne(material);
  await notify(owner.user_id, 'New learning material added', `${title} is now available for ${requestId}. Open your Learning Library to access it.`, 'material');
  res.status(201).json({ material });
} catch (e) { next(e); } })
.delete(async (req, res, next) => { try {
  if (!await requireAdmin(req, res)) return;
  const id = String(req.body?.id || '');
  if (!id) return res.status(400).json({ error: 'id required' });
  await col('materials').deleteOne({ id });
  res.json({ ok: true });
} catch (e) { next(e); } });

router.route('/admin/thoughts')
.get(async (req, res, next) => { try {
  if (!await requireAdmin(req, res)) return;
  const docs = await col('student_thoughts').find({}, { projection: { _id: 0 } }).sort({ created_at: -1 }).limit(200).toArray();
  res.json({ thoughts: docs });
} catch (e) { next(e); } })
.put(async (req, res, next) => { try {
  if (!await requireAdmin(req, res)) return;
  const id = String(req.body?.id || '');
  if (!id) return res.status(400).json({ error: 'id required' });
  await col('student_thoughts').updateOne({ id }, { $set: { approved: !!req.body?.approved } });
  res.json({ ok: true });
} catch (e) { next(e); } })
.delete(async (req, res, next) => { try {
  if (!await requireAdmin(req, res)) return;
  const id = String(req.body?.id || '');
  if (!id) return res.status(400).json({ error: 'id required' });
  await col('student_thoughts').deleteOne({ id });
  res.json({ ok: true });
} catch (e) { next(e); } });

export default router;
