const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { getApplicableInterestRate, isInterestProvisionApplicable } = require('../services/loanCalculationService');
const { autoProvisionMonth } = require('../services/provisionService');
const {
  cellText,
  downloadTemplate,
  parseAmount,
  parseExcelDate,
  readWorkbookRows,
  uploadWorkbook
} = require('../services/excelImportService');

const loanImportFields = [
  { key: 'employee_code', required: true, description: 'কর্মচারীর পে আইডি / কোড; কর্মচারী তালিকায় থাকতে হবে।' },
  { key: 'loan_no', required: true, description: 'ঋণের অনন্য হিসাব নম্বর।' },
  { key: 'loan_lot_name', required: false, description: 'ঋণের লট; ফাঁকা থাকলে ১ম ঋণ হবে।' },
  { key: 'loan_source_type', required: false, description: 'OWN_PBS অথবা OTHER_PBS; ফাঁকা থাকলে OWN_PBS হবে।' },
  { key: 'origin_pbs_name', required: false, description: 'OTHER_PBS হলে উৎস পবিসের নাম আবশ্যক।' },
  { key: 'sanction_no', required: false, description: 'মঞ্জুরি নম্বর; OTHER_PBS হলে ঐচ্ছিক।' },
  { key: 'sanction_date', required: false, description: 'মঞ্জুরির তারিখ; YYYY-MM-DD। OTHER_PBS হলে ঐচ্ছিক।' },
  { key: 'disbursement_date', required: false, description: 'ঋণ বিতরণের তারিখ; YYYY-MM-DD। OTHER_PBS হলে ঐচ্ছিক।' },
  { key: 'sanction_amount', required: true, description: 'মঞ্জুরিকৃত ঋণের পরিমাণ।' },
  { key: 'disbursed_amount', required: true, description: 'মোট বিতরণকৃত ঋণের পরিমাণ।' },
  { key: 'opening_principal_balance', required: true, description: 'Opening balance date-এ অবশিষ্ট আসল।' },
  { key: 'opening_interest_balance', required: true, description: 'Opening balance date-এ অবশিষ্ট সুদ; না থাকলে 0 দিন।' },
  { key: 'monthly_installment', required: true, description: 'মাসিক কিস্তির পরিমাণ।' },
  { key: 'opening_balance_date', required: true, description: 'বর্তমান আসল/সুদের ব্যালেন্স যে তারিখ পর্যন্ত হিসাব করা; YYYY-MM-DD।' },
  { key: 'remarks', required: false, description: 'ঐচ্ছিক মন্তব্য।' }
];

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function normalizeEmployeeCode(value) {
  const code = cellText(value);
  return /^\d{1,4}$/.test(code) ? code.padStart(4, '0') : code;
}

// Get My Loans (Employee Self-Service)
router.get('/my-loans', authenticateToken, (req, res) => {
  try {
    if (!req.user.employeeId) {
      return res.status(400).json({ success: false, message: 'লগইনকৃত অ্যাকাউন্টের সাথে কোনো কর্মচারী প্রোফাইল যুক্ত নেই।' });
    }

    const loans = db.prepare(`
      SELECT l.*, e.name as emp_name, e.emp_code, e.designation,
             p.short_name as other_pbs_short
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      LEFT JOIN other_pbs p ON l.origin_pbs_id = p.id
      WHERE l.employee_id = ? AND l.is_deleted = 0
      ORDER BY l.disbursement_date DESC
    `).all(req.user.employeeId);

    // Get recent repayments for this employee
    const repayments = db.prepare(`
      SELECT r.*, l.loan_no, l.loan_lot_name
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      WHERE r.employee_id = ? AND r.is_deleted = 0
      ORDER BY r.deduction_month DESC
      LIMIT 24
    `).all(req.user.employeeId);

    res.json({ success: true, loans, repayments });
  } catch (error) {
    console.error('My loans error:', error);
    res.status(500).json({ success: false, message: 'ঋণের তথ্য আনা যায়নি।' });
  }
});

// List All Loans (Admin / Accounts)
router.get('/', authenticateToken, (req, res) => {
  try {
    // Automatically auto-provision interest for current month on active loans
    try {
      autoProvisionMonth();
    } catch (e) {
      console.warn('Auto-provision in GET /loans error:', e.message);
    }

    const { sourceType, status, employeeId, search } = req.query;

    let query = `
      SELECT l.*, e.emp_code, e.name as emp_name, e.designation, e.department,
             p.short_name as other_pbs_short
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      LEFT JOIN other_pbs p ON l.origin_pbs_id = p.id
      WHERE l.is_deleted = 0 AND e.is_deleted = 0
    `;
    const params = [];

    if (sourceType && (sourceType === 'OWN_PBS' || sourceType === 'OTHER_PBS')) {
      query += ` AND l.loan_source_type = ?`;
      params.push(sourceType);
    }

    if (status) {
      query += ` AND l.status = ?`;
      params.push(status);
    }

    if (employeeId) {
      query += ` AND l.employee_id = ?`;
      params.push(employeeId);
    }

    if (search) {
      query += ` AND (l.loan_no LIKE ? OR l.sanction_no LIKE ? OR e.emp_code LIKE ? OR e.name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY l.id DESC`;

    const loans = db.prepare(query).all(...params);

    // Summary calculations
    const summary = {
      totalLoans: loans.length,
      totalDisbursed: loans.reduce((acc, curr) => acc + (curr.disbursed_amount || 0), 0),
      totalPrincipalBalance: loans.reduce((acc, curr) => acc + (curr.principal_balance || 0), 0),
      totalInterestBalance: loans.reduce((acc, curr) => acc + (curr.interest_balance || 0), 0),
      ownPbsCount: loans.filter(l => l.loan_source_type === 'OWN_PBS').length,
      otherPbsCount: loans.filter(l => l.loan_source_type === 'OTHER_PBS').length
    };

    res.json({ success: true, loans, summary });
  } catch (error) {
    console.error('Fetch loans error:', error);
    res.status(500).json({ success: false, message: 'ঋণের তালিকা আনা যায়নি।' });
  }
});

router.get('/import-template', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  downloadTemplate(res, 'loan_opening_balance_import_template.xlsx', loanImportFields);
});

router.post('/import', authenticateToken, requireRole(['admin', 'accounts']), uploadWorkbook, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'একটি .xlsx ফাইল নির্বাচন করুন।' });
    }

    const rows = readWorkbookRows(req.file.buffer, loanImportFields.map(field => field.key));
    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'Excel ফাইলে আমদানির জন্য কোনো তথ্য নেই।' });
    }
    if (rows.length > 1000) {
      return res.status(400).json({ success: false, message: 'একবারে সর্বোচ্চ ১০০০টি ঋণ রেকর্ড আমদানি করা যাবে।' });
    }

    const errors = [];
    const skipped = [];
    const seenLoanNumbers = new Set();
    const accepted = [];
    const findEmployee = db.prepare('SELECT id FROM employees WHERE emp_code = ? AND is_deleted = 0');
    const findLoan = db.prepare('SELECT id FROM loans WHERE loan_no = ?');
    const findOtherPbs = db.prepare('SELECT id, pbs_name FROM other_pbs WHERE pbs_name = ? AND is_deleted = 0');
    const ownSettings = db.prepare('SELECT pbs_name FROM pbs_settings WHERE id = 1').get();
    const today = new Date().toISOString().slice(0, 10);

    for (const row of rows) {
      const value = row.values;
      const employeeCode = normalizeEmployeeCode(value.employee_code);
      const loanNo = cellText(value.loan_no);
      const sourceType = cellText(value.loan_source_type).toUpperCase() || 'OWN_PBS';
      const employee = employeeCode ? findEmployee.get(employeeCode) : null;

      if (!employeeCode || !loanNo) {
        errors.push({ row: row.rowNumber, message: 'কর্মচারীর পে আইডি এবং ঋণ নম্বর আবশ্যক।' });
        continue;
      }
      if (!employee) {
        errors.push({ row: row.rowNumber, message: `পে আইডি ${employeeCode} এর কর্মচারী পাওয়া যায়নি।` });
        continue;
      }
      if (seenLoanNumbers.has(loanNo) || findLoan.get(loanNo)) {
        skipped.push({ row: row.rowNumber, key: loanNo, reason: 'ঋণ নম্বর ইতিমধ্যে বিদ্যমান।' });
        continue;
      }
      seenLoanNumbers.add(loanNo);

      if (!['OWN_PBS', 'OTHER_PBS'].includes(sourceType)) {
        errors.push({ row: row.rowNumber, message: 'loan_source_type অবশ্যই OWN_PBS অথবা OTHER_PBS হবে।' });
        continue;
      }

      const sanctionAmount = parseAmount(value.sanction_amount);
      const disbursedAmount = parseAmount(value.disbursed_amount);
      const principalBalance = parseAmount(value.opening_principal_balance);
      const interestBalance = parseAmount(value.opening_interest_balance);
      const monthlyInstallment = parseAmount(value.monthly_installment);
      const openingBalanceDate = parseExcelDate(value.opening_balance_date);
      let sanctionDate = parseExcelDate(value.sanction_date);
      let disbursementDate = parseExcelDate(value.disbursement_date);
      const originPbsName = cellText(value.origin_pbs_name);
      const otherPbs = sourceType === 'OTHER_PBS' && originPbsName
        ? findOtherPbs.get(originPbsName)
        : null;

      if (sourceType === 'OTHER_PBS') {
        sanctionDate = sanctionDate || openingBalanceDate;
        disbursementDate = disbursementDate || sanctionDate;
      }

      const invalidMessages = [];
      if (!Number.isFinite(sanctionAmount) || sanctionAmount <= 0) invalidMessages.push('sanction_amount শূন্যের বেশি দিন।');
      if (!Number.isFinite(disbursedAmount) || disbursedAmount <= 0) invalidMessages.push('disbursed_amount শূন্যের বেশি দিন।');
      if (!Number.isFinite(principalBalance) || principalBalance < 0) invalidMessages.push('opening_principal_balance শূন্য বা তার বেশি দিন।');
      if (!Number.isFinite(interestBalance) || interestBalance < 0) invalidMessages.push('opening_interest_balance শূন্য বা তার বেশি দিন।');
      if (!Number.isFinite(monthlyInstallment) || monthlyInstallment <= 0) invalidMessages.push('monthly_installment শূন্যের বেশি দিন।');
      if (Number.isFinite(principalBalance) && Number.isFinite(disbursedAmount) && principalBalance > disbursedAmount) {
        invalidMessages.push('অবশিষ্ট আসল বিতরণকৃত ঋণের চেয়ে বেশি হতে পারবে না।');
      }
      if (!isValidIsoDate(openingBalanceDate) || openingBalanceDate > today) {
        invalidMessages.push('opening_balance_date বৈধ YYYY-MM-DD তারিখ হতে হবে এবং ভবিষ্যতের তারিখ হতে পারবে না।');
      }
      if (!isValidIsoDate(sanctionDate) || !isValidIsoDate(disbursementDate)) {
        invalidMessages.push('sanction_date এবং disbursement_date বৈধ YYYY-MM-DD তারিখ হতে হবে।');
      }
      if (isValidIsoDate(openingBalanceDate) && isValidIsoDate(disbursementDate) && openingBalanceDate < disbursementDate) {
        invalidMessages.push('opening_balance_date ঋণ বিতরণের তারিখের আগে হতে পারবে না।');
      }
      if (sourceType === 'OTHER_PBS' && !originPbsName) {
        invalidMessages.push('OTHER_PBS ঋণের জন্য origin_pbs_name আবশ্যক।');
      }

      if (invalidMessages.length) {
        errors.push({ row: row.rowNumber, message: invalidMessages.join(' ') });
        continue;
      }

      accepted.push({
        row: row.rowNumber,
        loan_no: loanNo,
        employee_id: employee.id,
        loan_lot_name: cellText(value.loan_lot_name) || '১ম ঋণ',
        loan_source_type: sourceType,
        origin_pbs_id: otherPbs ? otherPbs.id : null,
        origin_pbs_name: sourceType === 'OTHER_PBS'
          ? (otherPbs ? otherPbs.pbs_name : originPbsName)
          : (ownSettings ? ownSettings.pbs_name : 'নিজস্ব পবিস'),
        sanction_no: cellText(value.sanction_no) || (sourceType === 'OTHER_PBS' ? 'অন্য পবিস' : ''),
        sanction_date: sanctionDate,
        disbursement_date: disbursementDate,
        sanction_amount: sanctionAmount,
        disbursed_amount: disbursedAmount,
        principal_balance: principalBalance,
        interest_balance: interestBalance,
        monthly_installment: monthlyInstallment,
        opening_balance_date: openingBalanceDate,
        interest_rate: sourceType === 'OTHER_PBS' ? 0 : getApplicableInterestRate(disbursementDate),
        is_interest_applicable: isInterestProvisionApplicable(sourceType) ? 1 : 0,
        remarks: cellText(value.remarks)
      });
    }

    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: 'Excel ফাইলে ভুল আছে; কোনো ঋণ আমদানি করা হয়নি।',
        errors,
        skipped
      });
    }

    const importLoans = db.transaction(() => {
      for (const loan of accepted) {
        const result = db.prepare(`
          INSERT INTO loans (
            loan_no, employee_id, loan_lot_name, loan_source_type, origin_pbs_id, origin_pbs_name,
            sanction_no, sanction_date, disbursement_date, sanction_amount, disbursed_amount,
            monthly_installment, interest_rate, is_interest_applicable, principal_balance,
            interest_balance, total_principal_paid, total_interest_paid, status, remarks,
            opening_balance_as_of
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'ACTIVE', ?, ?)
        `).run(
          loan.loan_no,
          loan.employee_id,
          loan.loan_lot_name,
          loan.loan_source_type,
          loan.origin_pbs_id,
          loan.origin_pbs_name,
          loan.sanction_no,
          loan.sanction_date,
          loan.disbursement_date,
          loan.sanction_amount,
          loan.disbursed_amount,
          loan.monthly_installment,
          loan.interest_rate,
          loan.is_interest_applicable,
          loan.principal_balance,
          loan.interest_balance,
          Math.max(0, loan.disbursed_amount - loan.principal_balance),
          loan.remarks,
          loan.opening_balance_date
        );
        logAudit(req, 'CREATE', 'LOAN', result.lastInsertRowid, `Excel থেকে opening balance সহ ঋণ আমদানি: ${loan.loan_no}`);
      }
    });
    importLoans();

    res.json({
      success: true,
      message: `${accepted.length}টি ঋণ আমদানি হয়েছে।`,
      imported: accepted.length,
      skipped
    });
  } catch (error) {
    console.error('Loan Excel import error:', error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message || 'ঋণ Excel আমদানি ব্যর্থ হয়েছে।' });
  }
});

// Single Loan Details with complete statement
router.get('/:id', authenticateToken, (req, res) => {
  try {
    const loanId = req.params.id;
    const loan = db.prepare(`
      SELECT l.*, e.emp_code, e.name as emp_name, e.designation, e.department, e.mobile,
             p.pbs_name as other_pbs_full_name, p.bank_name as other_bank_name, p.account_no as other_account_no
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      LEFT JOIN other_pbs p ON l.origin_pbs_id = p.id
      WHERE l.id = ? AND l.is_deleted = 0
    `).get(loanId);

    if (!loan) {
      return res.status(404).json({ success: false, message: 'ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।' });
    }

    // Role check: employees can only view their own loans
    if (req.user.role === 'employee' && req.user.employeeId != loan.employee_id) {
      return res.status(403).json({ success: false, message: 'এই ঋণের তথ্য দেখার অনুমতি আপনার নেই।' });
    }

    // Get Repayments history
    const repayments = db.prepare(`
      SELECT * FROM repayments
      WHERE loan_id = ? AND is_deleted = 0
      ORDER BY deduction_month ASC, deduction_date ASC
    `).all(loanId);

    // Get Interest Provisions history
    const provisions = db.prepare(`
      SELECT * FROM interest_provisions
      WHERE loan_id = ? AND is_deleted = 0
      ORDER BY provision_month ASC
    `).all(loanId);

    res.json({ success: true, loan, repayments, provisions });
  } catch (error) {
    console.error('Loan details error:', error);
    res.status(500).json({ success: false, message: 'ঋণের বিস্তারিত তথ্য আনা সম্ভব হয়নি।' });
  }
});

// Create New Loan (Multi-loan per employee supported)
router.post('/', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const {
      loan_no,
      employee_id,
      loan_lot_name,
      loan_source_type,
      origin_pbs_id,
      origin_pbs_name,
      sanction_no,
      sanction_date,
      disbursement_date,
      sanction_amount,
      disbursed_amount,
      monthly_installment,
      custom_interest_rate,
      initial_interest_balance,
      remarks
    } = req.body;

    const isOtherPbs = (loan_source_type === 'OTHER_PBS');

    if (!loan_no || !employee_id || !sanction_amount || !disbursed_amount || !monthly_installment) {
      return res.status(400).json({ success: false, message: 'সকল আবশ্যকীয় তথ্য পূরণ করুন।' });
    }

    if (!isOtherPbs && (!sanction_date || !disbursement_date)) {
      return res.status(400).json({ success: false, message: 'মঞ্জুরির তারিখ ও বিতরণের তারিখ প্রদান করুন।' });
    }

    // Default dates for Other PBS if avoided/omitted
    const today = new Date().toISOString().split('T')[0];
    const finalSanctionDate = (sanction_date && sanction_date.trim()) ? sanction_date.trim() : (isOtherPbs ? today : '');
    const finalDisbursementDate = (disbursement_date && disbursement_date.trim()) ? disbursement_date.trim() : (isOtherPbs ? finalSanctionDate : '');
    const finalSanctionNo = sanction_no ? sanction_no.trim() : (isOtherPbs ? 'অন্য পবিস' : '');

    // Check unique loan_no
    const existingLoan = db.prepare('SELECT id FROM loans WHERE loan_no = ? AND is_deleted = 0').get(loan_no.trim());
    if (existingLoan) {
      return res.status(400).json({ success: false, message: 'এই ঋণ হিসাব নম্বর (Loan No) ইতিমধ্যে বিদ্যমান।' });
    }

    // Determine Interest Rate based on Rules:
    // Ongoing standard rate from 2020-01-01 -> 7% simple interest (prior to Jan 2020 was 8%)
    // Other PBS -> 0.0%
    let appliedRate = 0.0;
    if (!isOtherPbs) {
      appliedRate = 7.0;
      if (custom_interest_rate !== undefined && custom_interest_rate !== null && custom_interest_rate !== '') {
        appliedRate = parseFloat(custom_interest_rate);
      }
    }

    // Determine if Interest is Applicable
    // Rule: "অন্য পবিস থেকে গ্রহণকৃত লোনের উপর সুদ প্রভিশন প্রয়োজন নাই"
    const isInterestApplicable = isInterestProvisionApplicable(loan_source_type) ? 1 : 0;

    // Get Origin PBS Name
    let finalOriginPbsName = 'নিজস্ব পবিস';
    if (loan_source_type === 'OTHER_PBS') {
      if (origin_pbs_id) {
        const otherPbs = db.prepare('SELECT pbs_name FROM other_pbs WHERE id = ?').get(origin_pbs_id);
        if (otherPbs) finalOriginPbsName = otherPbs.pbs_name;
      } else if (origin_pbs_name) {
        finalOriginPbsName = origin_pbs_name.trim();
      }
    } else {
      const ownSettings = db.prepare('SELECT pbs_name FROM pbs_settings WHERE id = 1').get();
      if (ownSettings) finalOriginPbsName = ownSettings.pbs_name;
    }

    const principalBalance = parseFloat(disbursed_amount);
    const interestBalance = parseFloat(initial_interest_balance || 0);

    const stmt = db.prepare(`
      INSERT INTO loans (
        loan_no, employee_id, loan_lot_name, loan_source_type, origin_pbs_id, origin_pbs_name,
        sanction_no, sanction_date, disbursement_date, sanction_amount, disbursed_amount,
        monthly_installment, interest_rate, is_interest_applicable, principal_balance, interest_balance,
        total_principal_paid, total_interest_paid, status, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.0, 0.0, 'ACTIVE', ?)
    `);

    const result = stmt.run(
      loan_no.trim(),
      employee_id,
      loan_lot_name ? loan_lot_name.trim() : '১ম লট/বরাদ্দ',
      loan_source_type || 'OWN_PBS',
      loan_source_type === 'OTHER_PBS' ? (origin_pbs_id || null) : null,
      finalOriginPbsName,
      finalSanctionNo,
      finalSanctionDate,
      finalDisbursementDate,
      parseFloat(sanction_amount),
      principalBalance,
      parseFloat(monthly_installment),
      appliedRate,
      isInterestApplicable,
      principalBalance,
      interestBalance,
      remarks || ''
    );

    const newLoanId = result.lastInsertRowid;

    logAudit(req, 'CREATE', 'LOAN', newLoanId, `নতুন গৃহ ঋণ মঞ্জুর: ঋণ নং ${loan_no}, টাকা ${disbursed_amount}, সুদের হার ${appliedRate}% (${loan_source_type})`);

    res.json({
      success: true,
      message: 'গৃহ ঋণ সফলভাবে অন্তর্ভুক্ত করা হয়েছে।',
      id: newLoanId,
      interestRate: appliedRate,
      isInterestApplicable
    });
  } catch (error) {
    console.error('Create loan error:', error);
    res.status(500).json({ success: false, message: 'ঋণ সংযোজন ব্যর্থ হয়েছে।' });
  }
});

// Update Loan
router.put('/:id', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const loanId = req.params.id;
    const {
      employee_id,
      loan_no,
      loan_lot_name,
      loan_source_type,
      origin_pbs_id,
      origin_pbs_name,
      sanction_no,
      sanction_date,
      disbursement_date,
      sanction_amount,
      disbursed_amount,
      monthly_installment,
      custom_interest_rate,
      interest_rate,
      status,
      remarks
    } = req.body;

    const existing = db.prepare('SELECT * FROM loans WHERE id = ? AND is_deleted = 0').get(loanId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।' });
    }

    // Check unique loan_no if changed
    if (loan_no && loan_no.trim() !== existing.loan_no) {
      const dup = db.prepare('SELECT id FROM loans WHERE loan_no = ? AND id != ? AND is_deleted = 0').get(loan_no.trim(), loanId);
      if (dup) {
        return res.status(400).json({ success: false, message: 'এই ঋণ হিসাব নম্বর (Loan No) ইতিমধ্যে বিদ্যমান।' });
      }
    }

    // Determine Interest Rate & applicability based on disbursement_date / source
    const effectiveSourceType = loan_source_type || existing.loan_source_type;
    const isOtherPbs = (effectiveSourceType === 'OTHER_PBS');
    const today = new Date().toISOString().split('T')[0];

    const finalSanctionDate = (sanction_date && sanction_date.trim()) || existing.sanction_date || today;
    const finalDisbursementDate = (disbursement_date && disbursement_date.trim()) || existing.disbursement_date || finalSanctionDate || today;
    const finalSanctionNo = sanction_no !== undefined ? sanction_no.trim() : (existing.sanction_no || (isOtherPbs ? 'অন্য পবিস' : ''));

    let appliedRate = 0.0;
    if (!isOtherPbs) {
      if (custom_interest_rate !== undefined && custom_interest_rate !== null && custom_interest_rate !== '') {
        appliedRate = parseFloat(custom_interest_rate);
      } else if (interest_rate !== undefined && interest_rate !== null && interest_rate !== '') {
        appliedRate = parseFloat(interest_rate);
      } else {
        appliedRate = 7.0;
      }
    }
    const isInterestApplicable = isInterestProvisionApplicable(effectiveSourceType) ? 1 : 0;

    // Origin PBS name
    let finalOriginPbsName = existing.origin_pbs_name;
    if (effectiveSourceType === 'OTHER_PBS') {
      const pbsId = origin_pbs_id !== undefined ? origin_pbs_id : existing.origin_pbs_id;
      if (pbsId) {
        const otherPbs = db.prepare('SELECT pbs_name FROM other_pbs WHERE id = ?').get(pbsId);
        if (otherPbs) finalOriginPbsName = otherPbs.pbs_name;
      } else if (origin_pbs_name) {
        finalOriginPbsName = origin_pbs_name.trim();
      }
    } else {
      const ownSettings = db.prepare('SELECT pbs_name FROM pbs_settings WHERE id = 1').get();
      if (ownSettings) finalOriginPbsName = ownSettings.pbs_name;
    }

    // Disbursed amount & Principal balance adjustment
    const newDisbursed = disbursed_amount !== undefined ? parseFloat(disbursed_amount) : existing.disbursed_amount;
    const newSanction = sanction_amount !== undefined ? parseFloat(sanction_amount) : (newDisbursed || existing.sanction_amount);
    const newPrincipalBalance = Math.max(0, newDisbursed - (existing.total_principal_paid || 0));

    db.prepare(`
      UPDATE loans
      SET employee_id = ?,
          loan_no = ?,
          loan_lot_name = ?,
          loan_source_type = ?,
          origin_pbs_id = ?,
          origin_pbs_name = ?,
          sanction_no = ?,
          sanction_date = ?,
          disbursement_date = ?,
          sanction_amount = ?,
          disbursed_amount = ?,
          monthly_installment = ?,
          interest_rate = ?,
          is_interest_applicable = ?,
          principal_balance = ?,
          status = ?,
          remarks = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      employee_id !== undefined && employee_id !== '' ? parseInt(employee_id, 10) : existing.employee_id,
      loan_no ? loan_no.trim() : existing.loan_no,
      loan_lot_name !== undefined ? loan_lot_name.trim() : existing.loan_lot_name,
      effectiveSourceType,
      effectiveSourceType === 'OTHER_PBS' ? (origin_pbs_id || existing.origin_pbs_id) : null,
      finalOriginPbsName,
      finalSanctionNo,
      finalSanctionDate,
      finalDisbursementDate,
      newSanction,
      newDisbursed,
      monthly_installment !== undefined ? parseFloat(monthly_installment) : existing.monthly_installment,
      appliedRate,
      isInterestApplicable,
      newPrincipalBalance,
      status || existing.status,
      remarks !== undefined ? remarks : existing.remarks,
      loanId
    );

    logAudit(req, 'UPDATE', 'LOAN', loanId, `ঋণ তথ্য হালনাগাদ করা হয়েছে (ঋণ নং ${loan_no || existing.loan_no})`);
    res.json({ success: true, message: 'ঋণের তথ্য সফলভাবে হালনাগাদ করা হয়েছে।' });
  } catch (error) {
    console.error('Update loan error:', error);
    res.status(500).json({ success: false, message: 'ঋণ আপডেট ব্যর্থ হয়েছে: ' + error.message });
  }
});

// Soft Delete Loan (Move to Recycle Bin)
router.delete('/:id', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const loanId = req.params.id;
    const loan = db.prepare('SELECT * FROM loans WHERE id = ? AND is_deleted = 0').get(loanId);
    if (!loan) {
      return res.status(404).json({ success: false, message: 'ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।' });
    }

    const now = new Date().toISOString();
    const deletedBy = req.user.username;

    db.prepare(`
      UPDATE loans
      SET is_deleted = 1, deleted_at = ?, deleted_by = ?
      WHERE id = ?
    `).run(now, deletedBy, loanId);

    logAudit(req, 'DELETE', 'LOAN', loanId, `ঋণ ডিলিট (রিসাইকেল বিনে প্রেরণ): ${loan.loan_no}`);

    res.json({ success: true, message: 'ঋণ রেকর্ডটি সফলভাবে রিসাইকেল বিনে পাঠানো হয়েছে।' });
  } catch (error) {
    console.error('Delete loan error:', error);
    res.status(500).json({ success: false, message: 'ঋণ ডিলিট ব্যর্থ হয়েছে।' });
  }
});

module.exports = router;
