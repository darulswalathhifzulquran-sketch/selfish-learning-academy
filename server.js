import express from 'express';
import pg from 'pg';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false } });
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '5m' }));

const SESSION_DAYS = 30;
const ADMIN_SESSION_DAYS = 7;
const allowedPhotoMimes = new Set(['image/jpeg','image/png','image/webp']);
const q = (text, params=[]) => pool.query(text, params);
const uuid = () => crypto.randomUUID();
const token = (bytes=32) => crypto.randomBytes(bytes).toString('base64url');
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const salt = () => crypto.randomBytes(16).toString('hex');
const pinHash = (pin, s, iterations=210000) => crypto.pbkdf2Sync(String(pin), String(s), iterations, 32, 'sha256').toString('hex');
const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

async function ensureSchema(){
  const stmts = [
    `CREATE SEQUENCE IF NOT EXISTS sla_enrollment_seq START 1`,
    `CREATE SEQUENCE IF NOT EXISTS sla_request_seq START 1001`,
    `CREATE TABLE IF NOT EXISTS student_accounts (
      id uuid PRIMARY KEY,
      username text UNIQUE NOT NULL,
      full_name text NOT NULL,
      pin_salt text NOT NULL,
      pin_hash text NOT NULL,
      language text NOT NULL DEFAULT 'English',
      enrollment_id text UNIQUE NOT NULL,
      profile_course text,
      profile_institution text,
      photo_data bytea,
      photo_mime text,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_login_at timestamptz
    )`,
    `CREATE TABLE IF NOT EXISTS student_sessions (
      token_hash text PRIMARY KEY,
      account_id uuid NOT NULL REFERENCES student_accounts(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS learning_requests (
      id uuid PRIMARY KEY,
      request_id text UNIQUE NOT NULL,
      user_id uuid NOT NULL REFERENCES student_accounts(id) ON DELETE CASCADE,
      student_name text,
      enrollment_id text,
      university text NOT NULL,
      programme text NOT NULL,
      semester text NOT NULL,
      subject text NOT NULL,
      chapter text NOT NULL,
      materials jsonb NOT NULL DEFAULT '[]'::jsonb,
      notes text,
      status text NOT NULL DEFAULT 'Under review',
      price numeric,
      delivery_text text,
      payment_ref text,
      payment_status text NOT NULL DEFAULT 'Pending',
      access_granted boolean NOT NULL DEFAULT false,
      progress integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS learning_materials (
      id uuid PRIMARY KEY,
      request_id text NOT NULL REFERENCES learning_requests(request_id) ON DELETE CASCADE,
      title text NOT NULL,
      kind text NOT NULL,
      url text NOT NULL,
      description text,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS student_notifications (
      id uuid PRIMARY KEY,
      account_id uuid NOT NULL REFERENCES student_accounts(id) ON DELETE CASCADE,
      title text NOT NULL,
      message text NOT NULL,
      type text NOT NULL DEFAULT 'info',
      is_read boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS student_thoughts (
      id uuid PRIMARY KEY,
      account_id uuid NOT NULL REFERENCES student_accounts(id) ON DELETE CASCADE,
      student_name text NOT NULL,
      course text NOT NULL,
      thought text NOT NULL,
      approved boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS contact_messages (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      email text NOT NULL,
      message text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS sla_admin_security (
      id integer PRIMARY KEY,
      code_salt text,
      code_hash text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `INSERT INTO sla_admin_security(id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
    `CREATE TABLE IF NOT EXISTS sla_admin_sessions (
      token_hash text PRIMARY KEY,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_requests_user ON learning_requests(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user ON student_notifications(account_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_materials_request ON learning_materials(request_id, created_at DESC)`
  ];
  for(const s of stmts) await q(s);
  await q(`DELETE FROM student_sessions WHERE expires_at < now()`);
  await q(`DELETE FROM sla_admin_sessions WHERE expires_at < now()`);
}

function studentCookie(res, raw){
  res.cookie('sla_session', raw, { httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:'lax', maxAge:SESSION_DAYS*86400000, path:'/' });
}
function adminCookie(res, raw){
  res.cookie('sla_admin', raw, { httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:'lax', maxAge:ADMIN_SESSION_DAYS*86400000, path:'/' });
}
async function createStudentSession(res, accountId){
  const raw=token();
  await q(`INSERT INTO student_sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '${SESSION_DAYS} days')`,[sha(raw),accountId]);
  studentCookie(res,raw);
}
async function createAdminSession(res){
  const raw=token();
  await q(`INSERT INTO sla_admin_sessions(token_hash,expires_at) VALUES($1,now()+interval '${ADMIN_SESSION_DAYS} days')`,[sha(raw)]);
  adminCookie(res,raw);
}
async function getStudent(req){
  const raw=req.cookies?.sla_session;
  if(!raw) return null;
  const {rows}=await q(`SELECT a.id,a.username,a.full_name,a.language,a.enrollment_id,a.profile_course,a.profile_institution,a.created_at,
    CASE WHEN a.photo_data IS NULL THEN NULL ELSE '/api/student/photo' END AS photo_url
    FROM student_sessions s JOIN student_accounts a ON a.id=s.account_id
    WHERE s.token_hash=$1 AND s.expires_at>now()`,[sha(raw)]);
  return rows[0]||null;
}
async function requireStudent(req,res){
  const s=await getStudent(req);
  if(!s){res.status(401).json({error:'Please log in.'});return null;}
  return s;
}
async function isAdmin(req){
  const raw=req.cookies?.sla_admin;
  if(!raw) return false;
  const {rows}=await q(`SELECT 1 FROM sla_admin_sessions WHERE token_hash=$1 AND expires_at>now()`,[sha(raw)]);
  return !!rows.length;
}
async function requireAdmin(req,res){
  if(!(await isAdmin(req))){res.status(401).json({error:'Admin access code required.'});return false;}
  return true;
}
async function notify(accountId,title,message,type='info'){
  await q(`INSERT INTO student_notifications(id,account_id,title,message,type) VALUES($1,$2,$3,$4,$5)`,[uuid(),accountId,title,message,type]);
}

app.post('/api/student/register', async(req,res,next)=>{try{
  const fullName=String(req.body?.fullName||'').trim().slice(0,100);
  const username=String(req.body?.username||'').trim().toLowerCase();
  const pin=String(req.body?.pin||'');
  const language=['English','Malayalam','Arabic'].includes(String(req.body?.language))?String(req.body.language):'English';
  if(fullName.length<2)return res.status(400).json({error:'Enter your full name.'});
  if(!/^[a-z0-9_.-]{3,30}$/.test(username))return res.status(400).json({error:'Username must be 3–30 characters using letters, numbers, dot, underscore or hyphen.'});
  if(pin.length<6||pin.length>64)return res.status(400).json({error:'PIN/password must be at least 6 characters.'});
  const ex=await q(`SELECT 1 FROM student_accounts WHERE username=$1`,[username]);
  if(ex.rows.length)return res.status(409).json({error:'That username is already taken.'});
  const seq=await q(`SELECT nextval('sla_enrollment_seq') AS seq`);
  const enrollmentId=`SLA-${new Date().getFullYear()}-${String(Number(seq.rows[0].seq)).padStart(6,'0')}`;
  const s=salt(), h=pinHash(pin,s), id=uuid();
  const r=await q(`INSERT INTO student_accounts(id,username,full_name,pin_salt,pin_hash,language,enrollment_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,username,full_name,language,enrollment_id,profile_course,profile_institution,created_at`,[id,username,fullName,s,h,language,enrollmentId]);
  await createStudentSession(res,id);
  await notify(id,'Welcome to SELFISH LEARNING ACADEMY','Your student learning space is ready.','info');
  res.status(201).json({student:r.rows[0]});
}catch(e){next(e)}});

app.post('/api/student/login', async(req,res,next)=>{try{
  const username=String(req.body?.username||'').trim().toLowerCase(), pin=String(req.body?.pin||'');
  const r=await q(`SELECT * FROM student_accounts WHERE username=$1`,[username]);
  const a=r.rows[0];
  if(!a||pinHash(pin,a.pin_salt)!==a.pin_hash)return res.status(401).json({error:'Incorrect username or PIN/password.'});
  await q(`UPDATE student_accounts SET last_login_at=now() WHERE id=$1`,[a.id]);
  await createStudentSession(res,a.id);
  res.json({student:{id:a.id,username:a.username,full_name:a.full_name,language:a.language,enrollment_id:a.enrollment_id,profile_course:a.profile_course,profile_institution:a.profile_institution,photo_url:a.photo_data?'/api/student/photo':null}});
}catch(e){next(e)}});

app.post('/api/student/logout', async(req,res,next)=>{try{
  const raw=req.cookies?.sla_session;if(raw)await q(`DELETE FROM student_sessions WHERE token_hash=$1`,[sha(raw)]);
  res.clearCookie('sla_session',{path:'/'});res.json({ok:true});
}catch(e){next(e)}});

app.get('/api/student/me', async(req,res,next)=>{try{res.json({student:await getStudent(req)});}catch(e){next(e)}});

app.route('/api/requests')
.get(async(req,res,next)=>{try{const s=await requireStudent(req,res);if(!s)return;const r=await q(`SELECT * FROM learning_requests WHERE user_id=$1 ORDER BY created_at DESC`,[s.id]);res.json({requests:r.rows});}catch(e){next(e)}})
.post(async(req,res,next)=>{try{
  const s=await requireStudent(req,res);if(!s)return;
  const b=req.body||{}, materials=Array.isArray(b.materials)?b.materials.map(String).slice(0,12):[];
  const required=['university','programme','semester','subject','chapter']; for(const k of required){if(!String(b[k]||'').trim())return res.status(400).json({error:`${k} is required.`});}
  if(!materials.length)return res.status(400).json({error:'Choose at least one material.'});
  const seq=await q(`SELECT nextval('sla_request_seq') AS seq`), rid=`SLA-REQ-${String(Number(seq.rows[0].seq)).padStart(6,'0')}`;
  const id=uuid();
  const r=await q(`INSERT INTO learning_requests(id,request_id,user_id,student_name,enrollment_id,university,programme,semester,subject,chapter,materials,notes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) RETURNING *`,[id,rid,s.id,s.full_name,s.enrollment_id,String(b.university).slice(0,160),String(b.programme).slice(0,160),String(b.semester).slice(0,100),String(b.subject).slice(0,180),String(b.chapter).slice(0,180),JSON.stringify(materials),String(b.notes||'').slice(0,1200)]);
  await notify(s.id,'Request received',`Thank you. ${rid} is now under review. We’ll notify you when there is an update.`,'info');
  res.status(201).json({request:r.rows[0]});
}catch(e){next(e)}});

app.get('/api/materials', async(req,res,next)=>{try{
  const s=await requireStudent(req,res);if(!s)return;
  const r=await q(`SELECT m.* FROM learning_materials m JOIN learning_requests r ON r.request_id=m.request_id WHERE r.user_id=$1 AND r.access_granted=true ORDER BY m.created_at DESC`,[s.id]);
  res.json({materials:r.rows});
}catch(e){next(e)}});

app.route('/api/notifications')
.get(async(req,res,next)=>{try{const s=await requireStudent(req,res);if(!s)return;const r=await q(`SELECT * FROM student_notifications WHERE account_id=$1 ORDER BY created_at DESC LIMIT 100`,[s.id]);res.json({notifications:r.rows});}catch(e){next(e)}})
.put(async(req,res,next)=>{try{const s=await requireStudent(req,res);if(!s)return;if(req.body?.all){await q(`UPDATE student_notifications SET is_read=true WHERE account_id=$1`,[s.id]);}else if(req.body?.id){await q(`UPDATE student_notifications SET is_read=true WHERE id=$1 AND account_id=$2`,[String(req.body.id),s.id]);}res.json({ok:true});}catch(e){next(e)}});

app.route('/api/thoughts')
.get(async(req,res,next)=>{try{const r=await q(`SELECT id,student_name,course,thought,created_at FROM student_thoughts WHERE approved=true ORDER BY created_at DESC LIMIT 30`);res.json({thoughts:r.rows});}catch(e){next(e)}})
.post(async(req,res,next)=>{try{const s=await requireStudent(req,res);if(!s)return;const course=String(req.body?.course||'').trim().slice(0,150), thought=String(req.body?.thought||'').trim().slice(0,500);if(course.length<2||thought.length<12)return res.status(400).json({error:'Please enter your course and a meaningful thought.'});await q(`INSERT INTO student_thoughts(id,account_id,student_name,course,thought) VALUES($1,$2,$3,$4,$5)`,[uuid(),s.id,s.full_name,course,thought]);res.status(201).json({message:'Your thought was submitted for review. It will appear publicly only after approval.'});}catch(e){next(e)}});

app.route('/api/student/id-card')
.get(async(req,res,next)=>{try{
  const s=await requireStudent(req,res);if(!s)return;
  const r=await q(`SELECT full_name,username,enrollment_id,profile_course,profile_institution,photo_data,photo_mime FROM student_accounts WHERE id=$1`,[s.id]);const p=r.rows[0];
  const latest=(await q(`SELECT programme,university FROM learning_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1`,[s.id])).rows[0]||{};
  const course=p.profile_course||latest.programme||'', institution=p.profile_institution||latest.university||'';
  if(String(req.query?.download||'')==='1'){
    let avatar=`<rect x="50" y="128" width="126" height="148" rx="18" fill="#edf3e9"/><text x="113" y="213" text-anchor="middle" font-size="42" font-family="Arial" font-weight="700" fill="#146a50">${safe((p.full_name||'S')[0]?.toUpperCase())}</text>`;
    if(p.photo_data){const data=Buffer.from(p.photo_data).toString('base64');avatar=`<image href="data:${p.photo_mime||'image/jpeg'};base64,${data}" x="50" y="128" width="126" height="148" preserveAspectRatio="xMidYMid slice"/>`;}
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="630" viewBox="0 0 1000 630"><rect width="1000" height="630" rx="34" fill="#fbfcf8"/><rect width="1000" height="104" fill="#0b5141"/><text x="50" y="63" font-family="Arial" font-size="34" font-weight="800" fill="#ffffff">SELFISH LEARNING ACADEMY</text><text x="950" y="63" text-anchor="end" font-family="Arial" font-size="20" font-weight="700" fill="#e2ba56">SELFISH STUDENT</text>${avatar}<text x="210" y="158" font-family="Arial" font-size="20" fill="#65736b">STUDENT NAME</text><text x="210" y="197" font-family="Arial" font-size="34" font-weight="800" fill="#132921">${safe(p.full_name)}</text><text x="210" y="244" font-family="Arial" font-size="18" fill="#65736b">ID: ${safe(p.enrollment_id)}</text><line x1="50" y1="314" x2="950" y2="314" stroke="#dce5de"/><text x="50" y="358" font-family="Arial" font-size="18" fill="#65736b">COURSE / PROGRAMME</text><text x="50" y="393" font-family="Arial" font-size="25" font-weight="700" fill="#132921">${safe(course||'Not set')}</text><text x="50" y="447" font-family="Arial" font-size="18" fill="#65736b">UNIVERSITY / INSTITUTION</text><text x="50" y="482" font-family="Arial" font-size="23" font-weight="700" fill="#132921">${safe(institution||'Not set')}</text><rect x="50" y="525" width="900" height="66" rx="18" fill="#eef4eb"/><text x="500" y="566" text-anchor="middle" font-family="Arial" font-size="22" font-style="italic" font-weight="700" fill="#0b5141">I learn my way. I grow with SELFISH LEARNING ACADEMY.</text></svg>`;
    res.setHeader('Content-Type','image/svg+xml');res.setHeader('Content-Disposition',`attachment; filename="${p.enrollment_id||'SLA'}-ID-Card.svg"`);return res.send(svg);
  }
  res.json({student:{full_name:p.full_name,username:p.username,enrollment_id:p.enrollment_id,profile_course:p.profile_course,profile_institution:p.profile_institution,photo_url:p.photo_data?'/api/student/photo':null,course,institution,tagline:'I learn my way. I grow with SELFISH LEARNING ACADEMY.'}});
}catch(e){next(e)}})
.put(async(req,res,next)=>{try{const s=await requireStudent(req,res);if(!s)return;const course=String(req.body?.course||'').trim().slice(0,120),institution=String(req.body?.institution||'').trim().slice(0,160);await q(`UPDATE student_accounts SET profile_course=$1,profile_institution=$2 WHERE id=$3`,[course,institution,s.id]);res.json({student:{...s,course,institution,profile_course:course,profile_institution:institution,photo_url:s.photo_url||null}});}catch(e){next(e)}});

app.get('/api/student/photo', async(req,res,next)=>{try{const s=await requireStudent(req,res);if(!s)return;const r=await q(`SELECT photo_data,photo_mime FROM student_accounts WHERE id=$1`,[s.id]);const p=r.rows[0];if(!p?.photo_data)return res.status(404).end();res.type(p.photo_mime||'image/jpeg').send(p.photo_data);}catch(e){next(e)}});
app.post('/api/student/photo', upload.single('photo'), async(req,res,next)=>{try{const s=await requireStudent(req,res);if(!s)return;if(!req.file)return res.status(400).json({error:'Choose a photo.'});if(!allowedPhotoMimes.has(req.file.mimetype))return res.status(400).json({error:'Use JPG, PNG or WebP.'});await q(`UPDATE student_accounts SET photo_data=$1,photo_mime=$2 WHERE id=$3`,[req.file.buffer,req.file.mimetype,s.id]);res.json({photoUrl:'/api/student/photo'});}catch(e){next(e)}});

app.post('/api/contact', async(req,res,next)=>{try{const name=String(req.body?.name||'').trim().slice(0,120), email=String(req.body?.email||'').trim().slice(0,180), message=String(req.body?.message||'').trim().slice(0,2000);if(!name||!email||!message)return res.status(400).json({error:'Please complete all fields.'});await q(`INSERT INTO contact_messages(id,name,email,message) VALUES($1,$2,$3,$4)`,[uuid(),name,email,message]);res.status(201).json({ok:true});}catch(e){next(e)}});

app.get('/api/admin/auth/status', async(req,res,next)=>{try{const r=await q(`SELECT code_hash FROM sla_admin_security WHERE id=1`);res.json({configured:!!r.rows[0]?.code_hash,authenticated:await isAdmin(req)});}catch(e){next(e)}});
app.post('/api/admin/auth/setup', async(req,res,next)=>{try{
  const r=await q(`SELECT code_hash FROM sla_admin_security WHERE id=1`);if(r.rows[0]?.code_hash)return res.status(409).json({error:'Admin access code is already configured.'});
  const expected=String(process.env.ADMIN_BOOTSTRAP_TOKEN||'');const supplied=String(req.body?.setupToken||'');if(expected&&supplied!==expected)return res.status(403).json({error:'Invalid first-time setup link.'});
  const code=String(req.body?.code||'');if(code.length<6||code.length>64)return res.status(400).json({error:'Access code must be at least 6 characters.'});const s=salt(),h=pinHash(code,s,240000);await q(`UPDATE sla_admin_security SET code_salt=$1,code_hash=$2,updated_at=now() WHERE id=1`,[s,h]);await createAdminSession(res);res.json({ok:true});
}catch(e){next(e)}});
app.post('/api/admin/auth/login', async(req,res,next)=>{try{const code=String(req.body?.code||'');const r=await q(`SELECT code_salt,code_hash FROM sla_admin_security WHERE id=1`);const a=r.rows[0];if(!a?.code_hash)return res.status(409).json({error:'Admin access code has not been configured yet.'});if(pinHash(code,a.code_salt,240000)!==a.code_hash)return res.status(401).json({error:'Incorrect admin access code.'});await createAdminSession(res);res.json({ok:true});}catch(e){next(e)}});
app.post('/api/admin/auth/logout', async(req,res,next)=>{try{const raw=req.cookies?.sla_admin;if(raw)await q(`DELETE FROM sla_admin_sessions WHERE token_hash=$1`,[sha(raw)]);res.clearCookie('sla_admin',{path:'/'});res.json({ok:true});}catch(e){next(e)}});

app.route('/api/admin/requests')
.get(async(req,res,next)=>{try{if(!(await requireAdmin(req,res)))return;const r=await q(`SELECT * FROM learning_requests ORDER BY created_at DESC`);res.json({requests:r.rows});}catch(e){next(e)}})
.put(async(req,res,next)=>{try{
  if(!(await requireAdmin(req,res)))return;const b=req.body||{},rid=String(b.requestId||'');const old=(await q(`SELECT * FROM learning_requests WHERE request_id=$1`,[rid])).rows[0];if(!old)return res.status(404).json({error:'Request not found.'});
  const status=String(b.status||old.status).slice(0,80), price=b.price===''||b.price==null?null:Number(b.price), delivery=String(b.deliveryText||'').slice(0,200), payment=String(b.paymentStatus||old.payment_status).slice(0,50), access=!!b.accessGranted, progress=Math.max(0,Math.min(100,Number(b.progress||0)));
  const r=await q(`UPDATE learning_requests SET status=$1,price=$2,delivery_text=$3,payment_status=$4,access_granted=$5,progress=$6,updated_at=now() WHERE request_id=$7 RETURNING *`,[status,Number.isFinite(price)?price:null,delivery,payment,access,progress,rid]);
  const uid=old.user_id;
  if(status!==old.status)await notify(uid,'Request status updated',`${rid} is now: ${status}.`,/ready|completed/i.test(status)?'ready':'info');
  if(String(price??'')!==String(old.price??''))await notify(uid,'Quotation updated',price!=null?`A quotation of ₹${price} is available for ${rid}.`:`Quotation details were updated for ${rid}.`,'info');
  if(payment!==old.payment_status)await notify(uid,'Payment update',`${rid} payment status: ${payment}.`,'payment');
  if(access&&!old.access_granted)await notify(uid,'Learning access granted',`Your approved materials for ${rid} are ready in your Learning Library.`,'ready');
  res.json({request:r.rows[0]});
}catch(e){next(e)}});

app.route('/api/admin/materials')
.get(async(req,res,next)=>{try{if(!(await requireAdmin(req,res)))return;const r=await q(`SELECT * FROM learning_materials ORDER BY created_at DESC`);res.json({materials:r.rows});}catch(e){next(e)}})
.post(async(req,res,next)=>{try{if(!(await requireAdmin(req,res)))return;const b=req.body||{},rid=String(b.requestId||'').trim(),title=String(b.title||'').trim().slice(0,200),kind=String(b.kind||'').trim().slice(0,100),url=String(b.url||'').trim().slice(0,1000),description=String(b.description||'').trim().slice(0,1000);const rr=(await q(`SELECT user_id FROM learning_requests WHERE request_id=$1`,[rid])).rows[0];if(!rr)return res.status(404).json({error:'Request ID not found.'});if(!title||!url)return res.status(400).json({error:'Title and resource URL are required.'});const r=await q(`INSERT INTO learning_materials(id,request_id,title,kind,url,description) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,[uuid(),rid,title,kind,url,description]);await notify(rr.user_id,'New learning material',`${title} has been added for ${rid}.`,'material');res.status(201).json({material:r.rows[0]});}catch(e){next(e)}})
.delete(async(req,res,next)=>{try{if(!(await requireAdmin(req,res)))return;await q(`DELETE FROM learning_materials WHERE id=$1`,[String(req.body?.id||'')]);res.json({ok:true});}catch(e){next(e)}});

app.route('/api/admin/thoughts')
.get(async(req,res,next)=>{try{if(!(await requireAdmin(req,res)))return;const r=await q(`SELECT * FROM student_thoughts ORDER BY created_at DESC`);res.json({thoughts:r.rows});}catch(e){next(e)}})
.put(async(req,res,next)=>{try{if(!(await requireAdmin(req,res)))return;await q(`UPDATE student_thoughts SET approved=$1 WHERE id=$2`,[!!req.body?.approved,String(req.body?.id||'')]);res.json({ok:true});}catch(e){next(e)}})
.delete(async(req,res,next)=>{try{if(!(await requireAdmin(req,res)))return;await q(`DELETE FROM student_thoughts WHERE id=$1`,[String(req.body?.id||'')]);res.json({ok:true});}catch(e){next(e)}});

app.get('/health', (_req,res)=>res.json({ok:true,name:'SELFISH LEARNING ACADEMY'}));
app.get('*path', (req,res)=>{ if(req.path.startsWith('/api/')) return res.status(404).json({error:'Not found'}); res.sendFile(path.join(__dirname,'public','index.html')); });
app.use((err,req,res,next)=>{console.error(err);if(err?.code==='LIMIT_FILE_SIZE')return res.status(400).json({error:'Photo must be 5 MB or smaller.'});res.status(500).json({error:'Something went wrong. Please try again.'});});

ensureSchema().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`SELFISH LEARNING ACADEMY listening on ${PORT}`))).catch(err=>{console.error('Database init failed',err);process.exit(1);});
