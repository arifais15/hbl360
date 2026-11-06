const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createDatabaseBackup, pruneOldBackups } = require('../services/databaseBackupService');

test('creates a consistent SQLite backup that can be reopened', async () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbs-database-backup-'));
  const source = new Database(':memory:');
  source.exec('CREATE TABLE entries (id INTEGER PRIMARY KEY, amount INTEGER)');
  source.prepare('INSERT INTO entries (amount) VALUES (?)').run(1250);

  try {
    const backupPath = await createDatabaseBackup(source, backupDir, new Date('2026-01-02T03:04:05.000Z'));
    const restored = new Database(backupPath, { readonly: true });
    try {
      assert.equal(restored.prepare('SELECT amount FROM entries WHERE id = 1').get().amount, 1250);
      assert.equal((fs.statSync(backupPath).mode & 0o777), 0o600);
    } finally {
      restored.close();
    }
  } finally {
    source.close();
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test('prunes expired backup snapshots but leaves recent and unrelated files', async () => {
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbs-backup-retention-'));
  const now = Date.now();
  const expiredPath = path.join(backupDir, 'pbs_house_loan_backup_expired.db');
  const recentPath = path.join(backupDir, 'pbs_house_loan_backup_recent.db');
  const unrelatedPath = path.join(backupDir, 'keep.txt');
  fs.writeFileSync(expiredPath, 'old');
  fs.writeFileSync(recentPath, 'new');
  fs.writeFileSync(unrelatedPath, 'unrelated');
  fs.utimesSync(expiredPath, new Date(now - 31 * 24 * 60 * 60 * 1000), new Date(now - 31 * 24 * 60 * 60 * 1000));

  try {
    assert.equal(await pruneOldBackups(backupDir, 30, now), 1);
    assert.equal(fs.existsSync(expiredPath), false);
    assert.equal(fs.existsSync(recentPath), true);
    assert.equal(fs.existsSync(unrelatedPath), true);
  } finally {
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});