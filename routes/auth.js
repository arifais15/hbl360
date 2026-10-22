const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { JWT_SECRET, authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// User Login (Admin, Accounts, Employee)
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'ইউজারনেম এবং পাসওয়ার্ড প্রদান করুন।' });
    }

    const user = db.prepare(`
      SELECT u.*, e.name as emp_name, e.designation as emp_designation, e.emp_code
      FROM users u
      LEFT JOIN employees e ON u.employee_id = e.id
      WHERE (u.username = ? OR e.emp_code = ?) AND u.is_deleted = 0 AND u.is_active = 1
    `).get(username.trim(), username.trim());

    if (!user) {
      return res.status(401).json({ success: false, message: 'ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।' });
    }

    const isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.full_name || user.emp_name,
        employeeId: user.employee_id
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    logAudit({ user, headers: req.headers, socket: req.socket }, 'LOGIN', 'USER', user.id, `ব্যবহারকারী ${user.username} (${user.role}) সফলভাবে লগইন করেছেন`);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.full_name || user.emp_name,
        designation: user.emp_designation || (user.role === 'admin' ? 'সিস্টেম অ্যাডমিনিস্ট্রেটর' : 'হিসাব কর্মকর্তা'),
        employeeId: user.employee_id,
        empCode: user.emp_code
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'লগইন প্রক্রিয়ায় ত্রুটি দেখা দিয়েছে।' });
  }
});

// Current User Profile
router.get('/me', authenticateToken, (req, res) => {
  const user = db.prepare(`
    SELECT u.id, u.username, u.role, u.full_name, u.employee_id,
           e.emp_code, e.name as emp_name, e.designation as emp_designation, e.department
    FROM users u
    LEFT JOIN employees e ON u.employee_id = e.id
    WHERE u.id = ? AND u.is_deleted = 0
  `).get(req.user.id);

  if (!user) {
    return res.status(404).json({ success: false, message: 'ব্যবহারকারী খুঁজে পাওয়া যায়নি।' });
  }

  res.json({ success: true, user });
});

// Change Password
router.post('/change-password', authenticateToken, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(400).json({ success: false, message: 'বর্তমান পাসওয়ার্ড সঠিক নয়।' });
    }

    const salt = bcrypt.genSaltSync(10);
    const newHash = bcrypt.hashSync(newPassword, salt);

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.user.id);

    logAudit(req, 'UPDATE', 'USER', req.user.id, 'পাসওয়ার্ড পরিবর্তন করা হয়েছে');
    res.json({ success: true, message: 'পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'পাসওয়ার্ড পরিবর্তন করা যায়নি।' });
  }
});

// List Users (Admin only)
router.get('/users', authenticateToken, requireRole(['admin']), (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role, u.is_active, u.created_at,
           e.emp_code, e.name as emp_name, e.designation
    FROM users u
    LEFT JOIN employees e ON u.employee_id = e.id
    WHERE u.is_deleted = 0
    ORDER BY u.id DESC
  `).all();
  res.json({ success: true, users });
});

module.exports = router;
