const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const app = require('../api');

async function withServer(run) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test('health endpoint identifies the Firestore edition without opening a database connection', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ONLINE', edition: 'cloud-firestore' });
  });
});

test('protected identity endpoint rejects requests without a bearer token', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/auth/me`);
    assert.equal(response.status, 401);
  });
});

test('repayment endpoints are mounted and require authentication', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/repayments`);
    assert.equal(response.status, 401);
  });
});

test('provision endpoints are mounted and require authentication', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/provisions`);
    assert.equal(response.status, 401);
  });
});

test('recycle bin endpoints are mounted and require authentication', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/recyclebin`);
    assert.equal(response.status, 401);
  });
});

test('remittance endpoints are mounted and require authentication', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/remittances/pending`);
    assert.equal(response.status, 401);
  });
});

test('report endpoints are mounted and require authentication', async () => {
  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/reports/comparative-statement`);
    assert.equal(response.status, 401);
  });
});

test('protected admin endpoint returns verified token claims without a Firestore connection', async () => {
  const secret = 'test-secret-with-more-than-thirty-two-bytes';
  process.env.JWT_SECRET = secret;
  const token = jwt.sign({
    id: 'user-1',
    username: 'admin',
    role: 'admin',
    fullName: 'Test Admin',
    employeeId: null,
    isMasterAdmin: true
  }, secret);

  await withServer(async baseUrl => {
    const response = await fetch(`${baseUrl}/api/admin/health`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.username, 'admin');
    assert.equal(body.user.role, 'admin');
    assert.equal(Object.hasOwn(body.user, 'password_hash'), false);
  });
});

test('unknown Firestore collections are rejected before connecting to Firebase', () => {
  const { collection } = require('../api/lib/firestore');
  assert.throws(() => collection('untrusted_collection'), /Unknown cloud data collection/);
});
