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
