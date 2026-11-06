const test = require('node:test');
const assert = require('node:assert/strict');
const { insertReturningId, translateSql } = require('../database/postgresSql');

test('translates SQLite schema types for PostgreSQL while preserving constraints', () => {
  const { sql } = translateSql(`
    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      employee_id INTEGER NOT NULL REFERENCES employees(id)
    );
  `);

  assert.match(sql, /id SERIAL PRIMARY KEY/i);
  assert.match(sql, /amount DOUBLE PRECISION NOT NULL DEFAULT 0/i);
  assert.match(sql, /created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP/i);
  assert.match(sql, /REFERENCES employees\(id\)/i);
});

test('converts only SQL placeholders and preserves quoted question marks', () => {
  const { sql } = translateSql("SELECT '?' AS literal, `loan_no` FROM loans WHERE id = ? -- ?\nAND note = '?' AND month = ?");
  assert.equal(sql, `SELECT '?' AS literal, "loan_no" FROM loans WHERE id = $1 -- ?\nAND note = '?' AND month = $2`);
});

test('maps SQLite table_info to PostgreSQL information_schema', () => {
  const result = translateSql('PRAGMA table_info(pbs_settings)');
  assert.equal(result.isTableInfo, true);
  assert.match(result.sql, /information_schema\.columns/);
  assert.match(result.sql, /table_name = 'pbs_settings'/);
});

test('requests generated ids for inserts without changing other statements', () => {
  assert.equal(insertReturningId('INSERT INTO employees (name) VALUES ($1)'), 'INSERT INTO employees (name) VALUES ($1) RETURNING id');
  assert.equal(insertReturningId('UPDATE employees SET name = $1'), 'UPDATE employees SET name = $1');
  assert.equal(insertReturningId('INSERT INTO employees (name) VALUES ($1) RETURNING id'), 'INSERT INTO employees (name) VALUES ($1) RETURNING id');
});
