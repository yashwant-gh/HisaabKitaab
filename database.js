const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');

let dbType = 'sqlite';
let pgPool = null;
let sqliteDb = null;

function initDb() {
  if (process.env.POSTGRES_URL) {
    dbType = 'postgres';
    pgPool = new Pool({
      connectionString: process.env.POSTGRES_URL,
      ssl: { rejectUnauthorized: false }
    });
    console.log('Using PostgreSQL database connection.');
  } else {
    dbType = 'sqlite';
    const dbPath = path.resolve(__dirname, 'hisaab.db');
    sqliteDb = new sqlite3.Database(dbPath);
    console.log('Using SQLite database at:', dbPath);
  }
}

async function query(sql, params = []) {
  let translatedSql = sql;
  if (dbType === 'postgres') {
    let paramCount = 1;
    translatedSql = sql.replace(/\?/g, () => `$${paramCount++}`);
    const result = await pgPool.query(translatedSql, params);
    return result.rows;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(translatedSql, params, (err, rows) => {
        if (err) {
          console.error('SQLite query error on SQL:', translatedSql, 'Params:', params, 'Error:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }
}

async function run(sql, params = []) {
  let translatedSql = sql;
  if (dbType === 'postgres') {
    let paramCount = 1;
    translatedSql = sql.replace(/\?/g, () => `$${paramCount++}`);
    const isInsert = translatedSql.trim().toLowerCase().startsWith('insert');
    if (isInsert && !translatedSql.toLowerCase().includes('returning')) {
      translatedSql += ' RETURNING id';
    }
    const result = await pgPool.query(translatedSql, params);
    return {
      lastID: result.rows[0] ? result.rows[0].id : null,
      changes: result.rowCount
    };
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(translatedSql, params, function(err) {
        if (err) {
          console.error('SQLite run error on SQL:', translatedSql, 'Params:', params, 'Error:', err);
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }
}

async function setupSchema() {
  if (dbType === 'sqlite') {
    await run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password_hash TEXT,
      name TEXT UNIQUE,
      avatar_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS group_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER,
      user_name TEXT,
      joined_at DATE,
      left_at DATE,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    )`);
    await run(`CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER,
      description TEXT,
      paid_by TEXT,
      amount REAL,
      currency TEXT,
      exchange_rate REAL DEFAULT 1.0,
      split_type TEXT,
      date DATE,
      notes TEXT,
      is_settlement INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    )`);
    await run(`CREATE TABLE IF NOT EXISTS expense_splits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_id INTEGER,
      user_name TEXT,
      split_value REAL,
      calculated_amount REAL,
      calculated_amount_inr REAL,
      FOREIGN KEY (expense_id) REFERENCES expenses(id) ON DELETE CASCADE
    )`);
    await run(`CREATE TABLE IF NOT EXISTS group_invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER,
      invited_by TEXT,
      invitee_email TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
    )`);
  } else {
    // Postgres DDL
    await run(`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT,
      name TEXT UNIQUE,
      avatar_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS groups (
      id SERIAL PRIMARY KEY,
      name TEXT,
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS group_members (
      id SERIAL PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      user_name TEXT,
      joined_at DATE,
      left_at DATE
    )`);
    await run(`CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      description TEXT,
      paid_by TEXT,
      amount DOUBLE PRECISION,
      currency TEXT,
      exchange_rate DOUBLE PRECISION DEFAULT 1.0,
      split_type TEXT,
      date DATE,
      notes TEXT,
      is_settlement INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
    await run(`CREATE TABLE IF NOT EXISTS expense_splits (
      id SERIAL PRIMARY KEY,
      expense_id INTEGER REFERENCES expenses(id) ON DELETE CASCADE,
      user_name TEXT,
      split_value DOUBLE PRECISION,
      calculated_amount DOUBLE PRECISION,
      calculated_amount_inr DOUBLE PRECISION
    )`);
    await run(`CREATE TABLE IF NOT EXISTS group_invitations (
      id SERIAL PRIMARY KEY,
      group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
      invited_by TEXT,
      invitee_email TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);
  }
}

async function seedData() {
  // Check if users table is empty
  const userCount = await query(`SELECT COUNT(*) as count FROM users`);
  if (userCount[0].count === 0) {
    console.log('Seeding initial flatmate users and group...');
    // Seed initial users
    const flatmates = [
      { name: 'Aisha', email: 'aisha@hisaab.com' },
      { name: 'Rohan', email: 'rohan@hisaab.com' },
      { name: 'Priya', email: 'priya@hisaab.com' },
      { name: 'Meera', email: 'meera@hisaab.com' },
      { name: 'Sam', email: 'sam@hisaab.com' },
      { name: 'Dev', email: 'dev@hisaab.com' },
      { name: 'Kabir', email: 'kabir@hisaab.com' }
    ];

    for (const mate of flatmates) {
      // Password hash for 'password123'
      const dummyHash = '$2a$10$Qn2L9aF0tHw2k1bK6j0NSe43r9u5.sD9w1B1XpS6f7g4h8i9j0k1l'; 
      const avatarUrl = `https://api.dicebear.com/7.x/adventurer/svg?seed=${mate.name}`;
      await run(
        `INSERT INTO users (name, email, password_hash, avatar_url) VALUES (?, ?, ?, ?)`,
        [mate.name, mate.email, dummyHash, avatarUrl]
      );
    }

    // Create Cozy Flat group
    const groupResult = await run(
      `INSERT INTO groups (name, description) VALUES (?, ?)`,
      ['Cozy Flat', 'Sharing rent and expenses in the flat']
    );
    const groupId = groupResult.lastID;

    // Seed group memberships
    // Aisha: active from Feb 1, 2026
    await run(
      `INSERT INTO group_members (group_id, user_name, joined_at, left_at) VALUES (?, ?, ?, NULL)`,
      [groupId, 'Aisha', '2026-02-01']
    );
    // Rohan: active from Feb 1, 2026
    await run(
      `INSERT INTO group_members (group_id, user_name, joined_at, left_at) VALUES (?, ?, ?, NULL)`,
      [groupId, 'Rohan', '2026-02-01']
    );
    // Priya: active from Feb 1, 2026
    await run(
      `INSERT INTO group_members (group_id, user_name, joined_at, left_at) VALUES (?, ?, ?, NULL)`,
      [groupId, 'Priya', '2026-02-01']
    );
    // Meera: joined Feb 1, 2026, left March 31, 2026
    await run(
      `INSERT INTO group_members (group_id, user_name, joined_at, left_at) VALUES (?, ?, ?, ?)`,
      [groupId, 'Meera', '2026-02-01', '2026-03-31']
    );
    // Dev: joined March 8, 2026, left March 14, 2026 (Goa Trip guest)
    await run(
      `INSERT INTO group_members (group_id, user_name, joined_at, left_at) VALUES (?, ?, ?, ?)`,
      [groupId, 'Dev', '2026-03-08', '2026-03-14']
    );
    // Kabir: joined March 11, 2026, left March 11, 2026 (Goa Parasailing guest)
    await run(
      `INSERT INTO group_members (group_id, user_name, joined_at, left_at) VALUES (?, ?, ?, ?)`,
      [groupId, 'Kabir', '2026-03-11', '2026-03-11']
    );
    // Sam: joined April 15, 2026
    await run(
      `INSERT INTO group_members (group_id, user_name, joined_at, left_at) VALUES (?, ?, ?, NULL)`,
      [groupId, 'Sam', '2026-04-15']
    );

    console.log('Seeding completed successfully.');
  }
}

module.exports = {
  initDb,
  query,
  run,
  setupSchema,
  seedData,
  get dbType() { return dbType; }
};
