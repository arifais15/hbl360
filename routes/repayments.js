const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { distributeRepayment } = require('../services/loanCalculationService');
const { autoProvisionMonth } = require('../services/provisionService');

// List Repayments
router.get('/', authenticateToken, (req, res) => {
  try {
    const { loanId, employeeId, month, remittanceStatus, search } = req.query;

    let query = `
      SELECT r.*, l.loan_no, l.loan_lot_name, l.loan_source_type, l.origin_pbs_name,
             e.emp_code, e.name as emp_name, e.designation,
             b.advice_no, b.memo_no
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      JOIN employees e ON r.employee_id = e.id
      LEFT JOIN bank_advices b ON r.bank_advice_id = b.id
      WHERE r.is_deleted = 0 AND l.is_deleted = 0
    `;
    const params = [];

    // Role check: employee can only see their own
    if (req.user.role === 'employee') {
      query += ` AND r.employee_id = ?`;
      params.push(req.user.employeeId);
    } else if (employeeId) {
      query += ` AND r.employee_id = ?`;
      params.push(employeeId);
    }

    if (loanId) {
      query += ` AND r.loan_id = ?`;
      params.push(loanId);
    }

    if (month) {
      query += ` AND r.deduction_month = ?`;
      params.push(month);
    }

    if (remittanceStatus) {
      query += ` AND r.remittance_status = ?`;
      params.push(remittanceStatus);
    }

    if (search) {
      query += ` AND (l.loan_no LIKE ? OR e.emp_code LIKE ? OR e.name LIKE ? OR r.voucher_no LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY r.deduction_month DESC, r.id DESC`;

    const repayments = db.prepare(query).all(...params);

    const summary = {
      totalCount: repayments.length,
      totalAmount: repayments.reduce((s, r) => s + r.total_amount, 0),
      totalPrincipal: repayments.reduce((s, r) => s + r.principal_paid, 0),
      totalInterest: repayments.reduce((s, r) => s + r.interest_paid, 0)
    };

    res.json({ success: true, repayments, summary });
  } catch (error) {
    console.error('Fetch repayments error:', error);
    res.status(500).json({ success: false, message: 'কিস্তি কর্তনের তালিকা আনা যায়নি।' });
  }
});

// Single Repayment Post (Individual salary deduction)
router.post('/', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  const transaction = db.transaction(() => {
    const { loan_id, deduction_month, deduction_date, amount, voucher_no, principal_posting, interest_posting, remarks } = req.body;

    if (!loan_id || !deduction_month || !deduction_date || !amount || parseFloat(amount) <= 0) {
      throw new Error('সকল প্রয়োজনীয় তথ্য এবং সঠিক টাকার পরিমাণ প্রদান করুন।');
    }

    // Auto-provision interest for this deduction month if not yet provisioned (posted on month ending date)
    try {
      autoProvisionMonth(deduction_month);
    } catch (e) {
      console.warn('Auto provision before repayment error:', e.message);
    }

    const loan = db.prepare('SELECT * FROM loans WHERE id = ? AND is_deleted = 0').get(loan_id);
    if (!loan) {
      throw new Error('ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।');
    }
    if (loan.salary_deduction_suspended) {
      throw new Error('এই ঋণের বেতন হতে কিস্তি কর্তন স্থগিত রয়েছে।');
    }

    // Duplicate guard: check if active repayment already exists for this loan & month
    const existingRep = db.prepare(`
      SELECT id, deduction_date, total_amount, voucher_no
      FROM repayments
      WHERE loan_id = ? AND deduction_month = ? AND is_deleted = 0
    `).get(loan.id, deduction_month);

    if (existingRep) {
      throw new Error(`ডুপ্লিকেট প্রতিরোধ: এই ঋণের জন্য ${deduction_month} মাসের কিস্তি (টাকা: ${existingRep.total_amount}) ইতোমধ্যে কর্তন করা হয়েছে (তারিখ: ${existingRep.deduction_date})।`);
    }

    // Repayment Order Rule:
    // "আসল টাকা পরিশোধ হয়ে গেলে সুদের টাকা আদায় করা হয়।"
    const deductionAmount = parseFloat(amount);
    const distribution = distributeRepayment(deductionAmount, loan.principal_balance, loan.interest_balance);

    // Determine remittance status
    let remittanceStatus = 'NOT_APPLICABLE';
    if (loan.loan_source_type === 'OTHER_PBS') {
      remittanceStatus = 'PENDING'; // Must be sent to other PBS via Bank Advice
    }

    // Insert repayment record
    const insertRepayment = db.prepare(`
      INSERT INTO repayments (
        loan_id, employee_id, deduction_month, deduction_date, voucher_no,
        total_amount, principal_paid, interest_paid, advance_paid,
        previous_principal_balance, new_principal_balance,
        previous_interest_balance, new_interest_balance,
        repayment_method, remittance_status, principal_posting, interest_posting, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SALARY_DEDUCTION', ?, ?, ?, ?)
    `);

    const result = insertRepayment.run(
      loan.id,
      loan.employee_id,
      deduction_month,
      deduction_date,
      voucher_no || '',
      deductionAmount,
      distribution.principalPaid,
      distribution.interestPaid,
      distribution.unappliedAmount,
      loan.principal_balance,
      distribution.newPrincipalBalance,
      loan.interest_balance,
      distribution.newInterestBalance,
      remittanceStatus,
      principal_posting || null,
      interest_posting || null,
      remarks || ''
    );

    // Update loan balance & totals
    const isFullyPaid = (distribution.newPrincipalBalance <= 0 && distribution.newInterestBalance <= 0);
    const newStatus = isFullyPaid ? 'CLOSED' : 'ACTIVE';

    db.prepare(`
      UPDATE loans
      SET principal_balance = ?,
          interest_balance = ?,
          total_principal_paid = total_principal_paid + ?,
          total_interest_paid = total_interest_paid + ?,
          advance_balance = advance_balance + ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      distribution.newPrincipalBalance,
      distribution.newInterestBalance,
      distribution.principalPaid,
      distribution.interestPaid,
      distribution.unappliedAmount,
      newStatus,
      loan.id
    );

    return { repaymentId: result.lastInsertRowid, loan, distribution, remittanceStatus };
  });

  try {
    const data = transaction();
    logAudit(
      req,
      'CREATE',
      'REPAYMENT',
      data.repaymentId,
      `কিস্তি কর্তন: ঋণ নং ${data.loan.loan_no}, মাস: ${req.body.deduction_month}, মোট: ${req.body.amount} (আসল: ${data.distribution.principalPaid}, সুদ: ${data.distribution.interestPaid}, অগ্রিম: ${data.distribution.unappliedAmount})`
    );

    res.json({
      success: true,
      message: `বেতন থেকে কিস্তির অর্থ সফলভাবে কর্তন করা হয়েছে।${data.distribution.unappliedAmount > 0 ? ` ${data.distribution.unappliedAmount} টাকা অগ্রিম জমা হিসেবে রাখা হয়েছে।` : ''}`,
      id: data.repaymentId,
      distribution: data.distribution
    });
  } catch (err) {
    console.error('Repayment error:', err);
    res.status(400).json({ success: false, message: err.message || 'কিস্তি সংরক্ষণ ব্যর্থ হয়েছে।' });
  }
});

// Batch Monthly Salary Deduction (One-click payroll run for the whole month)
router.post('/batch', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  const { deduction_month, deduction_date, voucher_no, loan_ids, principal_posting, interest_posting } = req.body;

  if (!deduction_month || !deduction_date) {
    return res.status(400).json({ success: false, message: 'কর্তনের মাস এবং তারিখ নির্বাচন করুন।' });
  }

  // Automatically provision interest for this deduction month if not yet provisioned (posted on month ending date)
  try {
    autoProvisionMonth(deduction_month);
  } catch (e) {
    console.warn('Auto provision before batch repayment error:', e.message);
  }

  const batchTransaction = db.transaction(() => {
    // Select active loans that have not yet had a deduction for this month
    let query = `
      SELECT l.*, e.name as emp_name, e.emp_code
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.status = 'ACTIVE' AND l.is_deleted = 0 AND e.is_deleted = 0
        AND COALESCE(l.salary_deduction_suspended, 0) = 0
        AND l.id NOT IN (
          SELECT loan_id FROM repayments
          WHERE deduction_month = ? AND is_deleted = 0
        )
    `;
    const params = [deduction_month];

    if (loan_ids && Array.isArray(loan_ids) && loan_ids.length > 0) {
      query += ` AND l.id IN (${loan_ids.map(() => '?').join(',')})`;
      params.push(...loan_ids);
    }

    const eligibleLoans = db.prepare(query).all(...params);

    if (eligibleLoans.length === 0) {
      return { count: 0, message: 'নির্বাচিত মাসে কর্তন করার মতো কোনো সক্রিয় ঋণ অবশিষ্ট নেই।' };
    }

    let processedCount = 0;
    let totalDeducted = 0;
    let totalAdvancePaid = 0;

    const insertRepayment = db.prepare(`
      INSERT INTO repayments (
        loan_id, employee_id, deduction_month, deduction_date, voucher_no,
        total_amount, principal_paid, interest_paid, advance_paid,
        previous_principal_balance, new_principal_balance,
        previous_interest_balance, new_interest_balance,
        repayment_method, remittance_status, principal_posting, interest_posting, remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SALARY_DEDUCTION', ?, ?, ?, ?)
    `);

    const updateLoan = db.prepare(`
      UPDATE loans
      SET principal_balance = ?,
          interest_balance = ?,
          total_principal_paid = total_principal_paid + ?,
          total_interest_paid = total_interest_paid + ?,
          advance_balance = advance_balance + ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    for (const loan of eligibleLoans) {
      const deductionAmount = loan.monthly_installment;
      const distribution = distributeRepayment(deductionAmount, loan.principal_balance, loan.interest_balance);
      const remittanceStatus = (loan.loan_source_type === 'OTHER_PBS') ? 'PENDING' : 'NOT_APPLICABLE';

      insertRepayment.run(
        loan.id,
        loan.employee_id,
        deduction_month,
        deduction_date,
        voucher_no || `SALARY-${deduction_month}`,
        deductionAmount,
        distribution.principalPaid,
        distribution.interestPaid,
        distribution.unappliedAmount,
        loan.principal_balance,
        distribution.newPrincipalBalance,
        loan.interest_balance,
        distribution.newInterestBalance,
        remittanceStatus,
        principal_posting || null,
        interest_posting || null,
        `${deduction_month} মাসের বেতন হতে মাসিক কিস্তি কর্তন`
      );

      const isFullyPaid = (distribution.newPrincipalBalance <= 0 && distribution.newInterestBalance <= 0);
      const newStatus = isFullyPaid ? 'CLOSED' : 'ACTIVE';

      updateLoan.run(
        distribution.newPrincipalBalance,
        distribution.newInterestBalance,
        distribution.principalPaid,
        distribution.interestPaid,
        distribution.unappliedAmount,
        newStatus,
        loan.id
      );

      processedCount++;
      totalDeducted += deductionAmount;
      totalAdvancePaid += distribution.unappliedAmount;
    }

    return { count: processedCount, totalDeducted, totalAdvancePaid };
  });

  try {
    const result = batchTransaction();
    logAudit(req, 'BATCH_DEDUCT', 'REPAYMENT', null, `মাসিক বেতন থেকে ব্যাচ কিস্তি কর্তন: মাস ${deduction_month}, মোট ${result.count} টি ঋণ, সর্বমোট ${result.totalDeducted} টাকা`);
    res.json({
      success: true,
      message: `${result.count} টি ঋণের কিস্তি সফলভাবে কর্তন করা হয়েছে (সর্বমোট: ${result.totalDeducted} টাকা)।${result.totalAdvancePaid > 0 ? ` ${result.totalAdvancePaid} টাকা অগ্রিম জমা হিসেবে সংরক্ষিত হয়েছে।` : ''}`,
      count: result.count,
      totalDeducted: result.totalDeducted,
      totalAdvancePaid: result.totalAdvancePaid
    });
  } catch (err) {
    console.error('Batch repayment error:', err);
    res.status(500).json({ success: false, message: 'ব্যাচ কিস্তি প্রক্রিয়াকরণ ব্যর্থ হয়েছে।' });
  }
});

// Batch Soft Delete Repayments (Moves to Recycle Bin and Restores Loan Balances)
router.post('/batch-delete', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, message: 'মুছে ফেলার জন্য অন্তত একটি কিস্তি নির্বাচন করুন।' });
  }

  const transaction = db.transaction(() => {
    const now = new Date().toISOString();
    const deletedBy = req.user.username;
    let deletedCount = 0;
    let totalRestoredAmount = 0;

    const getRepStmt = db.prepare('SELECT * FROM repayments WHERE id = ? AND is_deleted = 0');
    const getLoanStmt = db.prepare('SELECT * FROM loans WHERE id = ?');
    const updateRepStmt = db.prepare(`
      UPDATE repayments
      SET is_deleted = 1, deleted_at = ?, deleted_by = ?
      WHERE id = ?
    `);
    const updateLoanStmt = db.prepare(`
      UPDATE loans
      SET principal_balance = ?,
          interest_balance = ?,
          total_principal_paid = ?,
          total_interest_paid = ?,
          advance_balance = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    for (const repId of ids) {
      const repayment = getRepStmt.get(repId);
      if (!repayment) continue;

      const loan = getLoanStmt.get(repayment.loan_id);
      if (!loan) continue;

      // Soft delete repayment
      updateRepStmt.run(now, deletedBy, repId);

      // Accurately reverse repayment effects on loan balance
      const restoredPrincipal = loan.principal_balance + repayment.principal_paid;
      const restoredInterest = loan.interest_balance + repayment.interest_paid;
      const restoredTotalPrincipalPaid = Math.max(0, loan.total_principal_paid - repayment.principal_paid);
      const restoredTotalInterestPaid = Math.max(0, loan.total_interest_paid - repayment.interest_paid);
      const restoredAdvanceBalance = Math.max(0, (loan.advance_balance || 0) - (repayment.advance_paid || 0));

      updateLoanStmt.run(
        restoredPrincipal,
        restoredInterest,
        restoredTotalPrincipalPaid,
        restoredTotalInterestPaid,
        restoredAdvanceBalance,
        restoredPrincipal <= 0 && restoredInterest <= 0 ? 'CLOSED' : 'ACTIVE',
        loan.id
      );

      deletedCount++;
      totalRestoredAmount += repayment.total_amount;
    }

    if (deletedCount === 0) {
      throw new Error('কোনো বৈধ কিস্তি রেকর্ড মুছে ফেলার জন্য পাওয়া যায়নি।');
    }

    return { deletedCount, totalRestoredAmount };
  });

  try {
    const result = transaction();
    logAudit(
      req,
      'BATCH_DELETE',
      'REPAYMENTS',
      null,
      `ব্যাচ কিস্তি কর্তন বাতিল: ${result.deletedCount} টি কিস্তি, সর্বমোট টাকা ${result.totalRestoredAmount} ব্যালেন্স পুনঃস্থাপিত`
    );
    res.json({
      success: true,
      message: `নির্বাচিত ${result.deletedCount} টি কিস্তি সফলভাবে বাতিল এবং ঋণ ব্যালেন্স পূর্বাবস্থায় ফিরিয়ে আনা হয়েছে।`,
      deletedCount: result.deletedCount,
      totalRestoredAmount: result.totalRestoredAmount
    });
  } catch (err) {
    console.error('Batch delete repayments error:', err);
    res.status(400).json({ success: false, message: err.message || 'ব্যাচ কিস্তি ডিলিট ব্যর্থ হয়েছে।' });
  }
});

// Soft Delete Repayment (Moves to Recycle Bin and Restores Loan Balance)
router.delete('/:id', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  const transaction = db.transaction(() => {
    const repId = req.params.id;
    const repayment = db.prepare('SELECT * FROM repayments WHERE id = ? AND is_deleted = 0').get(repId);
    if (!repayment) {
      throw new Error('কিস্তি রেকর্ড খুঁজে পাওয়া যায়নি।');
    }

    const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(repayment.loan_id);
    if (!loan) {
      throw new Error('সংশ্লিষ্ট ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।');
    }

    const now = new Date().toISOString();
    const deletedBy = req.user.username;

    // Mark repayment deleted
    db.prepare(`
      UPDATE repayments
      SET is_deleted = 1, deleted_at = ?, deleted_by = ?
      WHERE id = ?
    `).run(now, deletedBy, repId);

    // Accurately reverse repayment effects on loan balance
    const restoredPrincipal = loan.principal_balance + repayment.principal_paid;
    const restoredInterest = loan.interest_balance + repayment.interest_paid;
    const restoredTotalPrincipalPaid = Math.max(0, loan.total_principal_paid - repayment.principal_paid);
    const restoredTotalInterestPaid = Math.max(0, loan.total_interest_paid - repayment.interest_paid);
    const restoredAdvanceBalance = Math.max(0, (loan.advance_balance || 0) - (repayment.advance_paid || 0));

    db.prepare(`
      UPDATE loans
      SET principal_balance = ?,
          interest_balance = ?,
          total_principal_paid = ?,
          total_interest_paid = ?,
          advance_balance = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      restoredPrincipal,
      restoredInterest,
      restoredTotalPrincipalPaid,
      restoredTotalInterestPaid,
      restoredAdvanceBalance,
      restoredPrincipal <= 0 && restoredInterest <= 0 ? 'CLOSED' : 'ACTIVE',
      loan.id
    );

    return { repayment, loan };
  });

  try {
    const { repayment, loan } = transaction();
    logAudit(req, 'DELETE', 'REPAYMENT', repayment.id, `কিস্তি কর্তন ডিলিট (ব্যালেন্স পুনঃস্থাপন): ঋণ নং ${loan.loan_no}, টাকা ${repayment.total_amount}`);
    res.json({ success: true, message: 'কিস্তি কর্তন সফলভাবে বাতিল এবং ঋণ ব্যালেন্স পূর্বাবস্থায় ফিরিয়ে আনা হয়েছে।' });
  } catch (err) {
    console.error('Delete repayment error:', err);
    res.status(400).json({ success: false, message: err.message || 'কিস্তি ডিলিট ব্যর্থ হয়েছে।' });
  }
});

module.exports = router;
