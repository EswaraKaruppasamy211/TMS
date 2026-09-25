require('dotenv').config();
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const { initializeSchema, closePool, query, withTransaction } = require('./db');
const engine = require('./services/assignmentEngine');
const reports = require('./services/reportService');

const PORT = Number(process.env.PORT || 3000);
const HOST = '127.0.0.1';

function validateConfiguration() {
  const missing = ['DATABASE_URL', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'SESSION_SECRET']
    .filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters.');
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT must be a valid TCP port.');
}

function constantTimeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use(session({
    name: 'tmsn.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'strict', secure: false, maxAge: 8 * 60 * 60 * 1000 },
  }));
  app.use(express.static(path.join(__dirname, 'public'), { index: false }));

  const loginAttempts = new Map();
  app.get('/', (req, res) => res.redirect(req.session.authenticated ? '/dashboard' : '/login'));
  app.get('/login', (req, res) => {
    if (req.session.authenticated) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
  });
  app.post('/auth/login', (req, res) => {
    const now = Date.now();
    const current = loginAttempts.get(req.ip) || { count: 0, until: now };
    if (now < current.until && current.count >= 8) return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    const usernameOk = constantTimeEqual(req.body?.username || '', process.env.ADMIN_USERNAME);
    const passwordOk = constantTimeEqual(req.body?.password || '', process.env.ADMIN_PASSWORD);
    if (!usernameOk || !passwordOk) {
      const next = current.until <= now ? { count: 1, until: now + 15 * 60 * 1000 } : { ...current, count: current.count + 1 };
      loginAttempts.set(req.ip, next);
      return res.status(401).json({ error: 'Invalid username or password.' });
    }
    loginAttempts.delete(req.ip);
    req.session.regenerate((error) => {
      if (error) return res.status(500).json({ error: 'Unable to start a session.' });
      req.session.authenticated = true;
      req.session.save((saveError) => {
        if (saveError) return res.status(500).json({ error: 'Unable to start a session.' });
        res.json({ ok: true });
      });
    });
  });

  function requireAuth(req, res, next) {
    if (!req.session.authenticated) {
      if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Authentication required.' });
      return res.redirect('/login');
    }
    next();
  }
  app.post('/auth/logout', requireAuth, (req, res) => req.session.destroy(() => res.json({ ok: true })));
  app.get('/dashboard', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
  app.use('/api', requireAuth);
  app.get('/api/dashboard', asyncRoute(async (req, res) => res.json(await reports.getTomorrowDashboard())));
  app.get('/api/reports', asyncRoute(async (req, res) => res.json({ dates: await reports.listReportDates() })));
  app.get('/api/reports/:date', asyncRoute(async (req, res) => {
    if (req.params.date === 'tomorrow') return res.json(await reports.getTomorrowDashboard());
    const report = await reports.getReportForDate(req.params.date);
    if (!report) return res.status(404).json({ error: 'No report exists for that date.' });
    res.json({ heading: 'HISTORICAL REPORT', report });
  }));
  app.get('/api/students', asyncRoute(async (req, res) => {
    const students = await query(
      `SELECT id, roll_no AS "rollNo", name, dept, status, rotation_order AS "rotationOrder"
       FROM students ORDER BY rotation_order, name`
    );
    res.json({ students: students.rows });
  }));
  app.post('/api/students', asyncRoute(async (req, res) => {
    const { rollNo, name, dept = '' } = req.body || {};
    if (![rollNo, name].every((value) => typeof value === 'string' && value.trim()) || typeof dept !== 'string') {
      return res.status(400).json({ error: 'Roll number and name are required.' });
    }
    const student = await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('tmsn:add-student')::bigint)");
      const next = await client.query('SELECT coalesce(max(rotation_order), -1) + 1 AS value FROM students');
      const inserted = await client.query(
        `INSERT INTO students (roll_no, name, dept, rotation_order)
         VALUES ($1, $2, $3, $4) RETURNING id, roll_no AS "rollNo", name, dept, status, rotation_order AS "rotationOrder"`,
        [rollNo.trim(), name.trim(), dept.trim(), next.rows[0].value]
      );
      return inserted.rows[0];
    });
    res.status(201).json({ student });
  }));
  app.patch('/api/students/:id', asyncRoute(async (req, res) => {
    const { status } = req.body || {};
    if (!['Active', 'Inactive'].includes(status)) return res.status(400).json({ error: 'Status must be Active or Inactive.' });
    const result = await query(
      'UPDATE students SET status=$1 WHERE id=$2 RETURNING id, roll_no AS "rollNo", name, dept, status, rotation_order AS "rotationOrder"',
      [status, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Student not found.' });
    res.json({ student: result.rows[0] });
  }));
  app.post('/api/generate-tomorrow', asyncRoute(async (req, res) => {
    const result = await engine.generateSessionForDate(await engine.getTomorrowDate(), { theme: String(req.body?.theme || '').trim() });
    res.json({ ...result, dashboard: await reports.getTomorrowDashboard() });
  }));
  app.post('/api/availability', asyncRoute(async (req, res) => {
    const { studentId, type, date } = req.body || {};
    if (!studentId || !['OD', 'LEAVE'].includes(type) || !date) {
      return res.status(400).json({ error: 'Student, date, and OD or LEAVE status are required.' });
    }
    const result = await engine.markUnavailable(studentId, date, type, 'admin');
    res.json({
      ...result,
      dashboard: date === engine.sessionDateKey(await engine.getTomorrowDate())
        ? await reports.getTomorrowDashboard() : undefined,
    });
  }));
  app.post('/api/override', asyncRoute(async (req, res) => {
    const { sessionId, role, studentId, slotIndex = 0 } = req.body || {};
    if (!sessionId || !role || !studentId || !Number.isInteger(slotIndex) || slotIndex < 0) {
      return res.status(400).json({ error: 'Session, role, student, and a valid slot are required.' });
    }
    await engine.manualOverride(sessionId, role, studentId, 'admin', slotIndex);
    res.json({ dashboard: await reports.getTomorrowDashboard() });
  }));
  app.post('/api/reports/:id/finalize', asyncRoute(async (req, res) => {
    await engine.finalizeSession(req.params.id);
    res.json({ dashboard: await reports.getTomorrowDashboard() });
  }));
  app.post('/api/reports/:id/complete', asyncRoute(async (req, res) => {
    await engine.completeSession(req.params.id);
    res.json({ dashboard: await reports.getTomorrowDashboard() });
  }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const message = error.message || 'Request failed.';
    const status = error.code === '23505' ? 409
      : (/Invalid session date|No eligible replacement|Cannot assign|Not enough eligible|capacity|Unsupported|not found|already|requires an available/.test(message) ? 400 : 500);
    if (status === 500) console.error('Request failed:', error.code || error.name || 'unknown error');
    res.status(status).json({ error: status === 500
      ? 'Request failed. Check the server configuration and database.'
      : status === 409 ? 'A record with the same unique value already exists.' : message });
  });
  return app;
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function start() {
  validateConfiguration();
  await initializeSchema();
  const server = createApp().listen(PORT, HOST, () => {
    console.log(`TMSN dashboard is listening at http://${HOST}:${PORT}`);
  });
  const close = () => server.close(async () => {
    await closePool();
    process.exit(0);
  });
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

if (require.main === module) {
  start().catch(() => {
    console.error('TMSN could not start. Verify the required environment variables and PostgreSQL connectivity.');
    process.exitCode = 1;
  });
}

module.exports = { createApp, validateConfiguration };
