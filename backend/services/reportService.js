const { query } = require('../../data/db');
const { getTomorrowDate, generateSessionForDate, sessionDateKey } = require('./assignmentEngine');
const { buildSessionReport } = require('./reportBuilder');

async function loadSessionReport(date) {
  const sessionResult = await query('SELECT * FROM sessions WHERE report_date=$1', [date]);
  if (!sessionResult.rowCount) return null;
  const session = sessionResult.rows[0];
  session.date = session.report_date;
  const [assignments, exceptions, statuses, audits, settings] = await Promise.all([
    query(
      `SELECT a.role, a.student_id AS "studentId", a.is_replacement AS "isReplacement",
              a.replaced_student_id AS "replacedStudentId", a.replacement_reason AS "replacementReason",
              a.manual_override AS "manualOverride", s.id, s.name, s.roll_no AS "rollNo"
         FROM assignments a JOIN students s ON s.id=a.student_id
        WHERE a.session_id=$1 ORDER BY a.slot_index`,
      [session.id]
    ),
    query(
      `SELECT e.student_id AS "studentId", e.original_role AS "originalRole",
              e.replacement_id AS "replacementId", e.reason, e.changed_by AS "changedBy",
              original.name AS "studentName", replacement.name AS "replacementName"
         FROM session_exceptions e
         JOIN students original ON original.id=e.student_id
         LEFT JOIN students replacement ON replacement.id=e.replacement_id
        WHERE e.session_id=$1 ORDER BY e.updated_at`,
      [session.id]
    ),
    query(
      `SELECT v.type, v.student_id AS "studentId", s.name, s.roll_no AS "rollNo"
         FROM availability v JOIN students s ON s.id=v.student_id
        WHERE v.report_date=$1 ORDER BY s.rotation_order`,
      [date]
    ),
    query('SELECT * FROM session_audit WHERE session_id=$1 ORDER BY occurred_at', [session.id]),
    query("SELECT timezone FROM app_settings WHERE key='default'"),
  ]);
  session.assignments = assignments.rows.map((row) => ({
    ...row,
    student: { id: row.id, _id: row.id, name: row.name, rollNo: row.rollNo },
  }));
  session.odList = [];
  session.leaveList = [];
  for (const exception of exceptions.rows) {
    const entry = {
      student: { id: exception.studentId, _id: exception.studentId, name: exception.studentName },
      originalRole: exception.originalRole,
      replacement: exception.replacementId
        ? { id: exception.replacementId, _id: exception.replacementId, name: exception.replacementName }
        : null,
      reason: exception.reason,
      changedBy: exception.changedBy,
      date,
    };
    (exception.reason === 'OD' ? session.odList : session.leaveList).push(entry);
  }
  session.auditLog = audits.rows;
  const statusRecords = statuses.rows.map((record) => ({
    type: record.type,
    student: { id: record.studentId, _id: record.studentId, name: record.name, rollNo: record.rollNo },
  }));
  return buildSessionReport(session, { statusRecords, timezone: settings.rows[0]?.timezone });
}

async function getTomorrowReport() {
  const date = await getTomorrowDate();
  await generateSessionForDate(date);
  const settings = await query("SELECT timezone FROM app_settings WHERE key='default'");
  return loadSessionReport(sessionDateKey(date, settings.rows[0]?.timezone || 'Asia/Kolkata'));
}

async function getReportForDate(value) {
  const settings = await query("SELECT timezone FROM app_settings WHERE key='default'");
  const date = sessionDateKey(value, settings.rows[0]?.timezone || 'Asia/Kolkata');
  return loadSessionReport(date);
}

async function getTomorrowDashboard() {
  const report = await getTomorrowReport();
  return { heading: "TOMORROW'S TMSN", report };
}

async function listReportDates() {
  return (await query('SELECT report_date AS date FROM sessions ORDER BY report_date DESC')).rows;
}

module.exports = { getTomorrowDashboard, getTomorrowReport, getReportForDate, listReportDates };
