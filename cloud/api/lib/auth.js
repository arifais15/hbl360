const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { collection, getDb } = require('./firestore');

const BOOTSTRAP_ADMIN_ID = 'bootstrap-admin';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 bytes.');
  }
  return secret;
}

async function ensureBootstrapAdmin() {
  const username = process.env.CLOUD_ADMIN_USERNAME;
  const password = process.env.CLOUD_ADMIN_PASSWORD;

  if (!username || !password || password.length < 12) {
    throw new Error('Set CLOUD_ADMIN_USERNAME and a CLOUD_ADMIN_PASSWORD of at least 12 characters.');
  }

  const adminRef = collection('users').doc(BOOTSTRAP_ADMIN_ID);
  const existing = await adminRef.get();
  if (!existing.exists) {
    const passwordHash = await bcrypt.hash(password, 12);
    await getDb().runTransaction(async transaction => {
      const current = await transaction.get(adminRef);
      if (!current.exists) {
        transaction.create(adminRef, {
          username,
          password_hash: passwordHash,
          full_name: 'Cloud System Administrator',
          role: 'admin',
          is_master_admin: true,
          is_active: true,
          is_deleted: false,
          created_at: new Date().toISOString()
        });
      }
    });
  }

  return adminRef;
}

async function login(username, password) {
  await ensureBootstrapAdmin();
  const users = await collection('users')
    .where('username', '==', username.trim())
    .limit(10)
    .get();
  const userDoc = users.docs.find(doc => doc.get('is_active') === true && doc.get('is_deleted') !== true);
  if (!userDoc || !(await bcrypt.compare(password, userDoc.get('password_hash')))) {
    return null;
  }

  const user = userDoc.data();
  const publicUser = {
    id: userDoc.id,
    username: user.username,
    role: user.role,
    fullName: user.full_name,
    employeeId: user.employee_id || null,
    isMasterAdmin: Boolean(user.is_master_admin)
  };
  const token = jwt.sign(publicUser, getJwtSecret(), { expiresIn: '24h' });
  return { token, user: publicUser };
}

function authenticateToken(req, res, next) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  try {
    req.user = jwt.verify(token, getJwtSecret());
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    }
    next(error);
  }
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'This action is not permitted.' });
    }
    next();
  };
}

module.exports = { authenticateToken, login, requireRole };
