const express = require('express');
const bcrypt = require('bcryptjs');
const { authenticateToken, requireRole } = require('../lib/auth');
const { collection } = require('../lib/firestore');
const { getRecord, listRecords, writeAudit } = require('../lib/records');

const router = express.Router();

router.get('/me', authenticateToken, async (req, res, next) => {
  try {
    const user = await getRecord('users', req.user.id);
    if (!user || user.is_deleted || user.is_active === false) {
      return res.status(401).json({ success: false, message: 'Session expired. Please sign in again.' });
    }

    const employee = user.employee_id ? await getRecord('employees', user.employee_id) : null;
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        full_name: user.full_name || employee?.name || '',
        employee_id: user.employee_id || null,
        isMasterAdmin: Boolean(user.is_master_admin),
        emp_code: employee?.emp_code || null,
        emp_name: employee?.name || null,
        emp_designation: employee?.designation || null,
        department: employee?.department || null
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/change-password', authenticateToken, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' });
    }

    const userRef = collection('users').doc(String(req.user.id));
    const userSnapshot = await userRef.get();
    if (!userSnapshot.exists || !(await bcrypt.compare(currentPassword, userSnapshot.get('password_hash')))) {
      return res.status(400).json({ success: false, message: 'বর্তমান পাসওয়ার্ড সঠিক নয়।' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await userRef.update({ password_hash: passwordHash, updated_at: new Date().toISOString() });
    await writeAudit(req.user, 'UPDATE', 'USER', req.user.id, 'Password changed');
    res.json({ success: true, message: 'পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।' });
  } catch (error) {
    next(error);
  }
});

router.get('/users', authenticateToken, requireRole(['admin']), async (req, res, next) => {
  try {
    const [users, employees] = await Promise.all([
      listRecords('users'),
      listRecords('employees')
    ]);
    const employeeById = new Map(employees.map(employee => [employee.id, employee]));
    const result = users.map(user => {
      const employee = employeeById.get(user.employee_id);
      return {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        is_active: user.is_active,
        created_at: user.created_at,
        emp_code: employee?.emp_code || null,
        emp_name: employee?.name || null,
        designation: employee?.designation || null
      };
    });
    res.json({ success: true, users: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
