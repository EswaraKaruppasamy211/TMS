const { query } = require('../../data/db');
const {
  getTomorrowDate,
  generateSessionForDate,
  sessionDateKey,
  nextValidDateKey,
} = require('./assignmentEngine');
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
  const settings = await query("SELECT timezone FROM app_settings WHERE key='default'");
  const timezone = settings.rows[0]?.timezone || 'Asia/Kolkata';
  const tomorrow = sessionDateKey(await getTomorrowDate(), timezone);
  while (true) {
    const leaveResult = await query(
      'SELECT report_date AS date, reason FROM college_leaves WHERE report_date >= $1 ORDER BY report_date',
      [tomorrow]
    );
    const leaveDates = leaveResult.rows.map((row) => sessionDateKey(row.date, timezone));
    const date = nextValidDateKey(tomorrow, leaveDates, timezone);
    const skippedCollegeLeaves = leaveResult.rows.filter((row) =>
      sessionDateKey(row.date, timezone) < date
    );
    const generated = await generateSessionForDate(date);
    if (generated.collegeLeave) continue;
    return {
      report: await loadSessionReport(date),
      skippedCollegeLeaves: skippedCollegeLeaves.map((row) => ({
        date: sessionDateKey(row.date, timezone),
        reason: row.reason,
      })),
    };
  }
}

async function getReportForDate(value) {
  const settings = await query("SELECT timezone FROM app_settings WHERE key='default'");
  const date = sessionDateKey(value, settings.rows[0]?.timezone || 'Asia/Kolkata');
  const collegeLeave = await query('SELECT 1 FROM college_leaves WHERE report_date=$1', [date]);
  if (collegeLeave.rowCount) return null;
  return loadSessionReport(date);
}

async function getTomorrowDashboard() {
  const { report, skippedCollegeLeaves } = await getTomorrowReport();
  return {
    heading: skippedCollegeLeaves.length ? 'NEXT VALID SCHEDULE' : "TOMORROW'S TMSN",
    report,
    collegeLeaves: skippedCollegeLeaves,
  };
}

async function listReportDates() {
  return (await query(
    `SELECT s.report_date AS date FROM sessions s
      WHERE NOT EXISTS (SELECT 1 FROM college_leaves c WHERE c.report_date=s.report_date)
      ORDER BY s.report_date DESC`
  )).rows;
}

module.exports = { getTomorrowDashboard, getTomorrowReport, getReportForDate, listReportDates };
