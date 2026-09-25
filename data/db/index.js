const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

let pool;

function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Configure it in your local .env file.');
  if (!pool) {
    const parsed = new URL(process.env.DATABASE_URL);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: parsed.hostname.includes('supabase.') ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

function query(...args) {
  return getPool().query(...args);
}

async function withTransaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function initializeSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await query(schema);
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { query, withTransaction, initializeSchema, closePool };
