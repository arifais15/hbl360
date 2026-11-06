const { parentPort, workerData } = require('node:worker_threads');
const { Client, types } = require('pg');

types.setTypeParser(20, value => Number(value));

const control = new Int32Array(workerData.sharedBuffer, 0, 4);
const bytes = new Uint8Array(workerData.sharedBuffer, 16);
const decoder = new TextDecoder();
const encoder = new TextEncoder();
let client;

function writeResponse(response) {
  let encoded = encoder.encode(JSON.stringify(response));
  if (encoded.length > bytes.length) {
    encoded = encoder.encode(JSON.stringify({
      ok: false,
      error: { message: 'PostgreSQL response exceeded the database bridge limit.' }
    }));
  }
  bytes.set(encoded);
  Atomics.store(control, 2, encoded.length);
  Atomics.store(control, 3, 1);
  Atomics.notify(control, 3);
}

async function connect() {
  if (client) return;
  const pendingClient = new Client({
    connectionString: workerData.connectionString,
    ssl: { rejectUnauthorized: true },
    connectionTimeoutMillis: 15000,
    keepAlive: true
  });
  pendingClient.on('error', error => {
    if (client === pendingClient) client = null;
    parentPort.postMessage({ type: 'connection-error', message: error.message });
  });
  try {
    await pendingClient.connect();
    client = pendingClient;
  } catch (error) {
    pendingClient.removeAllListeners();
    client = null;
    throw error;
  }
}

async function handle(request) {
  if (request.type === 'close') {
    if (client) await client.end();
    return null;
  }

  await connect();
  if (request.type === 'exec') {
    await client.query(request.sql);
    return { rows: [], rowCount: 0 };
  }

  const result = request.params && request.params.length
    ? await client.query({ text: request.sql, values: request.params })
    : await client.query(request.sql);
  return { rows: result.rows, rowCount: result.rowCount || 0 };
}

let sequence = 0;
(async () => {
  while (true) {
    Atomics.wait(control, 0, sequence);
    sequence = Atomics.load(control, 0);
    const length = Atomics.load(control, 1);
    try {
      const request = JSON.parse(decoder.decode(bytes.subarray(0, length)));
      const result = await handle(request);
      writeResponse({ ok: true, result });
      if (request.type === 'close') break;
    } catch (error) {
      writeResponse({
        ok: false,
        error: {
          message: error.message,
          code: error.code,
          constraint: error.constraint,
          detail: error.detail
        }
      });
    }
  }
  parentPort.close();
})().catch(error => {
  writeResponse({ ok: false, error: { message: error.message } });
});
