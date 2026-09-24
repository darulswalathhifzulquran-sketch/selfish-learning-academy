import crypto from 'node:crypto';
import { col } from './mongo.js';

export const uuid = () => crypto.randomUUID();
const b64url = b => Buffer.from(b).toString('base64url');
const fromB64url = s => Buffer.from(String(s), 'base64url');
export const digest = s => crypto.createHash('sha256').update(String(s)).digest('hex');
export const newSalt = () => b64url(crypto.randomBytes(16));
const hashSecret = (value, salt, iterations) => b64url(crypto.pbkdf2Sync(String(value), fromB64url(salt), iterations, 32, 'sha256'));
export const hashPin = (v, s) => hashSecret(v, s, 210000);
export const hashAdmin = (v, s) => hashSecret(v, s, 240000);
export const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export function binaryBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (value?.buffer && Buffer.isBuffer(value.buffer)) return value.buffer;
  if (value?.value && typeof value.value === 'function') return Buffer.from(value.value());
  try { return Buffer.from(value); } catch { return null; }
}

export async function notify(accountId, title, message, type = 'info') {
  await col('notifications').insertOne({
    id: uuid(), account_id: String(accountId), title, message, type,
    is_read: false, created_at: new Date()
  });
}

export async function createStudentSession(res, accountId) {
  const raw = b64url(crypto.randomBytes(32));
  const now = new Date();
  await col('sessions').deleteMany({ $or: [{ account_id: String(accountId) }, { expires_at: { $lte: now } }] });
  await col('sessions').insertOne({
    token_hash: digest(raw), account_id: String(accountId),
    expires_at: new Date(now.getTime() + 30 * 86400000), created_at: now
  });
  res.cookie('el_session', raw, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/', maxAge: 30 * 86400000
  });
}

export async function student(req) {
  const raw = req.cookies?.el_session;
  if (!raw) return null;
  const s = await col('sessions').findOne({ token_hash: digest(raw), expires_at: { $gt: new Date() } });
  if (!s) return null;
  const a = await col('users').findOne({ id: String(s.account_id) }, { projection: {
    _id: 0, id: 1, username: 1, full_name: 1, language: 1, enrollment_id: 1,
    profile_course: 1, profile_institution: 1, created_at: 1, photo_mime: 1
  } });
  if (!a) return null;
  return { ...a, photo_url: a.photo_mime ? '/api/student/photo' : null };
}

export async function requireStudent(req, res) {
  const a = await student(req);
  if (!a) { res.status(401).json({ error: 'Please log in.' }); return null; }
  return a;
}

export async function clearStudent(req, res) {
  const raw = req.cookies?.el_session;
  if (raw) await col('sessions').deleteOne({ token_hash: digest(raw) });
  res.clearCookie('el_session', { path: '/' });
}

export async function createAdminSession(res) {
  const raw = b64url(crypto.randomBytes(32));
  const now = new Date();
  await col('admin_sessions').deleteMany({ expires_at: { $lte: now } });
  await col('admin_sessions').insertOne({
    token_hash: digest(raw), expires_at: new Date(now.getTime() + 12 * 3600000), created_at: now
  });
  res.cookie('sla_admin_session', raw, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
    path: '/', maxAge: 12 * 3600000
  });
}

export async function adminState(req) {
  const security = await col('admin_security').findOne({ _id: 'main' });
  const configured = !!security?.code_hash;
  const raw = req.cookies?.sla_admin_session;
  if (!raw) return { configured, authenticated: false };
  const s = await col('admin_sessions').findOne({ token_hash: digest(raw), expires_at: { $gt: new Date() } });
  return { configured, authenticated: !!s };
}

export async function requireAdmin(req, res) {
  const s = await adminState(req);
  if (!s.authenticated) { res.status(401).json({ error: 'Admin access code required.' }); return false; }
  return true;
}
