import express from 'express';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { col, nextCounter } from './mongo.js';
import { requireAdmin, requireStudent, binaryBuffer, uuid, notify } from './auth.js';

const router = express.Router();
const here = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.join(here, '..', 'public', 'sla-logo.svg');

const selfishCode = p => {
  const serial = String(p?.enrollment_id || '').match(/(\d{6})$/)?.[1] || String(p?.id || '').replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase().padStart(6, '0');
  return `SELFISH-${serial}`;
};

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
    col('requests').countDocuments({ status: { $nin: ['Ready','Completed'] } }),
    col('requests').countDocuments({ status: { $in: ['Ready','Completed'] } }),
    col('materials').countDocuments({}),
    col('notifications').countDocuments({ type: { $nin: ['payment','quotation'] } }),
    col('student_thoughts').countDocuments({ approved: true })
  ]);
  res.json({ total_students:totalStudents,new_students_7d:newStudents,active_students_30d:activeStudents,total_requests:totalRequests,pending_requests:pendingRequests,ready_requests:readyRequests,materials_count:materialsCount,notifications_sent:notificationsSent,approved_thoughts:approvedThoughts });
} catch (e) { next(e); } });

router.route('/requests')
.get(async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const docs = await col('requests').find({ user_id: String(a.id) }, { projection: { _id:0,user_id:0,price:0,payment_ref:0,payment_status:0 } }).sort({ created_at:-1 }).toArray();
  res.json({ requests: docs });
} catch (e) { next(e); } })
.post(async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const b = req.body || {};
  const required = ['university','programme','semester','subject','chapter'];
  if (required.some(k => !String(b[k] || '').trim())) return res.status(400).json({ error:'Complete all academic fields.' });
  const materials = Array.isArray(b.materials) ? b.materials.map(String).filter(Boolean).slice(0,12) : [];
  if (!materials.length) return res.status(400).json({ error:'Choose at least one material.' });
  const seq = await nextCounter('request');
  const requestId = `REQ-${String(seq + 1000).padStart(6,'0')}`;
  const now = new Date();
  const doc = {
    id:uuid(),request_id:requestId,user_id:String(a.id),student_name:a.full_name,enrollment_id:a.enrollment_id,
    university:String(b.university).trim(),programme:String(b.programme).trim(),semester:String(b.semester).trim(),
    subject:String(b.subject).trim(),chapter:String(b.chapter).trim(),materials,
    notes:String(b.notes || '').slice(0,2000),status:'Under review',delivery_text:'',access_granted:false,progress:0,created_at:now,updated_at:now
  };
  await col('requests').insertOne(doc);
  const profileSet = {};
  if (!a.profile_course) profileSet.profile_course = doc.programme;
  if (!a.profile_institution) profileSet.profile_institution = doc.university;
  if (Object.keys(profileSet).length) await col('users').updateOne({ id:String(a.id) }, { $set:profileSet });
  await notify(a.id,'Request received',`Thank you. We received ${requestId}. You will be notified here when your request is reviewed or your learning materials are ready.`,'request');
  res.status(201).json({ request:{ request_id:requestId,status:'Under review',created_at:now },message:'Thank you. Your request has been received. You will be notified when it is ready.' });
} catch (e) { next(e); } })
.put(async (req,res) => {
  if (!await requireStudent(req,res)) return;
  res.status(405).json({ error:'The payment-reference workflow is not used on SELFISH LEARNING ACADEMY.' });
});

router.get('/notifications', async (req, res, next) => { try {
  const a = await requireStudent(req,res); if (!a) return;
  const docs = await col('notifications').find({ account_id:String(a.id), type:{ $nin:['payment','quotation'] } }, { projection:{ _id:0,account_id:0 } }).sort({ created_at:-1 }).limit(100).toArray();
  res.json({ notifications:docs, unread:docs.filter(x=>!x.is_read).length });
} catch (e) { next(e); } });

router.route('/student/id-card')
.get(async (req, res, next) => { try {
  const a = await requireStudent(req, res); if (!a) return;
  const p = await col('users').findOne({ id:String(a.id) });
  const latest = await col('requests').findOne({ user_id:String(a.id) }, { sort:{ created_at:-1 }, projection:{ _id:0,programme:1,university:1 } }) || {};
  const course = p?.profile_course || latest.programme || '';
  const institution = p?.profile_institution || latest.university || '';
  const idName = p?.profile_id_name || p?.full_name || a.full_name || 'Student';
  const code = selfishCode(p || a);
  if (String(req.query?.download || '') === '1') {
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition',`attachment; filename="${code}-Student-ID.pdf"`);
    const doc = new PDFDocument({ size:[860,540], margin:0, info:{ Title:`${idName} - SELFISH Student ID`, Author:'SELFISH LEARNING ACADEMY' } });
    doc.pipe(res);
    doc.rect(0,0,860,540).fill('#FBFCF8');
    doc.rect(0,0,860,112).fill('#0B4F43');
    try {
      const logo = await sharp(logoPath).resize({ width:220, height:76, fit:'contain', background:'#ffffff' }).png().toBuffer();
      doc.roundedRect(30,18,230,76,12).fill('#FFFFFF');
      doc.image(logo,35,22,{ fit:[220,68], align:'center', valign:'center' });
    } catch {
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(22).text('SELFISH LEARNING ACADEMY',34,42,{width:360});
    }
    doc.fillColor('#F2CF72').font('Helvetica-Bold').fontSize(15).text('SELFISH STUDENT',610,48,{width:210,align:'right'});
    const photo = binaryBuffer(p?.photo_data);
    if (photo) {
      try {
        const img = await sharp(photo).rotate().resize(170,205,{ fit:'cover', position:'centre' }).jpeg({ quality:90 }).toBuffer();
        doc.save();doc.roundedRect(42,145,170,205,18).clip();doc.image(img,42,145,{width:170,height:205});doc.restore();
      } catch {
        doc.roundedRect(42,145,170,205,18).fill('#E9F1ED');doc.fillColor('#0B604F').font('Helvetica-Bold').fontSize(54).text(String(idName)[0]?.toUpperCase()||'S',42,216,{width:170,align:'center'});
      }
    } else {
      doc.roundedRect(42,145,170,205,18).fill('#E9F1ED');doc.fillColor('#0B604F').font('Helvetica-Bold').fontSize(54).text(String(idName)[0]?.toUpperCase()||'S',42,216,{width:170,align:'center'});
    }
    doc.fillColor('#66776F').font('Helvetica-Bold').fontSize(10).text('ID NAME',244,146);
    doc.fillColor('#132B25').font('Helvetica-Bold').fontSize(28).text(idName,244,164,{width:560,ellipsis:true});
    doc.fillColor('#0D604F').font('Helvetica-Bold').fontSize(13).text(`SELFISH CODE  ${code}`,244,213,{width:560});
    doc.fillColor('#708079').font('Helvetica').fontSize(11).text(`ACADEMY ID  ${p?.enrollment_id || a.enrollment_id || ''}`,244,239,{width:560});
    doc.moveTo(244,270).lineTo(818,270).strokeColor('#D9E4DE').lineWidth(1).stroke();
    doc.fillColor('#697A72').font('Helvetica-Bold').fontSize(10).text('COURSE / PROGRAMME',244,293);
    doc.fillColor('#17312A').font('Helvetica-Bold').fontSize(18).text(course || 'Not set',244,311,{width:560,ellipsis:true});
    doc.fillColor('#697A72').font('Helvetica-Bold').fontSize(10).text('UNIVERSITY / INSTITUTION',244,359);
    doc.fillColor('#17312A').font('Helvetica-Bold').fontSize(16).text(institution || 'Not set',244,377,{width:560,ellipsis:true});
    doc.roundedRect(42,430,776,68,16).fill('#EEF5F1');
    doc.fillColor('#0B5141').font('Helvetica-BoldOblique').fontSize(15).text('I learn my way. I grow with SELFISH LEARNING ACADEMY.',62,454,{width:736,align:'center'});
    doc.fillColor('#8A9A92').font('Helvetica').fontSize(8).text('Digital student identity · Generated by SELFISH LEARNING ACADEMY',42,514,{width:776,align:'center'});
    doc.end();return;
  }
  res.json({ student:{
    full_name:p?.full_name || a.full_name,username:p?.username || a.username,enrollment_id:p?.enrollment_id || a.enrollment_id,
    id_name:idName,selfish_code:code,profile_course:p?.profile_course || null,profile_institution:p?.profile_institution || null,
    photo_url:p?.photo_mime?'/api/student/photo':null,course,institution,tagline:'I learn my way. I grow with SELFISH LEARNING ACADEMY.'
  } });
} catch (e) { next(e); } })
.put(async (req,res,next) => { try {
  const a = await requireStudent(req,res); if (!a) return;
  const set = {};
  if (req.body?.course != null) set.profile_course = String(req.body.course).trim().slice(0,120);
  if (req.body?.institution != null) set.profile_institution = String(req.body.institution).trim().slice(0,160);
  if (req.body?.idName != null) set.profile_id_name = String(req.body.idName).trim().slice(0,60) || a.full_name;
  if (Object.keys(set).length) await col('users').updateOne({ id:String(a.id) }, { $set:set });
  const p = await col('users').findOne({ id:String(a.id) });
  res.json({ student:{ ...a,course:p?.profile_course || '',institution:p?.profile_institution || '',profile_course:p?.profile_course || null,profile_institution:p?.profile_institution || null,id_name:p?.profile_id_name || p?.full_name,selfish_code:selfishCode(p),photo_url:p?.photo_mime?'/api/student/photo':null,tagline:'I learn my way. I grow with SELFISH LEARNING ACADEMY.' } });
} catch (e) { next(e); } });

export default router;
