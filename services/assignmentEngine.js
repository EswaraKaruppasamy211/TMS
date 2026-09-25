const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
const { query, withTransaction } = require('../db');
const { ROLE_STRUCTURE, TIMEZONE } = require('../config/roles');

dayjs.extend(utc);
dayjs.extend(timezone);

function expandRoleSlots(roleStructure) {
  return roleStructure.flatMap(({ role, count }) => Array.from({ length: count }, () => role));
}

async function getSettings(client = null) {
  const result = await (client || { query }).query(
    "SELECT session_capacity AS \"sessionCapacity\", timezone, role_structure AS \"roleStructure\" FROM app_settings WHERE key = 'default'"
  );
  return result.rows[0] || {
    sessionCapacity: 15,
    timezone: TIMEZONE,
    roleStructure: ROLE_STRUCTURE,
  };
}

async function getTomorrowDate() {
  const settings = await getSettings();
  return dayjs().tz(settings.timezone).add(1, 'day').startOf('day').toDate();
}

function normalizeSessionDate(value, timezoneName = TIMEZONE) {
  const parsed = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? dayjs.tz(value, timezoneName)
    : dayjs(value).tz(timezoneName);
  if (!parsed.isValid() || (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    parsed.format('YYYY-MM-DD') !== value
  )) {
    throw new Error(`Invalid session date: ${value}`);
  }
  return parsed.startOf('day').toDate();
}

function sessionDateKey(value, timezoneName = TIMEZONE) {
  return dayjs(normalizeSessionDate(value, timezoneName)).tz(timezoneName).format('YYYY-MM-DD');
}

function selectRotationPool(roster, startIndex, capacity, unavailableIds) {
  if (!roster.length) return { pool: [], nextIndex: 0 };
  const pool = [];
  let index = ((startIndex % roster.length) + roster.length) % roster.length;
  let steps = 0;
  while (pool.length < capacity && steps < roster.length) {
    if (!unavailableIds.has(String(roster[index].id ?? roster[index]._id))) pool.push(roster[index]);
    index = (index + 1) % roster.length;
    steps++;
  }
  return { pool, nextIndex: index };
}

async function scoreMap(studentIds, roles, date, client) {
  const result = await client.query(
    `SELECT student_id, role, count(*)::int AS total, max(report_date) AS last_date
       FROM role_history
      WHERE student_id = ANY($1::uuid[]) AND role = ANY($2::text[])
        AND report_date < $3::date AND active
      GROUP BY student_id, role`,
    [studentIds, roles, date]
  );
  const scores = new Map();
  for (const row of result.rows) {
    const days = Math.max(0, dayjs(date).diff(dayjs(row.last_date), 'day'));
    scores.set(`${row.student_id}:${row.role}`, row.total * 10 + Math.max(0, 60 - days));
  }
  return (id, role) => scores.get(`${id}:${role}`) || 0;
}

async function assignRolesToPool(pool, slots, date, client) {
  if (pool.length < slots.length) {
    throw new Error(`Cannot assign ${slots.length} roles to ${pool.length} students`);
  }
  const score = await scoreMap(pool.map((s) => s.id), [...new Set(slots)], date, client);
  const remaining = [...pool];
  return slots.map((role, slotIndex) => {
    remaining.sort((a, b) => score(a.id, role) - score(b.id, role));
    return { role, slotIndex, studentId: remaining.shift().id };
  });
}

async function generateSessionForDate(value, { theme = '' } = {}) {
  const settings = await getSettings();
  const date = sessionDateKey(value, settings.timezone);
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`tmsn:${date}`]);
    const existing = await client.query('SELECT * FROM sessions WHERE report_date = $1', [date]);
    if (existing.rowCount) {
      const existingSession = existing.rows[0];
      if (theme && theme !== existingSession.theme) {
        const updated = await client.query(
          'UPDATE sessions SET theme=$1, updated_at=now() WHERE id=$2 RETURNING *',
          [theme, existingSession.id]
        );
        return { alreadyExists: true, session: updated.rows[0] };
      }
      return { alreadyExists: true, session: existingSession };
    }

    const slots = expandRoleSlots(settings.roleStructure);
    const capacity = settings.sessionCapacity || slots.length;
    if (!Number.isInteger(capacity) || capacity < slots.length) {
      throw new Error(`Session capacity (${capacity}) must be at least the number of role slots (${slots.length})`);
    }
    const roster = (await client.query(
      "SELECT id, name, roll_no AS \"rollNo\", dept FROM students WHERE status = 'Active' ORDER BY rotation_order"
    )).rows;
    const unavailable = await client.query('SELECT student_id FROM availability WHERE report_date = $1', [date]);
    const unavailableIds = new Set(unavailable.rows.map((row) => row.student_id));
    const rotation = (await client.query("SELECT next_index FROM rotation_state WHERE key = 'global' FOR UPDATE")).rows[0];
    const startIndex = rotation?.next_index || 0;
    const { pool, nextIndex } = selectRotationPool(roster, startIndex, capacity, unavailableIds);
    if (pool.length < slots.length) {
      throw new Error(`Not enough eligible students (${pool.length}) for ${slots.length} role slots on ${date}`);
    }
    const assignments = await assignRolesToPool(pool, slots, date, client);
    const inserted = await client.query(
      `INSERT INTO sessions (report_date, theme, status, rotation_start_index, rotation_end_index)
       VALUES ($1, $2, 'Generated', $3, $4) RETURNING *`,
      [date, theme, startIndex, nextIndex]
    );
    const session = inserted.rows[0];
    for (const assignment of assignments) {
      await client.query(
        `INSERT INTO assignments (session_id, slot_index, role, student_id)
         VALUES ($1, $2, $3, $4)`,
        [session.id, assignment.slotIndex, assignment.role, assignment.studentId]
      );
      await client.query(
        `INSERT INTO role_history (student_id, role, report_date, session_id)
         VALUES ($1, $2, $3, $4)`,
        [assignment.studentId, assignment.role, date, session.id]
      );
    }
    await client.query("UPDATE rotation_state SET next_index = $1 WHERE key = 'global'", [nextIndex]);
    return { alreadyExists: false, session };
  });
}

async function markUnavailable(studentId, dateValue, type, markedBy = '') {
  if (!['OD', 'LEAVE'].includes(type)) throw new Error(`Unsupported unavailable status: ${type}`);
  const settings = await getSettings();
  const date = sessionDateKey(dateValue, settings.timezone);
  return withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::bigint)', [`tmsn:${date}`]);
    const student = await client.query('SELECT id FROM students WHERE id = $1 AND status = $2', [studentId, 'Active']);
    if (!student.rowCount) throw new Error('Student not found or inactive');
    await client.query(
      `INSERT INTO availability (student_id, report_date, type, marked_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (student_id, report_date) DO UPDATE
       SET type = EXCLUDED.type, marked_by = EXCLUDED.marked_by`,
      [studentId, date, type, markedBy]
    );
    const sessionResult = await client.query('SELECT * FROM sessions WHERE report_date = $1 FOR UPDATE', [date]);
    if (!sessionResult.rowCount) return { recalculated: false, reason: 'No session generated yet for this date' };
    const session = sessionResult.rows[0];
    const assignmentResult = await client.query(
      'SELECT * FROM assignments WHERE session_id = $1 AND student_id = $2 FOR UPDATE',
      [session.id, studentId]
    );
    if (!assignmentResult.rowCount) {
      const updatedException = await client.query(
        `UPDATE session_exceptions SET reason = $3, changed_by = $4, updated_at = now()
         WHERE session_id = $1 AND student_id = $2 RETURNING *`,
        [session.id, studentId, type, markedBy]
      );
      if (updatedException.rowCount) {
        const exception = updatedException.rows[0];
        await client.query(
          `INSERT INTO session_audit
            (session_id, role, from_student_id, to_student_id, reason, changed_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [session.id, exception.original_role, exception.student_id, exception.replacement_id, type, markedBy]
        );
      }
      await client.query("UPDATE sessions SET status = 'Modified', updated_at = now() WHERE id = $1", [session.id]);
      return { recalculated: false, reason: 'Student had no active role that day', session };
    }

    const assignment = assignmentResult.rows[0];
    const availableRows = await client.query(
      `SELECT s.id, s.name, s.roll_no AS "rollNo", s.dept, s.rotation_order
         FROM students s
        WHERE s.status = 'Active'
          AND NOT EXISTS (SELECT 1 FROM availability v WHERE v.student_id = s.id AND v.report_date = $1)
          AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.session_id = $2 AND a.student_id = s.id)
        ORDER BY s.rotation_order`,
      [date, session.id]
    );
    if (!availableRows.rowCount) throw new Error(`No eligible replacement available for ${type} on ${date}`);
    const score = await scoreMap(availableRows.rows.map((s) => s.id), [assignment.role], date, client);
    const roster = (await client.query(
      "SELECT id FROM students WHERE status='Active' ORDER BY rotation_order"
    )).rows;
    const rosterIndex = new Map(roster.map((student, index) => [student.id, index]));
    const startIndex = session.rotation_end_index % Math.max(roster.length, 1);
    const distance = (student) => (rosterIndex.get(student.id) - startIndex + roster.length) % roster.length;
    const replacement = availableRows.rows.sort((a, b) =>
      score(a.id, assignment.role) - score(b.id, assignment.role) ||
      distance(a) - distance(b)
    )[0];

    const originalId = assignment.is_replacement && assignment.replaced_student_id
      ? assignment.replaced_student_id : assignment.student_id;
    const reason = assignment.is_replacement && assignment.replacement_reason
      ? assignment.replacement_reason : type;
    await client.query('UPDATE assignments SET student_id=$1, is_replacement=true, replaced_student_id=$2, replacement_reason=$3 WHERE id=$4',
      [replacement.id, originalId, reason, assignment.id]);
    await client.query(
      `INSERT INTO session_exceptions (session_id, student_id, original_role, replacement_id, reason, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (session_id, student_id) DO UPDATE
       SET replacement_id=EXCLUDED.replacement_id, reason=EXCLUDED.reason,
           changed_by=EXCLUDED.changed_by, updated_at=now()`,
      [session.id, originalId, assignment.role, replacement.id, type, markedBy]
    );
    await client.query(
      'INSERT INTO session_audit (session_id, role, slot_index, from_student_id, to_student_id, reason, changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [session.id, assignment.role, assignment.slot_index, assignment.student_id, replacement.id, type, markedBy]
    );
    await client.query(
      'UPDATE role_history SET active=false WHERE session_id=$1 AND student_id=$2 AND role=$3 AND active',
      [session.id, assignment.student_id, assignment.role]
    );
    await client.query(
      `INSERT INTO role_history (student_id, role, report_date, session_id)
       VALUES ($1,$2,$3,$4)`,
      [replacement.id, assignment.role, date, session.id]
    );
    await client.query("UPDATE sessions SET status='Modified', updated_at=now() WHERE id=$1", [session.id]);
    return { recalculated: true, session, replacement };
  });
}

async function manualOverride(sessionId, role, newStudentId, changedBy = '', slotIndex = 0) {
  return withTransaction(async (client) => {
    const session = await client.query('SELECT * FROM sessions WHERE id=$1 FOR UPDATE', [sessionId]);
    if (!session.rowCount) throw new Error('Session not found');
    const assignmentResult = await client.query(
      'SELECT * FROM assignments WHERE session_id=$1 AND role=$2 ORDER BY slot_index LIMIT 1 OFFSET $3 FOR UPDATE',
      [sessionId, role, slotIndex]
    );
    if (!assignmentResult.rowCount) throw new Error(`Role "${role}" not found in this session`);
    const assignment = assignmentResult.rows[0];
    const student = await client.query(
      `SELECT id FROM students WHERE id=$1 AND status='Active'
       AND NOT EXISTS (SELECT 1 FROM availability WHERE student_id=$1 AND report_date=$2)
       AND NOT EXISTS (SELECT 1 FROM assignments WHERE session_id=$3 AND student_id=$1 AND id<>$4)`,
      [newStudentId, session.rows[0].report_date, sessionId, assignment.id]
    );
    if (!student.rowCount) throw new Error('Override requires an available active student not assigned elsewhere');
    await client.query('UPDATE assignments SET student_id=$1, manual_override=true WHERE id=$2', [newStudentId, assignment.id]);
    await client.query('UPDATE role_history SET active=false WHERE session_id=$1 AND student_id=$2 AND role=$3 AND active',
      [sessionId, assignment.student_id, role]);
    await client.query('INSERT INTO role_history (student_id, role, report_date, session_id) VALUES ($1,$2,$3,$4)',
      [newStudentId, role, session.rows[0].report_date, sessionId]);
    await client.query('INSERT INTO session_audit (session_id, role, slot_index, from_student_id, to_student_id, reason, changed_by) VALUES ($1,$2,$3,$4,$5,\'MANUAL_OVERRIDE\',$6)',
      [sessionId, role, assignment.slot_index, assignment.student_id, newStudentId, changedBy]);
    if (assignment.is_replacement && assignment.replaced_student_id) {
      await client.query('UPDATE session_exceptions SET replacement_id=$1, changed_by=$2, updated_at=now() WHERE session_id=$3 AND student_id=$4',
        [newStudentId, changedBy, sessionId, assignment.replaced_student_id]);
    }
    await client.query("UPDATE sessions SET status='Modified', updated_at=now() WHERE id=$1", [sessionId]);
    return session.rows[0];
  });
}

async function updateSessionStatus(sessionId, status) {
  return withTransaction(async (client) => {
    const row = await client.query('SELECT status FROM sessions WHERE id=$1 FOR UPDATE', [sessionId]);
    if (!row.rowCount) throw new Error('Session not found');
    const allowed = { Finalized: ['Generated', 'Modified'], Completed: ['Finalized'] };
    if (!allowed[status]?.includes(row.rows[0].status)) {
      throw new Error(`Cannot change session status from ${row.rows[0].status} to ${status}`);
    }
    return (await client.query('UPDATE sessions SET status=$1, updated_at=now() WHERE id=$2 RETURNING *', [status, sessionId])).rows[0];
  });
}

const finalizeSession = (id) => updateSessionStatus(id, 'Finalized');
const completeSession = (id) => updateSessionStatus(id, 'Completed');

module.exports = {
  getTomorrowDate,
  generateSessionForDate,
  markUnavailable,
  manualOverride,
  finalizeSession,
  completeSession,
  expandRoleSlots,
  normalizeSessionDate,
  sessionDateKey,
  selectRotationPool,
};
