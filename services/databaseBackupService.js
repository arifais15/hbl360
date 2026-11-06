const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_PREFIX = 'pbs_house_loan_backup_';

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function findNewestBackupTime(backupDir) {
  let names;
  try {
    names = await fs.promises.readdir(backupDir);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  let newestTime = null;
  for (const name of names) {
    if (!name.startsWith(BACKUP_PREFIX) || !name.endsWith('.db')) continue;
    const stat = await fs.promises.stat(path.join(backupDir, name));
    if (stat.isFile() && (newestTime === null || stat.mtimeMs > newestTime)) {
      newestTime = stat.mtimeMs;
    }
  }
  return newestTime;
}

async function createDatabaseBackup(database, backupDir, now = new Date()) {
  if (!database || typeof database.backup !== 'function') {
    throw new TypeError('A better-sqlite3 database connection is required.');
  }

  await fs.promises.mkdir(backupDir, { recursive: true, mode: 0o700 });
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${BACKUP_PREFIX}${timestamp}.db`);

  try {
    await database.backup(backupPath);
    await fs.promises.chmod(backupPath, 0o600);
    return backupPath;
  } catch (error) {
    await fs.promises.rm(backupPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function pruneOldBackups(backupDir, retentionDays, now = Date.now()) {
  const cutoff = now - retentionDays * DAY_MS;
  const names = await fs.promises.readdir(backupDir);
  let removed = 0;

  for (const name of names) {
    if (!name.startsWith(BACKUP_PREFIX) || !name.endsWith('.db')) continue;
    const filePath = path.join(backupDir, name);
    const stat = await fs.promises.stat(filePath);
    if (stat.isFile() && stat.mtimeMs < cutoff) {
      await fs.promises.unlink(filePath);
      removed++;
    }
  }
  return removed;
}

function startDatabaseBackupScheduler(database, options = {}) {
  const dataDir = database.dataDir || path.dirname(database.dbPath || process.cwd());
  const backupDir = path.resolve(
    options.backupDir || process.env.PBS_BACKUP_DIR || path.join(dataDir, 'backups')
  );
  const intervalHours = options.intervalHours || parsePositiveInteger(process.env.PBS_BACKUP_INTERVAL_HOURS, 24);
  const retentionDays = options.retentionDays || parsePositiveInteger(process.env.PBS_BACKUP_RETENTION_DAYS, 30);
  const intervalMs = intervalHours * 60 * 60 * 1000;

  let timer = null;
  let stopped = false;
  let backupInProgress = false;

  const schedule = delay => {
    if (stopped) return;
    timer = setTimeout(runBackup, Math.max(1000, delay));
    timer.unref?.();
  };

  const runBackup = async () => {
    if (stopped || backupInProgress) return;
    backupInProgress = true;
    try {
      const backupPath = await createDatabaseBackup(database, backupDir);
      const removed = await pruneOldBackups(backupDir, retentionDays);
      console.log(`[Database Backup] Created ${backupPath}${removed ? `; removed ${removed} expired backup(s)` : ''}`);
    } catch (error) {
      console.warn('[Database Backup] Automatic backup failed:', error.message);
    } finally {
      backupInProgress = false;
      schedule(intervalMs);
    }
  };

  const ready = (async () => {
    await fs.promises.mkdir(backupDir, { recursive: true, mode: 0o700 });
    const newestBackupTime = await findNewestBackupTime(backupDir);
    const elapsed = newestBackupTime === null ? Infinity : Date.now() - newestBackupTime;
    if (elapsed >= intervalMs) {
      await runBackup();
    } else {
      schedule(intervalMs - elapsed);
    }
  })();

  return {
    backupDir,
    ready,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    }
  };
}

module.exports = {
  createDatabaseBackup,
  pruneOldBackups,
  startDatabaseBackupScheduler
};