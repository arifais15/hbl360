const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../database/db');

function readJwtSecret(secretPath) {
  const secret = fs.readFileSync(secretPath, 'utf8').trim();
  if (!secret) {
    throw new Error(`JWT secret file is empty: ${secretPath}`);
  }
  return secret;
}

function getJwtSecret() {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  if (db.isPostgres) {
    throw new Error('JWT_SECRET must be set when using Supabase PostgreSQL so tokens remain valid across serverless instances.');
  }

  const secretPath = path.join(db.dataDir, '.jwt_secret');
  try {
    return readJwtSecret(secretPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const secret = crypto.randomBytes(64).toString('hex');
  try {
    fs.writeFileSync(secretPath, secret, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return secret;
  } catch (error) {
    if (error.code === 'EEXIST') {
      return readJwtSecret(secretPath);
    }
    throw error;
  }
}

const JWT_SECRET = getJwtSecret();

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];
  
  // Also check query param or cookie for simple reports/print views if needed
  if (!token && req.query && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'অননুমোদিত প্রবেশাধিকার। অনুগ্রহ করে প্রথমে লগইন করুন।' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'লগইন মেয়াদ উত্তীর্ণ হয়েছে। পুনরায় লগইন করুন।' });
    }
    req.user = user;
    next();
  });
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'অননুমোদিত অ্যাক্সেস।' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'এই অ্যাকশনটি সম্পন্ন করার প্রশাসনিক অনুমতি আপনার নেই।' });
    }
    next();
  };
}

function requireMasterAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'অননুমোদিত অ্যাক্সেস।' });
  }

  const user = db.prepare(`
    SELECT is_master_admin
    FROM users
    WHERE id = ? AND is_active = 1 AND is_deleted = 0
  `).get(req.user.id);

  if (!user || !user.is_master_admin) {
    return res.status(403).json({ success: false, message: 'এই পরিবর্তনের জন্য মাস্টার অ্যাডমিন অনুমতি প্রয়োজন।' });
  }
  next();
}

module.exports = {
  JWT_SECRET,
  authenticateToken,
  requireRole,
  requireMasterAdmin
};
