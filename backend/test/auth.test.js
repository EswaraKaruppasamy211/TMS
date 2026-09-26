const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

test('dashboard is gated behind configured admin login', async (context) => {
  const adminUsername = crypto.randomBytes(12).toString('hex');
  const adminPassword = crypto.randomBytes(24).toString('hex');
  process.env.ADMIN_USERNAME = adminUsername;
  process.env.ADMIN_PASSWORD = adminPassword;
  process.env.SESSION_SECRET = crypto.randomBytes(48).toString('hex');
  const { createApp } = require('../server');
  const server = createApp().listen(0, '127.0.0.1');
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const stylesheet = await fetch(`${base}/styles.css`);
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get('content-type'), /text\/css/);
  const loginScript = await fetch(`${base}/login.js`);
  assert.equal(loginScript.status, 200);
  assert.match(loginScript.headers.get('content-type'), /javascript/);

  const unauthorized = await fetch(`${base}/api/dashboard`);
  assert.equal(unauthorized.status, 401);
  const unauthorizedReset = await fetch(`${base}/api/reset-schedules`, { method: 'POST' });
  assert.equal(unauthorizedReset.status, 401);
  const dashboardRedirect = await fetch(`${base}/dashboard`, { redirect: 'manual' });
  assert.equal(dashboardRedirect.status, 302);
  assert.equal(dashboardRedirect.headers.get('location'), '/login');

  const rejected = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUsername, password: crypto.randomBytes(24).toString('hex') }),
  });
  assert.equal(rejected.status, 401);

  const accepted = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  assert.equal(accepted.status, 200);
  const cookie = accepted.headers.get('set-cookie').split(';')[0];
  const authorized = await fetch(`${base}/dashboard`, {
    headers: { Cookie: cookie },
    redirect: 'manual',
  });
  assert.equal(authorized.status, 200);
  const dashboard = await authorized.text();
  assert.match(dashboard, /Tomorrow's roster/);
  assert.match(dashboard, /College Leave/);
  assert.match(dashboard, /OD or Leave/);
});
