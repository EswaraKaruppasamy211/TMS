const { TIMEZONE } = require('../config/roles');

const ROLE_GROUPS = [
  ['Prepared Speakers', 'Prepared Speaker'],
  ['Specific Evaluators', 'Specific Evaluator'],
  ['Table Topic Speakers', 'Table Topic Speaker'],
];

function studentName(student) {
  if (student && typeof student === 'object' && student.name) return student.name;
  return student ? String(student) : '—';
}

function displayDate(date, timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: timezone,
  }).format(new Date(date));
}

function studentId(student) {
  if (student && typeof student === 'object' && student._id) return String(student._id);
  return student ? String(student) : '';
}

function formatException(entry, reason, timezone) {
  return {
    student: studentName(entry.student),
    originalRole: entry.originalRole || '—',
    replacement: entry.replacement ? studentName(entry.replacement) : '—',
    reason,
    date: displayDate(entry.date, timezone),
  };
}

function plainEntry(entry) {
  return typeof entry.toObject === 'function' ? entry.toObject() : entry;
}

function buildSessionReport(session, { statusRecords = [], timezone = TIMEZONE } = {}) {
  const roles = session.assignments || [];
  const hasWeekendGroups = roles.some((assignment) => assignment.role === 'Group A' || assignment.role === 'Group B');
  const roleGroups = hasWeekendGroups
    ? [['Group A', 'Group A'], ['Group B', 'Group B']]
    : ROLE_GROUPS;
  const groupedRoleNames = new Set(roleGroups.map(([, role]) => role));
  const preparedSections = roleGroups.map(([label, role]) => ({
    label,
    assignments: roles.filter((assignment) => assignment.role === role).map(studentNameForAssignment),
  }));
  const otherRoles = roles
    .filter((assignment) => !groupedRoleNames.has(assignment.role))
    .map((assignment) => ({
      role: assignment.role,
      student: studentName(assignment.student),
    }));

  const odEntries = (session.odList || []).map((entry) =>
    formatException({ ...plainEntry(entry), date: session.date }, 'OD', timezone)
  );
  const leaveEntries = (session.leaveList || []).map((entry) =>
    formatException({ ...plainEntry(entry), date: session.date }, 'LEAVE', timezone)
  );
  const exceptionsByStudent = new Map(
    [...(session.odList || []).map((entry, index) => [studentId(entry.student), odEntries[index]]),
      ...(session.leaveList || []).map((entry, index) => [studentId(entry.student), leaveEntries[index]])]
  );
  const onDuty = statusRecords
    .filter((record) => record.type === 'OD')
    .map((record) => (
      exceptionsByStudent.get(studentId(record.student)) ||
      formatException({ student: record.student, date: session.date }, 'OD', timezone)
    ));
  const onLeave = statusRecords
    .filter((record) => record.type === 'LEAVE')
    .map((record) => (
      exceptionsByStudent.get(studentId(record.student)) ||
      formatException({ student: record.student, date: session.date }, 'LEAVE', timezone)
    ));

  const report = {
    sessionId: session.id || session._id,
    title: "TOMORROW'S TMSN",
    date: displayDate(session.date, timezone),
    theme: session.theme || '',
    status: session.status,
    assignments: roles.map((assignment) => ({
      role: assignment.role,
      student: studentName(assignment.student),
      studentId: studentId(assignment.student),
      isReplacement: Boolean(assignment.isReplacement),
      manualOverride: Boolean(assignment.manualOverride),
    })),
    sections: preparedSections,
    otherRoles,
    onDuty,
    leave: onLeave,
  };
  report.text = formatReportText(report);
  return report;
}

function studentNameForAssignment(assignment) {
  return studentName(assignment.student);
}

function formatReportText(report) {
  const lines = [
    'TMSN DAILY REPORT',
    `Date: ${report.date}`,
    `Theme: ${report.theme || '—'}`,
    '',
  ];

  for (const section of report.sections) {
    lines.push(section.label);
    section.assignments.forEach((name, index) => lines.push(`${index + 1}. ${name}`));
    lines.push('');
  }

  lines.push('Other Roles');
  for (const assignment of report.otherRoles) {
    lines.push(`${assignment.role}: ${assignment.student}`);
  }

  appendExceptionSection(lines, 'ON DUTY', report.onDuty);
  appendExceptionSection(lines, 'LEAVE', report.leave);
  return lines.join('\n');
}

function appendExceptionSection(lines, title, entries) {
  lines.push('', title);
  if (entries.length === 0) {
    lines.push('None');
    return;
  }
  entries.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.student}`);
    lines.push(`   Original Role: ${entry.originalRole}`);
    lines.push(`   Replacement: ${entry.replacement}`);
  });
}

module.exports = { buildSessionReport, formatReportText };
