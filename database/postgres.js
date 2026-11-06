const { Worker } = require('node:worker_threads');
const path = require('node:path');
const { translateSql, insertReturningId } = require('./postgresSql');

const SHARED_BUFFER_SIZE = 64 * 1024 * 1024;
const RESPONSE_TIMEOUT_MS = 120000;

function createPostgresDatabase(connectionString) {
  if (!connectionString) {
    throw new Error('SUPABASE_DATABASE_URL must be set to enable PostgreSQL.');
  }

  const sharedBuffer = new SharedArrayBuffer(SHARED_BUFFER_SIZE);
  const control = new Int32Array(sharedBuffer, 0, 4);
  const bytes = new Uint8Array(sharedBuffer, 16);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const worker = new Worker(path.join(__dirname, 'postgresBridgeWorker.js'), {
    workerData: { connectionString, sharedBuffer }
  });
  worker.unref();
  worker.on('message', message => {
    if (message.type === 'connection-error') {
      console.error('[Database] PostgreSQL connection error:', message.message);
    }
  });
  worker.on('error', error => {
    console.error('[Database] PostgreSQL worker error:', error);
  });

  function request(operation) {
    const payload = encoder.encode(JSON.stringify(operation));
    if (payload.length > bytes.length) {
      throw new Error('PostgreSQL request exceeded the database bridge limit.');
    }
    bytes.set(payload);
    Atomics.store(control, 1, payload.length);
    Atomics.store(control, 2, 0);
    Atomics.store(control, 3, 0);
    const sequence = Atomics.add(control, 0, 1) + 1;
    Atomics.notify(control, 0);

    const deadline = Date.now() + RESPONSE_TIMEOUT_MS;
    while (Atomics.load(control, 3) === 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Timed out waiting for the PostgreSQL database.');
      Atomics.wait(control, 3, 0, remaining);
    }

    const responseLength = Atomics.load(control, 2);
    const response = JSON.parse(decoder.decode(bytes.subarray(0, responseLength)));
    if (!response.ok) {
      const error = new Error(response.error.message);
      Object.assign(error, response.error);
      throw error;
    }
    return response.result;
  }

  const db = {
    isPostgres: true,
    dataDir: null,
    dbDir: null,
    dbPath: null,
    pragma() {},
    exec(sql) {
      const translated = translateSql(sql);
      request({ type: 'exec', sql: translated.sql });
      return db;
    },
    prepare(sql) {
      const translated = translateSql(sql);
      return {
        all(...params) {
          return request({ type: 'query', sql: translated.sql, params }).rows;
        },
        get(...params) {
          return request({ type: 'query', sql: translated.sql, params }).rows[0];
        },
        run(...params) {
          const query = insertReturningId(translated.sql);
          const result = request({ type: 'query', sql: query, params });
          return {
            changes: result.rowCount,
            lastInsertRowid: result.rows[0] ? result.rows[0].id : undefined
          };
        }
      };
    },
    transaction(callback) {
      return (...args) => {
        request({ type: 'exec', sql: 'BEGIN' });
        try {
          const result = callback(...args);
          request({ type: 'exec', sql: 'COMMIT' });
          return result;
        } catch (error) {
          try {
            request({ type: 'exec', sql: 'ROLLBACK' });
          } catch (_) {}
          throw error;
        }
      };
    },
    close() {
      request({ type: 'close' });
      worker.terminate();
    }
  };
  return db;
}

module.exports = { createPostgresDatabase };
