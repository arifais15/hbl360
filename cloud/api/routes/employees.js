const express = require('express');
const bcrypt = require('bcryptjs');
const { authenticateToken, requireRole } = require('../lib/auth');
const { allocateId, getDb, getRecord, listRecords, writeAudit } = require('../lib/records');
const { collection } = require('../lib/firestore');

const router = express.Router();
const staffRoles = ['admin', 'accounts'];

function normalizeEmployeeCode(value) {
  const code = String(value || '').trim();
  return /^\d{1,4}$/.test(code) ? code.padStart(4, '0') : code;
}

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    let employees = await listRecords('employees');
    let loans = await listRecords('loans');
    if (req.user.role === 'employee') {
      employees = employees.filter(employee => employee.id === req.user.employeeId);
      loans = loans.filter(loan => loan.employee_id === req.user.employeeId);
    }

    const search = String(req.query.search || '').toLocaleLowerCase();
    const department = String(req.query.department || '');
    const currentPosting = String(req.query.currentPosting || '');
    const result = employees
      .filter(employee => !search || [employee.emp_code, employee.name, employee.mobile]
        .some(value => String(value || '').toLocaleLowerCase().includes(search)))
      .filter(employee => !department || employee.department === department)
      .filter(employee => !currentPosting || employee.current_posting_pbs === currentPosting)
      .map(employee => {
        const activeLoans = loans.filter(loan => loan.employee_id === employee.id && loan.status === 'ACTIVE');
        return {
          ...employee,
          active_loans_count: activeLoans.length,
          total_disbursed: activeLoans.reduce((sum, loan) => sum + Number(loan.disbursed_amount || 0), 0),
          total_principal_balance: activeLoans.reduce((sum, loan) => sum + Number(loan.principal_balance || 0), 0),
          total_interest_balance: activeLoans.reduce((sum, loan) => sum + Number(loan.interest_balance || 0), 0),
          total_monthly_installment: activeLoans.reduce((sum, loan) => sum + Number(loan.monthly_installment || 0), 0)
        };
      });
    res.json({ success: true, employees: result });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    if (req.user.role === 'employee' && req.user.employeeId !== req.params.id) {
      return res.status(403).json({ success: false, message: 'শুধুমাত্র নিজের তথ্য দেখার অনুমতি আছে।' });
    }
    const employee = await getRecord('employees', req.params.id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'কর্মকর্তা/কর্মচারী খুঁজে পাওয়া যায়নি।' });
    }
    const loans = (await listRecords('loans'))
      .filter(loan => loan.employee_id === employee.id)
      .sort((left, right) => String(right.disbursement_date || '').localeCompare(String(left.disbursement_date || '')));
    res.json({ success: true, employee, loans });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const { emp_code, name, designation } = req.body || {};
    if (typeof emp_code !== 'string' || typeof name !== 'string' || typeof designation !== 'string'
      || !emp_code.trim() || !name.trim() || !designation.trim()) {
      return res.status(400).json({ success: false, message: 'পে আইডি, নাম এবং পদবী আবশ্যক।' });
    }
    const code = normalizeEmployeeCode(emp_code);
    const existing = await collection('employees').where('emp_code', '==', code).limit(10).get();
    if (existing.docs.some(document => document.get('is_deleted') !== true)) {
      return res.status(400).json({ success: false, message: `পে আইডি (${code}) এর কর্মচারী ইতিমধ্যে নিবন্ধিত আছেন।` });
    }
    const id = await allocateId('employees');
    const userId = `employee-${code}`;
    const existingUser = await collection('users').doc(userId).get();
    if (existingUser.exists && existingUser.get('is_deleted') !== true) {
      return res.status(400).json({ success: false, message: 'এই পে আইডি দিয়ে লগইন ব্যবহারকারী ইতিমধ্যে নিবন্ধিত।' });
    }
    const now = new Date().toISOString();
    const employee = {
      emp_code: code,
      name: name.trim(),
      designation: designation.trim(),
      department: String(req.body.department || 'জেনারেল/প্রশাসন').trim(),
      mobile: String(req.body.mobile || '').trim(),
      email: String(req.body.email || '').trim(),
      joining_date: req.body.joining_date || null,
      current_posting_pbs: String(req.body.current_posting_pbs || 'নিজস্ব পবিস').trim(),
      is_active: true,
      is_deleted: false,
      created_at: now,
      updated_at: now
    };
    const passwordHash = await bcrypt.hash('password123', 10);
    const user = {
      username: code,
      password_hash: passwordHash,
      full_name: employee.name,
      role: 'employee',
      employee_id: id,
      is_master_admin: false,
      is_active: true,
      is_deleted: false,
      created_at: now
    };
    await getDb().runTransaction(async transaction => {
      const currentEmployee = await transaction.get(collection('employees').where('emp_code', '==', code).limit(10));
      if (currentEmployee.docs.some(document => document.get('is_deleted') !== true)) {
        const conflict = new Error('Employee code already exists.');
        conflict.code = 'ALREADY_EXISTS';
        throw conflict;
      }
      const currentUser = await transaction.get(collection('users').doc(userId));
      if (currentUser.exists && currentUser.get('is_deleted') !== true) {
        const conflict = new Error('Employee login already exists.');
        conflict.code = 'ALREADY_EXISTS';
        throw conflict;
      }
      transaction.create(collection('employees').doc(id), employee);
      transaction.set(collection('users').doc(userId), user);
    });
    await writeAudit(req.user, 'CREATE', 'EMPLOYEE', id, `New employee: ${employee.name} (${code})`);
    res.json({
      success: true,
      message: `কর্মকর্তা/কর্মচারী সফলভাবে নিবন্ধিত হয়েছে। পে আইডি: ${code}, ডিফল্ট লগইন পাসওয়ার্ড: password123`,
      id,
      emp_code: code
    });
  } catch (error) {
    if (error.code === 'ALREADY_EXISTS') {
      return res.status(400).json({ success: false, message: 'এই পে আইডি ইতিমধ্যে নিবন্ধিত।' });
    }
    next(error);
  }
});

router.put('/:id', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const existing = await getRecord('employees', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'কর্মকর্তা/কর্মচারী খুঁজে পাওয়া যায়নি।' });
    }
    const fields = ['name', 'designation', 'department', 'mobile', 'email', 'joining_date', 'current_posting_pbs', 'is_active'];
    const update = Object.fromEntries(fields
      .filter(field => req.body[field] !== undefined)
      .map(field => [field, req.body[field]]));
    if (Object.hasOwn(update, 'name') && typeof update.name !== 'string') {
      return res.status(400).json({ success: false, message: 'কর্মচারীর নাম সঠিকভাবে দিন।' });
    }
    update.updated_at = new Date().toISOString();
    const employeeRef = collection('employees').doc(existing.id);
    await getDb().runTransaction(async transaction => {
      const users = await transaction.get(collection('users').where('employee_id', '==', existing.id).limit(10));
      transaction.update(employeeRef, update);
      for (const user of users.docs) {
        if (update.name) {
          transaction.update(user.ref, { full_name: update.name });
        }
      }
    });
    await writeAudit(req.user, 'UPDATE', 'EMPLOYEE', existing.id, `Employee updated: ${update.name || existing.name}`);
    res.json({ success: true, message: 'তথ্য সফলভাবে হালনাগাদ করা হয়েছে।' });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const employee = await getRecord('employees', req.params.id);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'কর্মকর্তা/কর্মচারী খুঁজে পাওয়া যায়নি।' });
    }
    const activeLoans = (await listRecords('loans'))
      .filter(loan => loan.employee_id === employee.id && loan.status === 'ACTIVE');
    if (activeLoans.length) {
      return res.status(400).json({
        success: false,
        message: `এই কর্মচারীর ${activeLoans.length} টি সক্রিয় ঋণ রয়েছে। ঋণ বন্ধ অথবা ডিলিট না করে কর্মচারীর রেকর্ড বাতিল করা যাবে না।`
      });
    }
    const now = new Date().toISOString();
    await getDb().runTransaction(async transaction => {
      const users = await transaction.get(collection('users').where('employee_id', '==', employee.id).limit(10));
      transaction.update(collection('employees').doc(employee.id), {
        is_deleted: true, deleted_at: now, deleted_by: req.user.username
      });
      for (const user of users.docs) {
        transaction.update(user.ref, {
          is_deleted: true, deleted_at: now, deleted_by: req.user.username
        });
      }
    });
    await writeAudit(req.user, 'DELETE', 'EMPLOYEE', employee.id, `Employee moved to recycle bin: ${employee.name} (${employee.emp_code})`);
    res.json({ success: true, message: 'কর্মচারীর রেকর্ড রিসাইকেল বিনে পাঠানো হয়েছে। প্রয়োজন হলে পুনরুদ্ধার করা যাবে।' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
