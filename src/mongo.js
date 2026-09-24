import { MongoClient } from 'mongodb';
import pg from 'pg';

const { Pool } = pg;
const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'easy_learning';
const client = uri ? new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 10000 }) : null;
let database;

export const col = name => database.collection(name);
export const db = () => database;

export async function initMongo() {
  if (!client) throw new Error('MONGODB_URI is not configured');
  await client.connect();
  database = client.db(dbName);
  await database.command({ ping: 1 });
  await Promise.all([
    col('users').createIndex({ username: 1 }, { unique: true, sparse: true }),
    col('users').createIndex({ enrollment_id: 1 }, { unique: true, sparse: true }),
    col('users').createIndex({ id: 1 }, { unique: true, sparse: true }),
    col('sessions').createIndex({ token_hash: 1 }, { unique: true, sparse: true }),
    col('sessions').createIndex({ account_id: 1 }),
    col('sessions').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    col('requests').createIndex({ request_id: 1 }, { unique: true, sparse: true }),
    col('requests').createIndex({ user_id: 1, created_at: -1 }),
    col('materials').createIndex({ id: 1 }, { unique: true, sparse: true }),
    col('materials').createIndex({ request_id: 1, created_at: -1 }),
    col('notifications').createIndex({ id: 1 }, { unique: true, sparse: true }),
    col('notifications').createIndex({ account_id: 1, created_at: -1 }),
    col('student_thoughts').createIndex({ id: 1 }, { unique: true, sparse: true }),
    col('student_thoughts').createIndex({ approved: 1, created_at: -1 }),
    col('admin_sessions').createIndex({ token_hash: 1 }, { unique: true, sparse: true }),
    col('admin_sessions').createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    col('contact_messages').createIndex({ created_at: -1 })
  ]);
  await col('admin_security').updateOne(
    { _id: 'main' },
    { $setOnInsert: { code_salt: null, code_hash: null, setup_token_hash: null, created_at: new Date(), updated_at: new Date() } },
    { upsert: true }
  );
}

export async function nextCounter(name) {
  const r = await col('counters').findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  const doc = r?.value || r;
  return Number(doc?.seq || 1);
}

async function upsertRows(collectionName, rows, key, transform = x => x) {
  if (!rows?.length) return;
  const ops = rows.map(row => {
    const doc = transform(row);
    return { updateOne: { filter: { [key]: doc[key] }, update: { $set: doc }, upsert: true } };
  });
  await col(collectionName).bulkWrite(ops, { ordered: false });
}

export async function migratePostgresOnce() {
  if (process.env.MIGRATE_POSTGRES !== '1' || !process.env.DATABASE_URL) return;
  if ((await col('migration_meta').findOne({ _id: 'railway-postgres-v1' }))?.done) return;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false, max: 2 });
  const rows = async table => {
    try { return (await pool.query(`SELECT * FROM ${table}`)).rows; }
    catch (e) { if (e?.code === '42P01') return []; throw e; }
  };

  try {
    const users = await rows('student_accounts');
    await upsertRows('users', users, 'id', r => ({
      id: String(r.id), username: r.username, full_name: r.full_name,
      pin_salt: r.pin_salt, pin_hash: r.pin_hash, language: r.language || 'English',
      enrollment_id: r.enrollment_id, created_at: r.created_at || new Date(),
      last_login_at: r.last_login_at || null, profile_course: r.profile_course || null,
      profile_institution: r.profile_institution || null, photo_data: r.photo_data || null,
      photo_mime: r.photo_mime || null
    }));

    const sessions = await rows('student_sessions');
    await upsertRows('sessions', sessions, 'token_hash', r => ({
      token_hash: r.token_hash, account_id: String(r.account_id),
      expires_at: r.expires_at, created_at: r.created_at || new Date()
    }));

    const requests = await rows('learning_requests');
    await upsertRows('requests', requests, 'request_id', r => ({
      id: String(r.id), request_id: r.request_id, user_id: String(r.user_id),
      student_name: r.student_name || '', enrollment_id: r.enrollment_id || '',
      university: r.university, programme: r.programme, semester: r.semester,
      subject: r.subject, chapter: r.chapter,
      materials: Array.isArray(r.materials) ? r.materials : [], notes: r.notes || '',
      status: r.status || 'Under review', price: r.price == null ? null : Number(r.price),
      delivery_text: r.delivery_text || '', payment_ref: r.payment_ref || '',
      payment_status: r.payment_status || 'Pending', access_granted: !!r.access_granted,
      progress: Number(r.progress || 0), created_at: r.created_at || new Date(),
      updated_at: r.updated_at || r.created_at || new Date()
    }));

    const materials = await rows('learning_materials');
    await upsertRows('materials', materials, 'id', r => ({
      id: String(r.id), request_id: r.request_id, title: r.title, kind: r.kind,
      url: r.url, description: r.description || '', created_at: r.created_at || new Date()
    }));

    const contacts = await rows('contact_messages');
    await upsertRows('contact_messages', contacts, 'id', r => ({
      id: String(r.id), name: r.name, email: r.email, message: r.message,
      created_at: r.created_at || new Date()
    }));

    const notifications = await rows('student_notifications');
    await upsertRows('notifications', notifications, 'id', r => ({
      id: String(r.id), account_id: String(r.account_id), title: r.title,
      message: r.message, type: r.type || 'info', is_read: !!r.is_read,
      created_at: r.created_at || new Date()
    }));

    const thoughts = await rows('student_thoughts');
    await upsertRows('student_thoughts', thoughts, 'id', r => ({
      id: String(r.id), account_id: String(r.account_id), student_name: r.student_name,
      course: r.course, thought: r.thought, approved: !!r.approved,
      created_at: r.created_at || new Date()
    }));

    const admin = await rows('sla_admin_security');
    if (admin[0]) {
      const r = admin[0];
      await col('admin_security').updateOne({ _id: 'main' }, { $set: {
        code_salt: r.code_salt || null, code_hash: r.code_hash || null,
        setup_token_hash: r.setup_token_hash || null,
        created_at: r.created_at || new Date(), updated_at: r.updated_at || new Date()
      } }, { upsert: true });
    }

    const adminSessions = await rows('sla_admin_sessions');
    await upsertRows('admin_sessions', adminSessions, 'token_hash', r => ({
      token_hash: r.token_hash, expires_at: r.expires_at, created_at: r.created_at || new Date()
    }));

    const enrollDocs = await col('users').find({}, { projection: { _id: 0, enrollment_id: 1 } }).toArray();
    const requestDocs = await col('requests').find({}, { projection: { _id: 0, request_id: 1 } }).toArray();
    const maxEnrollment = enrollDocs.reduce((m, x) => Math.max(m, Number(String(x.enrollment_id || '').match(/(\d{6})$/)?.[1] || 0)), 0);
    const maxRequestNumber = requestDocs.reduce((m, x) => Math.max(m, Number(String(x.request_id || '').match(/(\d{6})$/)?.[1] || 0)), 0);
    await col('counters').updateOne({ _id: 'enrollment' }, { $max: { seq: maxEnrollment } }, { upsert: true });
    await col('counters').updateOne({ _id: 'request' }, { $max: { seq: Math.max(0, maxRequestNumber - 1000) } }, { upsert: true });
    await col('migration_meta').updateOne({ _id: 'railway-postgres-v1' }, { $set: {
      done: true, migrated_at: new Date(), source: 'Railway PostgreSQL', target: 'MongoDB Atlas'
    } }, { upsert: true });
    console.log(`PostgreSQL to MongoDB migration complete: ${users.length} students, ${requests.length} requests.`);
  } finally {
    await pool.end().catch(() => {});
  }
}
