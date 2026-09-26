const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assignRolesToPool,
  expandRoleSlots,
  getRoleStructureForDate,
  normalizeSessionDate,
  previousSessionDateKey,
  rotationExclusions,
  selectRotationPool,
} = require('../services/assignmentEngine');
const { ROLE_STRUCTURE, TIMEZONE } = require('../config/roles');

const weekendRoles = [
  { role: 'Group A', count: 5 },
  { role: 'Group B', count: 5 },
  { role: 'Timer', count: 1 },
  { role: 'Counter', count: 1 },
  { role: 'Grammarian', count: 1 },
];

test('expands configured role counts into the expected 15 role slots', () => {
  const slots = expandRoleSlots([
    { role: 'Prepared Speaker', count: 3 },
    { role: 'Specific Evaluator', count: 3 },
    { role: 'Table Topic Speaker', count: 3 },
    { role: 'Timer', count: 1 },
    { role: 'AH Counter', count: 1 },
    { role: 'Grammarian', count: 1 },
    { role: 'TMOD', count: 1 },
    { role: 'GE', count: 1 },
    { role: 'TTM', count: 1 },
  ]);

  assert.equal(slots.length, 15);
  assert.deepEqual(slots.slice(0, 3), ['Prepared Speaker', 'Prepared Speaker', 'Prepared Speaker']);
  assert.deepEqual(slots.slice(-6), ['Timer', 'AH Counter', 'Grammarian', 'TMOD', 'GE', 'TTM']);
});

test('selects an ordered circular pool while skipping unavailable students', () => {
  const roster = Array.from({ length: 60 }, (_, index) => ({ _id: String(index) }));
  const result = selectRotationPool(roster, 58, 3, new Set(['58', '0']));

  assert.deepEqual(result.pool.map((student) => student._id), ['59', '1', '2']);
  assert.equal(result.nextIndex, 3);
});

test('normalizes calendar dates in the configured timezone', () => {
  assert.equal(
    normalizeSessionDate('2026-09-26', 'Asia/Kolkata').toISOString(),
    '2026-09-25T18:30:00.000Z'
  );
  assert.throws(() => normalizeSessionDate('not-a-date', 'Asia/Kolkata'), /Invalid session date/);
});

test('keeps the configured routine Monday through Thursday and uses the special routine Friday and Saturday', () => {
  const dates = [
    ['2026-09-21', 1],
    ['2026-09-22', 2],
    ['2026-09-23', 3],
    ['2026-09-24', 4],
    ['2026-09-25', 5],
    ['2026-09-26', 6],
    ['2026-09-27', 0],
  ];
  for (const [date, weekday] of dates) {
    const expected = weekday === 5 || weekday === 6 ? weekendRoles : ROLE_STRUCTURE;
    assert.deepEqual(getRoleStructureForDate(date, TIMEZONE), expected, date);
  }
  assert.equal(expandRoleSlots(getRoleStructureForDate('2026-09-25')).length, 13);
  assert.equal(expandRoleSlots(getRoleStructureForDate('2026-09-26')).length, 13);
});

test('uses the immediately preceding local date for next-day manual assignment skips', () => {
  assert.equal(previousSessionDateKey('2026-09-25', TIMEZONE), '2026-09-24');
  assert.equal(previousSessionDateKey('2026-09-26', TIMEZONE), '2026-09-25');
});

test('excludes unavailable and manually selected students for one rotation, not permanently', () => {
  const roster = Array.from({ length: 8 }, (_, index) => ({ id: String.fromCharCode(65 + index) }));
  const exclusions = rotationExclusions(['B'], ['D', 'E']);
  const nextDay = selectRotationPool(roster, 1, 4, exclusions);
  assert.deepEqual(nextDay.pool.map((student) => student.id), ['C', 'F', 'G', 'H']);

  const followingDay = selectRotationPool(roster, 1, 4, new Set(['B']));
  assert.deepEqual(followingDay.pool.map((student) => student.id), ['C', 'D', 'E', 'F']);
});

test('assigns all 13 weekend roles to distinct eligible students', async () => {
  const slots = expandRoleSlots(weekendRoles);
  const pool = Array.from({ length: 13 }, (_, index) => ({ id: `student-${index}` }));
  const assignments = await assignRolesToPool(pool, slots, '2026-09-25', {
    query: async () => ({ rows: [] }),
  });

  assert.equal(assignments.length, 13);
  assert.deepEqual(assignments.slice(0, 5).map(({ role }) => role), Array(5).fill('Group A'));
  assert.deepEqual(assignments.slice(5, 10).map(({ role }) => role), Array(5).fill('Group B'));
  assert.deepEqual(assignments.slice(10).map(({ role }) => role), ['Timer', 'Counter', 'Grammarian']);
  assert.equal(new Set(assignments.map(({ studentId }) => studentId)).size, 13);
  await assert.rejects(
    assignRolesToPool(pool.slice(1), slots, '2026-09-25', { query: async () => ({ rows: [] }) }),
    /Cannot assign 13 roles to 12 students/
  );
});

test('retains the previous leave-day pool as the next-day candidate pool', async () => {
  const previousStudentIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const roster = Array.from({ length: 8 }, (_, index) => ({ id: previousStudentIds[index], name: `Student ${index + 1}` }));
  const result = selectRotationPool(roster, 0, 5, new Set(['a']));
  assert.deepEqual(result.pool.map((student) => student.id), ['b', 'c', 'd', 'e', 'f']);
});
