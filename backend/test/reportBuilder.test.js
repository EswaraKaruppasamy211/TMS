const assert = require('node:assert/strict');
const test = require('node:test');
const { buildSessionReport } = require('../services/reportBuilder');

test('builds the tomorrow report with ordered role groups and separate OD/Leave lists', () => {
  const session = {
    date: new Date('2026-09-26T00:00:00.000Z'),
    theme: 'The Changing Face of Education',
    status: 'Modified',
    assignments: [
      { role: 'Prepared Speaker', student: { _id: '1', name: 'Arun' } },
      { role: 'Prepared Speaker', student: { _id: '2', name: 'Bala' } },
      { role: 'Specific Evaluator', student: { _id: '3', name: 'Dinesh' } },
      { role: 'Timer', student: { _id: '4', name: 'Kumar' } },
    ],
    odList: [
      {
        student: { _id: '5', name: 'Ravi' },
        originalRole: 'Grammarian',
        replacement: { _id: '6', name: 'Suresh' },
      },
    ],
    leaveList: [],
  };
  const statusRecords = [
    { type: 'OD', student: { _id: '5', name: 'Ravi' } },
    { type: 'LEAVE', student: { _id: '7', name: 'Ajay' } },
  ];

  const report = buildSessionReport(session, { statusRecords });

  assert.equal(report.title, "TOMORROW'S TMSN");
  assert.equal(report.date, '26 September 2026');
  assert.deepEqual(report.sections[0].assignments, ['Arun', 'Bala']);
  assert.deepEqual(report.sections[1].assignments, ['Dinesh']);
  assert.deepEqual(report.otherRoles, [{ role: 'Timer', student: 'Kumar' }]);
  assert.equal(report.onDuty[0].originalRole, 'Grammarian');
  assert.equal(report.onDuty[0].replacement, 'Suresh');
  assert.equal(report.leave[0].student, 'Ajay');
  assert.equal(report.leave[0].replacement, '—');
  assert.match(report.text, /ON DUTY[\s\S]*Ravi[\s\S]*Replacement: Suresh/);
  assert.match(report.text, /LEAVE[\s\S]*Ajay/);
});

test('renders the Friday/Saturday groups and individual roles without weekday roles', () => {
  const assignments = [
    ...Array.from({ length: 5 }, (_, index) => ({
      role: 'Group A',
      student: { _id: `a${index}`, name: `Group A ${index + 1}` },
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      role: 'Group B',
      student: { _id: `b${index}`, name: `Group B ${index + 1}` },
    })),
    { role: 'Timer', student: { _id: 'timer', name: 'Timer Person' } },
    { role: 'Counter', student: { _id: 'counter', name: 'Counter Person' } },
    { role: 'Grammarian', student: { _id: 'grammarian', name: 'Grammarian Person' } },
  ];
  const report = buildSessionReport({
    date: new Date('2026-09-25T00:00:00.000Z'),
    status: 'Generated',
    assignments,
  });

  assert.deepEqual(report.sections.map((section) => section.label), ['Group A', 'Group B']);
  assert.equal(report.sections[0].assignments.length, 5);
  assert.equal(report.sections[1].assignments.length, 5);
  assert.equal(report.assignments.length, 13);
  assert.equal(new Set(report.assignments.map((assignment) => assignment.studentId)).size, 13);
  assert.deepEqual(report.otherRoles, [
    { role: 'Timer', student: 'Timer Person' },
    { role: 'Counter', student: 'Counter Person' },
    { role: 'Grammarian', student: 'Grammarian Person' },
  ]);
  assert.match(report.text, /Group A[\s\S]*Group B[\s\S]*Timer: Timer Person[\s\S]*Counter: Counter Person[\s\S]*Grammarian: Grammarian Person/);
});
