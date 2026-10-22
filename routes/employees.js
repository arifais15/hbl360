const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const {
  cellText,
  downloadTemplate,
  parseExcelDate,
  readWorkbookRows,
  uploadWorkbook
} = require('../services/excelImportService');

const employeeImportFields = [
  { key: 'emp_code', required: true, description: 'কর্মচারীর পে আইডি / কোড। ১-৪ সংখ্যার কোড ৪ সংখ্যায় পূরণ হবে।' },
  { key: 'name', required: true, description: 'কর্মকর্তা/কর্মচারীর পুরো নাম।' },
  { key: 'designation', required: true, description: 'পদবী।' },
  { key: 'department', required: false, description: 'বিভাগ; ফাঁকা থাকলে জেনারেল/প্রশাসন হবে।' },
  { key: 'mobile', required: false, description: 'মোবাইল নম্বর।' },
  { key: 'email', required: false, description: 'ইমেইল ঠিকানা।' },
  { key: 'joining_date', required: false, description: 'যোগদানের তারিখ; YYYY-MM-DD format।' },
  { key: 'current_posting_pbs', required: false, description: 'বর্তমান পদায়ন/পবিস; ফাঁকা থাকলে নিজস্ব পবিস হবে।' }
];

// List All Employees
router.get('/', authenticateToken, (req, res) => {
  try {
    const { search, department, currentPosting } = req.query;

    let query = `
      SELECT e.*,
             COUNT(DISTINCT CASE WHEN l.is_deleted = 0 AND l.status = 'ACTIVE' THEN l.id END) as active_loans_count,
             COALESCE(SUM(CASE WHEN l.is_deleted = 0 AND l.status = 'ACTIVE' THEN l.disbursed_amount END), 0) as total_disbursed,
             COALESCE(SUM(CASE WHEN l.is_deleted = 0 AND l.status = 'ACTIVE' THEN l.principal_balance END), 0) as total_principal_balance,
             COALESCE(SUM(CASE WHEN l.is_deleted = 0 AND l.status = 'ACTIVE' THEN l.interest_balance END), 0) as total_interest_balance,
             COALESCE(SUM(CASE WHEN l.is_deleted = 0 AND l.status = 'ACTIVE' THEN l.monthly_installment END), 0) as total_monthly_installment
      FROM employees e
      LEFT JOIN loans l ON e.id = l.employee_id
      WHERE e.is_deleted = 0
    `;
    const params = [];

    if (search) {
      query += ` AND (e.emp_code LIKE ? OR e.name LIKE ? OR e.mobile LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (department) {
      query += ` AND e.department = ?`;
      params.push(department);
    }

    query += ` GROUP BY e.id ORDER BY e.id DESC`;

    const employees = db.prepare(query).all(...params);
    res.json({ success: true, employees });
  } catch (error) {
    console.error('Fetch employees error:', error);
    res.status(500).json({ success: false, message: 'কর্মকর্তা/কর্মচারী তালিকা আনা সম্ভব হয়নি।' });
  }
});

router.get('/import-template', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  downloadTemplate(res, 'employee_import_template.xlsx', employeeImportFields);
});

router.post('/import', authenticateToken, requireRole(['admin', 'accounts']), uploadWorkbook, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'একটি .xlsx ফাইল নির্বাচন করুন।' });
    }

    const rows = readWorkbookRows(req.file.buffer, employeeImportFields.map(field => field.key));
    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'Excel ফাইলে আমদানির জন্য কোনো তথ্য নেই।' });
    }
    if (rows.length > 1000) {
      return res.status(400).json({ success: false, message: 'একবারে সর্বোচ্চ ১০০০টি কর্মচারী রেকর্ড আমদানি করা যাবে।' });
    }

    const errors = [];
    const skipped = [];
    const seenCodes = new Set();
    const accepted = [];
    const findEmployee = db.prepare('SELECT id FROM employees WHERE emp_code = ?');
    const findUser = db.prepare('SELECT id FROM users WHERE username = ?');

    for (const row of rows) {
      const value = row.values;
      const rawCode = cellText(value.emp_code);
      const empCode = /^\d{1,4}$/.test(rawCode) ? rawCode.padStart(4, '0') : rawCode;
      const name = cellText(value.name);
      const designation = cellText(value.designation);

      if (!empCode || !name || !designation) {
        errors.push({ row: row.rowNumber, message: 'পে আইডি, নাম এবং পদবী আবশ্যক।' });
        continue;
      }
      if (seenCodes.has(empCode) || findEmployee.get(empCode)) {
        skipped.push({ row: row.rowNumber, key: empCode, reason: 'পে আইডি ইতিমধ্যে বিদ্যমান।' });
        continue;
      }
      if (findUser.get(empCode)) {
        errors.push({ row: row.rowNumber, message: `পে আইডি ${empCode} দিয়ে লগইন ব্যবহারকারী আগে থেকেই আছে।` });
        continue;
      }

      seenCodes.add(empCode);
      accepted.push({
        row: row.rowNumber,
        emp_code: empCode,
        name,
        designation,
        department: cellText(value.department) || 'জেনারেল/প্রশাসন',
        mobile: cellText(value.mobile),
        email: cellText(value.email),
        joining_date: value.joining_date === '' ? null : parseExcelDate(value.joining_date),
        current_posting_pbs: cellText(value.current_posting_pbs) || 'নিজস্ব পবিস'
      });

      if (value.joining_date !== '' && !accepted[accepted.length - 1].joining_date) {
        errors.push({ row: row.rowNumber, message: 'যোগদানের তারিখ YYYY-MM-DD format-এ দিন।' });
      }
    }

    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: 'Excel ফাইলে ভুল আছে; কোনো রেকর্ড আমদানি করা হয়নি।',
        errors,
        skipped
      });
    }

    const defaultPasswordHash = bcrypt.hashSync('password123', bcrypt.genSaltSync(10));
    const importEmployees = db.transaction(() => {
      for (const employee of accepted) {
        const result = db.prepare(`
          INSERT INTO employees (emp_code, name, designation, department, mobile, email, joining_date, current_posting_pbs)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          employee.emp_code,
          employee.name,
          employee.designation,
          employee.department,
          employee.mobile,
          employee.email,
          employee.joining_date,
          employee.current_posting_pbs
        );
        const employeeId = result.lastInsertRowid;
        db.prepare(`
          INSERT INTO users (username, password_hash, full_name, role, employee_id)
          VALUES (?, ?, ?, 'employee', ?)
        `).run(employee.emp_code, defaultPasswordHash, employee.name, employeeId);
        logAudit(req, 'CREATE', 'EMPLOYEE', employeeId, `Excel থেকে কর্মচারী আমদানি: ${employee.name} (${employee.emp_code})`);
      }
    });
    importEmployees();

    res.json({
      success: true,
      message: `${accepted.length} জন কর্মচারী আমদানি হয়েছে।`,
      imported: accepted.length,
      skipped
    });
  } catch (error) {
    console.error('Employee Excel import error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'কর্মচারী Excel আমদানি ব্যর্থ হয়েছে।' });
  }
});

// Single Employee Details with all their loans
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const empId = req.params.id;

    // Check if regular employee is accessing their own data
    if (req.user.role === 'employee' && req.user.employeeId != empId) {
      return res.status(403).json({ success: false, message: 'শুধুমাত্র নিজের তথ্য দেখার অনুমতি আছে।' });
    }

    const employee = db.prepare(`SELECT * FROM employees WHERE id = ? AND is_deleted = 0`).get(empId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'কর্মকর্তা/কর্মচারী খুঁজে পাওয়া যায়নি।' });
    }

    // Get all loans of this employee (multiple loans supported!)
    const loans = db.prepare(`
      SELECT l.*, p.short_name as other_pbs_short
      FROM loans l
      LEFT JOIN other_pbs p ON l.origin_pbs_id = p.id
      WHERE l.employee_id = ? AND l.is_deleted = 0
      ORDER BY l.disbursement_date DESC
    `).all(empId);

    res.json({ success: true, employee, loans });
  } catch (error) {
    console.error('Employee details error:', error);
    res.status(500).json({ success: false, message: 'তথ্য আনা সম্ভব হয়নি।' });
  }
});

// Create Employee (Admin & Accounts only)
router.post('/', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const { emp_code, name, designation, department, mobile, email, joining_date, current_posting_pbs } = req.body;

    if (!emp_code || !name || !designation) {
      return res.status(400).json({ success: false, message: 'পে আইডি (৪ সংখ্যা), নাম এবং পদবী আবশ্যক।' });
    }

    // Format Pay ID to 4 digits (e.g. 0112, 0101)
    const rawCode = emp_code.trim();
    const formattedCode = /^\d{1,4}$/.test(rawCode) ? rawCode.padStart(4, '0') : rawCode;

    // Check existing code
    const existing = db.prepare('SELECT id FROM employees WHERE emp_code = ? AND is_deleted = 0').get(formattedCode);
    if (existing) {
      return res.status(400).json({ success: false, message: `পে আইডি (${formattedCode}) এর কর্মচারী ইতিমধ্যে নিবন্ধিত আছেন।` });
    }

    const stmt = db.prepare(`
      INSERT INTO employees (emp_code, name, designation, department, mobile, email, joining_date, current_posting_pbs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      formattedCode,
      name.trim(),
      designation.trim(),
      department ? department.trim() : 'জেনারেল/প্রশাসন',
      mobile ? mobile.trim() : '',
      email ? email.trim() : '',
      joining_date || null,
      current_posting_pbs ? current_posting_pbs.trim() : 'নিজস্ব পবিস'
    );

    const newEmpId = result.lastInsertRowid;

    // Automatically create a user login account for the employee using 4-digit Pay ID so they can log in
    const defaultPassword = 'password123';
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(defaultPassword, salt);

    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role, employee_id)
      VALUES (?, ?, ?, 'employee', ?)
    `).run(formattedCode, hash, name.trim(), newEmpId);

    logAudit(req, 'CREATE', 'EMPLOYEE', newEmpId, `নতুন কর্মচারী যুক্ত করা হয়েছে: ${name} (পে আইডি: ${formattedCode})`);

    res.json({
      success: true,
      message: `কর্মকর্তা/কর্মচারী সফলভাবে নিবন্ধিত হয়েছে। পে আইডি: ${formattedCode}, ডিফল্ট লগইন পাসওয়ার্ড: password123`,
      id: newEmpId,
      emp_code: formattedCode
    });
  } catch (error) {
    console.error('Create employee error:', error);
    res.status(500).json({ success: false, message: 'কর্মচারী নিবন্ধন ব্যর্থ হয়েছে।' });
  }
});

// Update Employee
router.put('/:id', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const empId = req.params.id;
    const { name, designation, department, mobile, email, joining_date, current_posting_pbs, is_active } = req.body;

    const existing = db.prepare('SELECT * FROM employees WHERE id = ? AND is_deleted = 0').get(empId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'কর্মকর্তা/কর্মচারী খুঁজে পাওয়া যায়নি।' });
    }

    db.prepare(`
      UPDATE employees
      SET name = ?, designation = ?, department = ?, mobile = ?, email = ?,
          joining_date = ?, current_posting_pbs = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name || existing.name,
      designation || existing.designation,
      department || existing.department,
      mobile !== undefined ? mobile : existing.mobile,
      email !== undefined ? email : existing.email,
      joining_date || existing.joining_date,
      current_posting_pbs || existing.current_posting_pbs,
      is_active !== undefined ? is_active : existing.is_active,
      empId
    );

    // Update user full_name if exists
    db.prepare(`UPDATE users SET full_name = ? WHERE employee_id = ?`).run(name || existing.name, empId);

    logAudit(req, 'UPDATE', 'EMPLOYEE', empId, `কর্মচারী তথ্য আপডেট: ${name || existing.name}`);

    res.json({ success: true, message: 'তথ্য সফলভাবে হালনাগাদ করা হয়েছে।' });
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ success: false, message: 'তথ্য আপডেট ব্যর্থ হয়েছে।' });
  }
});

// Soft Delete Employee (Move to Recycle Bin)
router.delete('/:id', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const empId = req.params.id;
    const employee = db.prepare('SELECT * FROM employees WHERE id = ? AND is_deleted = 0').get(empId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'কর্মকর্তা/কর্মচারী খুঁজে পাওয়া যায়নি।' });
    }

    // Check if has active loans
    const activeLoanCount = db.prepare(`SELECT COUNT(*) as count FROM loans WHERE employee_id = ? AND is_deleted = 0 AND status = 'ACTIVE'`).get(empId).count;
    if (activeLoanCount > 0) {
      return res.status(400).json({
        success: false,
        message: `এই কর্মচারীর ${activeLoanCount} টি সক্রিয় ঋণ রয়েছে। ঋণ বন্ধ অথবা ডিলিট না করে কর্মচারীর রেকর্ড বাতিল করা যাবে না।`
      });
    }

    const now = new Date().toISOString();
    const deletedBy = req.user.username;

    db.prepare(`
      UPDATE employees
      SET is_deleted = 1, deleted_at = ?, deleted_by = ?
      WHERE id = ?
    `).run(now, deletedBy, empId);

    // Also soft-delete linked user login
    db.prepare(`
      UPDATE users
      SET is_deleted = 1, deleted_at = ?, deleted_by = ?
      WHERE employee_id = ?
    `).run(now, deletedBy, empId);

    logAudit(req, 'DELETE', 'EMPLOYEE', empId, `কর্মচারী ডিলিট (রিসাইকেল বিনে স্থানান্তর): ${employee.name} (${employee.emp_code})`);

    res.json({ success: true, message: 'কর্মচারীর রেকর্ড রিসাইকেল বিনে পাঠানো হয়েছে। প্রয়োজন হলে পুনরুদ্ধার করা যাবে।' });
  } catch (error) {
    console.error('Delete employee error:', error);
    res.status(500).json({ success: false, message: 'কর্মচারী ডিলিট করা যায়নি।' });
  }
});

module.exports = router;
