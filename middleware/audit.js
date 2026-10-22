const db = require('../database/db');

function logAudit(req, action, entityType, entityId, details) {
  try {
    const userId = req && req.user ? req.user.id : null;
    const username = req && req.user ? req.user.username : 'SYSTEM/ANONYMOUS';
    const ipAddress = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '') : 'LOCAL';

    const stmt = db.prepare(`
      INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      userId,
      username,
      action,
      entityType,
      entityId || null,
      typeof details === 'object' ? JSON.stringify(details) : String(details || ''),
      String(ipAddress)
    );
  } catch (error) {
    console.error('Audit logging error:', error);
  }
}

module.exports = {
  logAudit
};
