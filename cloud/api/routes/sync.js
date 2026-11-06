const express = require('express');
const { authenticateToken } = require('../lib/auth');
const { collection } = require('../lib/firestore');

const router = express.Router();

router.get('/changes', authenticateToken, async (req, res, next) => {
  try {
    const since = typeof req.query.since === 'string' ? req.query.since : '';
    const snapshot = await collection('audit_logs')
      .orderBy('created_at', 'desc')
      .limit(1)
      .get();
    const latest = snapshot.empty ? null : snapshot.docs[0].get('created_at');
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      changed: Boolean(latest && (!since || latest > since)),
      latest: latest || null
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
