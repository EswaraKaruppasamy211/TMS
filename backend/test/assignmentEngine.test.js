const assert = require('node:assert/strict');
const test = require('node:test');
const {
  expandRoleSlots,
  normalizeSessionDate,
  selectRotationPool,
} = require('../services/assignmentEngine');

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
