const express = require('express');
const { authenticateToken, login, requireRole } = require('./lib/auth');
const authRoutes = require('./routes/auth');
const employeeRoutes = require('./routes/employees');
const loanRoutes = require('./routes/loans');
const repaymentRoutes = require('./routes/repayments');
const provisionRoutes = require('./routes/provisions');
const recycleBinRoutes = require('./routes/recyclebin');
const remittanceRoutes = require('./routes/remittances');
const reportRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');
const syncRoutes = require('./routes/sync');

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

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/repayments', repaymentRoutes);
app.use('/api/provisions', provisionRoutes);
app.use('/api/recyclebin', recycleBinRoutes);
app.use('/api/remittances', remittanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/sync', syncRoutes);

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
