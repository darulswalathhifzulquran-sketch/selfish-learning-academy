import express from 'express';
import multer from 'multer';
import { col, nextCounter } from './mongo.js';
import { uuid, newSalt, hashPin, createStudentSession, student, requireStudent, clearStudent, notify, safe, binaryBuffer } from './auth.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post('/student/register', async (req, res, next) => { try {
  const b = req.body || {};
  const fullName = String(b.fullName || '').trim().slice(0, 100);
  const username = String(b.username || '').trim().toLowerCase();
  const pin = String(b.pin || '');
  const language = ['English', 'Malayalam', 'Arabic'].includes(String(b.language)) ? String(b.language) : 'English';
  if (fullName.length < 2) return res.status(400).json({ error: 'Enter your full name.' });
  if (!/^[a-z0-9_.-]{3,30}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–30 characters using letters, numbers, dot, underscore or hyphen.' });
  if (pin.length < 6 || pin.length > 32) return res.status(400).json({ error: 'PIN/password must be at least 6 characters.' });
  if (await col('users').findOne({ username })) return res.status(409).json({ error: 'That username is already taken.' });

  const seq = await nextCounter('enrollment');
  const enrollmentId = `SLA-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`;
  const salt = newSalt(), id = uuid(), created = new Date();
  const doc = {
    id, username, full_name: fullName, pin_salt: salt, pin_hash: hashPin(pin, salt), language,
    enrollment_id: enrollmentId, created_at: created, last_login_at: null,
    profile_course: null, profile_institution: null, photo_data: null, photo_mime: null
  };
  await col('users').insertOne(doc);
  await createStudentSession(res, id);
  await notify(id, 'Welcome to SELFISH LEARNING ACADEMY', 'Your learning space is ready. Create a request whenever you need personalised study materials.', 'welcome');
  res.status(201).json({ student: { id, username, full_name: fullName, language, enrollment_id: enrollmentId, created_at: created } });
} catch (e) { if (e?.code === 11000) return res.status(409).json({ error: 'That username is already taken.' }); next(e); } });

router.post('/student/login', async (req, res, next) => { try {
  const username = String(req.body?.username || '').trim().toLowerCase();
  const pin = String(req.body?.pin || '');
  const a = await col('users').findOne({ username });
  if (!a || hashPin(pin, a.pin_salt) !== a.pin_hash) return res.status(401).json({ error: 'Invalid username or PIN/password.' });
  await col('users').updateOne({ id: a.id }, { $set: { last_login_at: new Date() } });
  await createStudentSession(res, a.id);
  res.json({ student: {
    id: a.id, username: a.username, full_name: a.full_name, language: a.language,
    enrollment_id: a.enrollment_id, profile_course: a.profile_course || null,
    profile_institution: a.profile_institution || null,
    photo_url: a.photo_mime ? '/api/student/photo' : null, created_at: a.created_at
  } });
} catch (e) { next(e); } });

router.post('/student/logout', async (req, res, next) => { try { await clearStudent(req, res); res.json({ ok: true }); } catch (e) { next(e); } });
router.get('/student/me', async (req, res, next) => { try { res.json({ student: await student(req) }); } catch (e) { next(e); } });
router.get('/profile', async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  res.json({ profile: { user_id: String(a.id), name: a.full_name, username: a.username, enrollment_id: a.enrollment_id, language: a.language, created_at: a.created_at } });
} catch (e) { next(e); } });

router.route('/requests')
.get(async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const docs = await col('requests').find({ user_id: String(a.id) }, { projection: { _id: 0, user_id: 0 } }).sort({ created_at: -1 }).toArray();
  res.json({ requests: docs });
} catch (e) { next(e); } })
.post(async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const b = req.body || {};
  const required = ['university', 'programme', 'semester', 'subject', 'chapter'];
  if (required.some(k => !String(b[k] || '').trim())) return res.status(400).json({ error: 'Complete all academic fields.' });
  const materials = Array.isArray(b.materials) ? b.materials.map(String).filter(Boolean).slice(0, 12) : [];
  if (!materials.length) return res.status(400).json({ error: 'Choose at least one material.' });

  const seq = await nextCounter('request');
  const requestId = `REQ-${String(seq + 1000).padStart(6, '0')}`;
  const now = new Date();
  const doc = {
    id: uuid(), request_id: requestId, user_id: String(a.id), student_name: a.full_name,
    enrollment_id: a.enrollment_id, university: String(b.university).trim(),
    programme: String(b.programme).trim(), semester: String(b.semester).trim(),
    subject: String(b.subject).trim(), chapter: String(b.chapter).trim(), materials,
    notes: String(b.notes || '').slice(0, 2000), status: 'Under review', price: null,
    delivery_text: '', payment_ref: '', payment_status: 'Pending', access_granted: false,
    progress: 0, created_at: now, updated_at: now
  };
  await col('requests').insertOne(doc);
  const profileSet = {};
  if (!a.profile_course) profileSet.profile_course = doc.programme;
  if (!a.profile_institution) profileSet.profile_institution = doc.university;
  if (Object.keys(profileSet).length) await col('users').updateOne({ id: String(a.id) }, { $set: profileSet });
  await notify(a.id, 'Request received', `Thank you. We received ${requestId}. You will be notified here when your quotation or learning materials are ready.`, 'request');
  res.status(201).json({ request: { request_id: requestId, status: 'Under review', created_at: now }, message: 'Thank you. Your request has been received. You will be notified when it is ready.' });
} catch (e) { next(e); } })
.put(async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const requestId = String(req.body?.requestId || '');
  const paymentRef = String(req.body?.paymentRef || '').trim().slice(0, 120);
  if (!requestId || !paymentRef) return res.status(400).json({ error: 'Request ID and payment reference are required.' });
  const r = await col('requests').findOneAndUpdate(
    { request_id: requestId, user_id: String(a.id) },
    { $set: { payment_ref: paymentRef, payment_status: 'Submitted', updated_at: new Date() } },
    { returnDocument: 'after' }
  );
  const doc = r?.value || r;
  if (!doc) return res.status(404).json({ error: 'Request not found.' });
  await notify(a.id, 'Payment reference received', `Your payment reference for ${requestId} was received and is awaiting verification.`, 'payment');
  res.json({ request: { request_id: doc.request_id, payment_ref: doc.payment_ref, payment_status: doc.payment_status } });
} catch (e) { next(e); } });

router.get('/materials', async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const owned = await col('requests').find({ user_id: String(a.id), access_granted: true }, { projection: { _id: 0, request_id: 1 } }).toArray();
  const ids = owned.map(x => x.request_id);
  if (!ids.length) return res.json({ materials: [] });
  const docs = await col('materials').find({ request_id: { $in: ids } }, { projection: { _id: 0 } }).sort({ created_at: -1 }).toArray();
  res.json({ materials: docs });
} catch (e) { next(e); } });

router.route('/notifications')
.get(async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const docs = await col('notifications').find({ account_id: String(a.id) }, { projection: { _id: 0, account_id: 0 } }).sort({ created_at: -1 }).limit(100).toArray();
  res.json({ notifications: docs, unread: docs.filter(x => !x.is_read).length });
} catch (e) { next(e); } })
.put(async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  if (req.body?.all) await col('notifications').updateMany({ account_id: String(a.id) }, { $set: { is_read: true } });
  else if (req.body?.id) await col('notifications').updateOne({ id: String(req.body.id), account_id: String(a.id) }, { $set: { is_read: true } });
  res.json({ ok: true });
} catch (e) { next(e); } });

router.route('/thoughts')
.get(async (req, res, next) => { try {
  const docs = await col('student_thoughts').find({ approved: true }, { projection: { _id: 0, id: 1, student_name: 1, course: 1, thought: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(30).toArray();
  res.json({ thoughts: docs });
} catch (e) { next(e); } })
.post(async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const thought = String(req.body?.thought || '').trim().slice(0, 500);
  const course = String(req.body?.course || '').trim().slice(0, 120);
  if (thought.length < 12 || !course) return res.status(400).json({ error: 'Add your course and a short thought.' });
  await col('student_thoughts').insertOne({ id: uuid(), account_id: String(a.id), student_name: a.full_name, course, thought, approved: false, created_at: new Date() });
  res.status(201).json({ ok: true, message: 'Thank you. Your thought will appear after review.' });
} catch (e) { next(e); } });

router.route('/student/id-card')
.get(async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const p = await col('users').findOne({ id: String(a.id) });
  const latest = await col('requests').findOne({ user_id: String(a.id) }, { sort: { created_at: -1 }, projection: { _id: 0, programme: 1, university: 1 } }) || {};
  const course = p?.profile_course || latest.programme || '';
  const institution = p?.profile_institution || latest.university || '';
  if (String(req.query?.download || '') === '1') {
    let avatar = `<rect x="50" y="128" width="126" height="148" rx="18" fill="#edf3e9"/><text x="113" y="213" text-anchor="middle" font-size="42" font-family="Arial" font-weight="700" fill="#146a50">${safe((p?.full_name || 'S')[0]?.toUpperCase())}</text>`;
    const photo = binaryBuffer(p?.photo_data);
    if (photo) avatar = `<image href="data:${p.photo_mime || 'image/jpeg'};base64,${photo.toString('base64')}" x="50" y="128" width="126" height="148" preserveAspectRatio="xMidYMid slice"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="630" viewBox="0 0 1000 630"><rect width="1000" height="630" rx="34" fill="#fbfcf8"/><rect width="1000" height="104" fill="#0b5141"/><text x="50" y="63" font-family="Arial" font-size="34" font-weight="800" fill="#fff">SELFISH LEARNING ACADEMY</text><text x="950" y="63" text-anchor="end" font-family="Arial" font-size="20" font-weight="700" fill="#e2ba56">SELFISH STUDENT</text>${avatar}<text x="210" y="158" font-family="Arial" font-size="20" fill="#65736b">STUDENT NAME</text><text x="210" y="197" font-family="Arial" font-size="34" font-weight="800" fill="#132921">${safe(p?.full_name)}</text><text x="210" y="244" font-family="Arial" font-size="18" fill="#65736b">ID: ${safe(p?.enrollment_id)}</text><line x1="50" y1="314" x2="950" y2="314" stroke="#dce5de"/><text x="50" y="358" font-family="Arial" font-size="18" fill="#65736b">COURSE / PROGRAMME</text><text x="50" y="393" font-family="Arial" font-size="25" font-weight="700" fill="#132921">${safe(course || 'Not set')}</text><text x="50" y="447" font-family="Arial" font-size="18" fill="#65736b">UNIVERSITY / INSTITUTION</text><text x="50" y="482" font-family="Arial" font-size="23" font-weight="700" fill="#132921">${safe(institution || 'Not set')}</text><rect x="50" y="525" width="900" height="66" rx="18" fill="#eef4eb"/><text x="500" y="566" text-anchor="middle" font-family="Arial" font-size="22" font-style="italic" font-weight="700" fill="#0b5141">I learn my way. I grow with SELFISH LEARNING ACADEMY.</text></svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `attachment; filename="${p?.enrollment_id || 'SLA'}-ID-Card.svg"`);
    return res.send(svg);
  }
  res.json({ student: {
    full_name: p?.full_name, username: p?.username, enrollment_id: p?.enrollment_id,
    profile_course: p?.profile_course || null, profile_institution: p?.profile_institution || null,
    photo_url: p?.photo_mime ? '/api/student/photo' : null, course, institution,
    tagline: 'I learn my way. I grow with SELFISH LEARNING ACADEMY.'
  } });
} catch (e) { next(e); } })
.put(async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const course = String(req.body?.course || '').trim().slice(0, 120);
  const institution = String(req.body?.institution || '').trim().slice(0, 160);
  await col('users').updateOne({ id: String(a.id) }, { $set: { profile_course: course, profile_institution: institution } });
  res.json({ student: { ...a, course, institution, profile_course: course, profile_institution: institution, photo_url: a.photo_url || null, tagline: 'I learn my way. I grow with SELFISH LEARNING ACADEMY.' } });
} catch (e) { next(e); } });

router.get('/student/photo', async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const p = await col('users').findOne({ id: String(a.id) }, { projection: { _id: 0, photo_data: 1, photo_mime: 1 } });
  const data = binaryBuffer(p?.photo_data);
  if (!data) return res.status(404).end();
  res.type(p?.photo_mime || 'image/jpeg').send(data);
} catch (e) { next(e); } });

router.post('/student/photo', upload.single('photo'), async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const f = req.file;
  if (!f) return res.status(400).json({ error: 'Choose a photo first.' });
  if (!/^image\/(jpeg|png|webp)$/i.test(f.mimetype || '')) return res.status(400).json({ error: 'Use JPG, PNG or WebP image.' });
  await col('users').updateOne({ id: String(a.id) }, { $set: { photo_data: f.buffer, photo_mime: f.mimetype } });
  res.json({ photoUrl: '/api/student/photo' });
} catch (e) { next(e); } });

router.post('/contact', async (req, res, next) => { try {
  const b = req.body || {};
  const name = String(b.name || '').trim(), email = String(b.email || '').trim().toLowerCase(), message = String(b.message || '').trim();
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || message.length < 5) return res.status(400).json({ error: 'Enter a valid name, email and message.' });
  await col('contact_messages').insertOne({ id: uuid(), name, email, message: message.slice(0, 4000), created_at: new Date() });
  res.status(201).json({ ok: true });
} catch (e) { next(e); } });

export default router;
