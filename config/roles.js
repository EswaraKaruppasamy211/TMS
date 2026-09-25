// Central role structure for a TMSN session.
// `count` is how many slots that role has per session.
// This is the fallback used when no DB Settings document exists yet.
module.exports = {
  ROLE_STRUCTURE: [
    { role: 'Prepared Speaker', count: 3 },
    { role: 'Specific Evaluator', count: 3 },
    { role: 'Table Topic Speaker', count: 3 },
    { role: 'Timer', count: 1 },
    { role: 'AH Counter', count: 1 },
    { role: 'Grammarian', count: 1 },
    { role: 'TMOD', count: 1 },
    { role: 'GE', count: 1 },
    { role: 'TTM', count: 1 },
  ],
  DEFAULT_CAPACITY: 15,
  TIMEZONE: 'Asia/Kolkata',
};
