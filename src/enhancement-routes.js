import express from 'express';
import { col } from './mongo.js';
import { requireAdmin, requireStudent, safe, binaryBuffer } from './auth.js';

const router = express.Router();

router.get('/admin/stats', async (req, res, next) => { try {
  if (!await requireAdmin(req, res)) return;
  const now = Date.now();
  const sevenDays = new Date(now - 7 * 86400000);
  const thirtyDays = new Date(now - 30 * 86400000);
  const [totalStudents,newStudents,activeStudents,totalRequests,pendingRequests,readyRequests,materialsCount,notificationsSent,approvedThoughts] = await Promise.all([
    col('users').countDocuments({}),
    col('users').countDocuments({ created_at: { $gte: sevenDays } }),
    col('users').countDocuments({ last_login_at: { $gte: thirtyDays } }),
    col('requests').countDocuments({}),
    col('requests').countDocuments({ status: { $in: ['Under review','Quotation ready','Awaiting payment','Preparing materials'] } }),
    col('requests').countDocuments({ status: { $in: ['Ready','Completed'] } }),
    col('materials').countDocuments({}),
    col('notifications').countDocuments({}),
    col('student_thoughts').countDocuments({ approved: true })
  ]);
  res.json({
    total_students: totalStudents,
    new_students_7d: newStudents,
    active_students_30d: activeStudents,
    total_requests: totalRequests,
    pending_requests: pendingRequests,
    ready_requests: readyRequests,
    materials_count: materialsCount,
    notifications_sent: notificationsSent,
    approved_thoughts: approvedThoughts
  });
} catch (e) { next(e); } });

router.get('/student/id-card', async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const p = await col('users').findOne({ id: String(a.id) });
  const latest = await col('requests').findOne({ user_id: String(a.id) }, { sort: { created_at: -1 }, projection: { _id: 0, programme: 1, university: 1 } }) || {};
  const course = p?.profile_course || latest.programme || '';
  const institution = p?.profile_institution || latest.university || '';
  const username = p?.username || a.username || '';
  if (String(req.query?.download || '') === '1') {
    let avatar = `<rect x="50" y="128" width="126" height="148" rx="18" fill="#edf3e9"/><text x="113" y="213" text-anchor="middle" font-size="42" font-family="Arial" font-weight="700" fill="#146a50">${safe((p?.full_name || 'S')[0]?.toUpperCase())}</text>`;
    const photo = binaryBuffer(p?.photo_data);
    if (photo) avatar = `<image href="data:${p.photo_mime || 'image/jpeg'};base64,${photo.toString('base64')}" x="50" y="128" width="126" height="148" preserveAspectRatio="xMidYMid slice"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="630" viewBox="0 0 1000 630"><defs><linearGradient id="head" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#082f29"/><stop offset="1" stop-color="#0e604f"/></linearGradient></defs><rect width="1000" height="630" rx="34" fill="#fbfcf8"/><rect width="1000" height="104" fill="url(#head)"/><text x="50" y="63" font-family="Arial" font-size="34" font-weight="800" fill="#fff">SELFISH LEARNING ACADEMY</text><text x="950" y="63" text-anchor="end" font-family="Arial" font-size="20" font-weight="700" fill="#e2ba56">SELFISH STUDENT</text>${avatar}<text x="210" y="154" font-family="Arial" font-size="18" fill="#65736b">STUDENT NAME</text><text x="210" y="193" font-family="Arial" font-size="33" font-weight="800" fill="#132921">${safe(p?.full_name)}</text><text x="210" y="231" font-family="Arial" font-size="18" fill="#65736b">ID: ${safe(p?.enrollment_id)}</text><rect x="210" y="247" width="260" height="34" rx="17" fill="#edf5f1"/><text x="228" y="270" font-family="Arial" font-size="16" font-weight="700" fill="#0d604f">@${safe(username)}</text><line x1="50" y1="314" x2="950" y2="314" stroke="#dce5de"/><text x="50" y="358" font-family="Arial" font-size="18" fill="#65736b">COURSE / PROGRAMME</text><text x="50" y="393" font-family="Arial" font-size="25" font-weight="700" fill="#132921">${safe(course || 'Not set')}</text><text x="50" y="447" font-family="Arial" font-size="18" fill="#65736b">UNIVERSITY / INSTITUTION</text><text x="50" y="482" font-family="Arial" font-size="23" font-weight="700" fill="#132921">${safe(institution || 'Not set')}</text><rect x="50" y="525" width="900" height="66" rx="18" fill="#eef4eb"/><text x="500" y="566" text-anchor="middle" font-family="Arial" font-size="22" font-style="italic" font-weight="700" fill="#0b5141">I learn my way. I grow with SELFISH LEARNING ACADEMY.</text></svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Content-Disposition', `attachment; filename="${p?.enrollment_id || 'SLA'}-ID-Card.svg"`);
    return res.send(svg);
  }
  res.json({ student: {
    full_name: p?.full_name || a.full_name,
    username,
    enrollment_id: p?.enrollment_id || a.enrollment_id,
    profile_course: p?.profile_course || null,
    profile_institution: p?.profile_institution || null,
    photo_url: p?.photo_mime ? '/api/student/photo' : null,
    course,
    institution,
    tagline: 'I learn my way. I grow with SELFISH LEARNING ACADEMY.'
  } });
} catch (e) { next(e); } });

export default router;
