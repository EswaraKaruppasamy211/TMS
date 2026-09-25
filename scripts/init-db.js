require('dotenv').config();
const { initializeSchema, closePool } = require('../db');

initializeSchema()
  .then(() => console.log('PostgreSQL schema is ready. No student records were created.'))
  .catch(() => {
    console.error('Database initialization failed. Verify DATABASE_URL and PostgreSQL connectivity.');
    process.exitCode = 1;
  })
  .finally(closePool);
