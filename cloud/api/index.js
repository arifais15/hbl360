const express = require('express');
const { authenticateToken, login, requireRole } = require('./lib/auth');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ONLINE', edition: 'cloud-firestore' });
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    const result = await login(username, password);
    if (!result) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ success: true, user: req.user });
});

app.get('/api/admin/health', authenticateToken, requireRole(['admin']), (req, res) => {
  res.json({ success: true, user: req.user, edition: 'cloud-firestore' });
});

app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: 'Cloud API endpoint is not available yet.' });
});

app.use((error, req, res, next) => {
  console.error('Cloud API error:', error);
  if (res.headersSent) {
    return next(error);
  }
  res.status(500).json({ success: false, message: 'Cloud API request failed.' });
});

module.exports = app;
