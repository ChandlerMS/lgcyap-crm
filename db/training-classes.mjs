import { getPool } from './pool.mjs';
import { TRAINING_SCHEMA } from './training-classes-schema.mjs';
import { classError, classIdentity, validateClass } from '../lib/training-classes.mjs';
export { TRAINING_SCHEMA };
let initialized;
export async function trainingDb() {
  const pool = getPool();
  initialized ??= (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(50894788, 1414)');
      await client.query(TRAINING_SCHEMA);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  })().catch(error => { initialized = null; throw error; });
  await initialized;
  return pool;
}
const columns = 'id, name, start_at, end_at, trainer, location, meeting_url, notes, status, version, updated_at';
function record(row) {
  return { id: row.id, name: row.name, startAt: new Date(row.start_at).toISOString(), endAt: new Date(row.end_at).toISOString(), trainer: row.trainer, location: row.location, meetingUrl: row.meeting_url, notes: row.notes, status: row.status, version: row.version, updatedAt: new Date(row.updated_at).toISOString() };
}
export async function listClasses(database) {
  const db = database ?? await trainingDb();
  return (await db.query(`SELECT ${columns} FROM training_classes ORDER BY start_at, id`)).rows.map(record);
}
export async function saveClass(input, actor, database) {
  const value = validateClass(input);
  if (typeof actor !== 'string' || !actor) throw classError('Sign in to save a class.', 401);
  const identity = input.id === undefined ? null : classIdentity(input);
  const createId = identity ? null : classIdentity({ id: input.createId, version: 1 }).id;
  const db = database ?? await trainingDb();
  const values = [value.name, value.startAt, value.endAt, value.trainer, value.location, value.meetingUrl, value.notes, actor];
  const result = identity
    ? await db.query(`UPDATE training_classes SET name=$1,start_at=$2,end_at=$3,trainer=$4,location=$5,meeting_url=$6,notes=$7,updated_by=$8,updated_at=now(),version=version+1 WHERE id=$9 AND version=$10 AND status='scheduled' RETURNING ${columns}`, [...values, identity.id, identity.version])
    : await db.query(`INSERT INTO training_classes(name,start_at,end_at,trainer,location,meeting_url,notes,created_by,updated_by,id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) ON CONFLICT(id) DO NOTHING RETURNING ${columns}`, [...values, createId]);
  if (!identity && !result.rows[0]) {
    const previous = (await db.query(`SELECT ${columns} FROM training_classes WHERE id=$1`, [createId])).rows[0];
    if (previous) {
      const saved = record(previous);
      if (Object.keys(value).every(key => saved[key] === value[key])) return saved;
    }
    throw classError('This class was already created with different details. Refresh and edit the saved class.', 409);
  }
  if (!result.rows[0]) throw classError('This class changed or was canceled. Refresh the schedule before editing again.', 409);
  return record(result.rows[0]);
}
export async function cancelClass(input, actor, database) {
  const identity = classIdentity(input);
  if (typeof actor !== 'string' || !actor) throw classError('Sign in to cancel a class.', 401);
  const db = database ?? await trainingDb();
  const result = await db.query(`UPDATE training_classes SET status='canceled',version=version+1,updated_by=$1,updated_at=now() WHERE id=$2 AND version=$3 AND status='scheduled' RETURNING ${columns}`, [actor, identity.id, identity.version]);
  if (!result.rows[0]) throw classError('This class changed or was canceled. Refresh the schedule before trying again.', 409);
  return record(result.rows[0]);
}
