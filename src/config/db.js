const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// 🔍 TEST CONNECTION
pool.query('SELECT NOW()')
  .then(() => console.log('✅ PostgreSQL connected successfully'))
  .catch(err => console.error('❌ PostgreSQL connection failed:', err));

module.exports = pool;
