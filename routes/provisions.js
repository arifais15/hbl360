const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const { calculateMonthlyInterestProvision, getApplicableInterestRate, getMonthEndDate } = require('../services/loanCalculationService');
const { autoProvisionMonth, autoSyncAllPendingProvisions, getPreviousMonthEndingPrincipalBalance } = require('../services/provisionService');

// Auto Sync all pending provisions (All eligible loans, pre-2020 8%, post-2020 7%)
router.post('/auto-sync', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const result = autoSyncAllPendingProvisions();
    res.json({
      success: true,
      message: result.totalProcessed > 0
        ? `সর্বমোট ${result.totalProcessed} টি ঋণে ${result.totalInterestAdded} টাকা সুদ অটো প্রভিশন সম্পন্ন ও সুদ কলামে যোগ করা হয়েছে।`
        : 'সকল ঋণের সুদ পূর্ব থেকেই স্বয়ংক্রিয়ভাবে প্রভিশন করা রয়েছে।',
      result
    });
  } catch (err) {
    console.error('Auto sync provisions error:', err);
    res.status(500).json({ success: false, message: 'অটো প্রভিশন সিঙ্ক ব্যর্থ হয়েছে।' });
  }
});

// List Interest Provisions
router.get('/', authenticateToken, (req, res) => {
  try {
    // Automatically provision current month for active loans if missing
    try {
      autoProvisionMonth();
    } catch (e) {
      console.warn('Auto-provision current month error:', e.message);
    }

    const { loanId, month, year } = req.query;

    let query = `
      SELECT p.*, l.loan_no, l.loan_lot_name, l.disbursement_date,
             e.emp_code, e.name as emp_name, e.designation
      FROM interest_provisions p
      JOIN loans l ON p.loan_id = l.id
      JOIN employees e ON p.employee_id = e.id
      WHERE p.is_deleted = 0 AND l.is_deleted = 0
    `;
    const params = [];

    // Role check: employee can only see their own
    if (req.user.role === 'employee') {
      query += ` AND p.employee_id = ?`;
      params.push(req.user.employeeId);
    }

    if (loanId) {
      query += ` AND p.loan_id = ?`;
      params.push(loanId);
    }

    if (month) {
      query += ` AND p.provision_month = ?`;
      params.push(month);
    }

    if (year) {
      query += ` AND p.provision_month LIKE ?`;
      params.push(`${year}-%`);
    }

    query += ` ORDER BY p.provision_month DESC, p.id DESC`;

    const provisions = db.prepare(query).all(...params);

    const summary = {
      totalCount: provisions.length,
      totalInterestAmount: provisions.reduce((s, p) => s + p.interest_amount, 0)
    };

    res.json({ success: true, provisions, summary });
  } catch (error) {
    console.error('Fetch provisions error:', error);
    res.status(500).json({ success: false, message: 'সুদ প্রভিশনের তালিকা আনা যায়নি।' });
  }
});

// Preview Monthly Interest Provision before running
router.get('/preview', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const { month } = req.query;
    if (!month) {
      return res.status(400).json({ success: false, message: 'প্রভিশনের মাস প্রদান করুন।' });
    }

    // Rules:
    // 1. Only OWN_PBS loans (অন্য পবিস থেকে গ্রহণকৃত লোনের উপর সুদ প্রভিশন প্রয়োজন নাই)
    // 2. Only loans with principal_balance > 0
    // 3. Status = 'ACTIVE'
    // 4. Not yet provisioned for this month
    const eligibleLoans = db.prepare(`
      SELECT l.*, e.emp_code, e.name as emp_name, e.designation
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.loan_source_type = 'OWN_PBS'
        AND l.is_interest_applicable = 1
        AND l.status = 'ACTIVE'
        AND l.principal_balance > 0
        AND l.is_deleted = 0
        AND e.is_deleted = 0
        AND l.id NOT IN (
          SELECT loan_id FROM interest_provisions
          WHERE provision_month = ? AND is_deleted = 0
        )
      ORDER BY l.id ASC
    `).all(month);

    const applicableRate = getApplicableInterestRate(month);
    const previewList = eligibleLoans.map(loan => {
      let rate = applicableRate;
      if (loan.custom_interest_rate !== null && loan.custom_interest_rate !== undefined && loan.custom_interest_rate !== '') {
        rate = parseFloat(loan.custom_interest_rate);
      }
      const principalOnDate = getPreviousMonthEndingPrincipalBalance(loan, month);
      const calculatedInterest = calculateMonthlyInterestProvision(principalOnDate, rate);
      return {
        loan_id: loan.id,
        loan_no: loan.loan_no,
        employee_id: loan.employee_id,
        emp_code: loan.emp_code,
        emp_name: loan.emp_name,
        designation: loan.designation,
        disbursement_date: loan.disbursement_date,
        interest_rate: rate,
        rate_rule: month < '2020-01' ? '২০১৯ ডিসে পর্যন্ত (৮% সরল সুদ)' : '২০২০ জানু থেকে (৭% সরল সুদ)',
        current_principal: principalOnDate,
        calculated_monthly_interest: calculatedInterest,
        current_interest_balance: loan.interest_balance,
        new_interest_balance: loan.interest_balance + calculatedInterest
      };
    });

    const totalCalculatedInterest = previewList.reduce((acc, curr) => acc + curr.calculated_monthly_interest, 0);

    res.json({
      success: true,
      month,
      eligibleCount: previewList.length,
      totalCalculatedInterest,
      previewList
    });
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ success: false, message: 'প্রভিশন প্রিভিউ লোড করা যায়নি।' });
  }
});

// Execute Monthly Interest Provision (Batch Run)
router.post('/run-monthly', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  const { provision_month, provision_date } = req.body;

  if (!provision_month || !provision_date) {
    return res.status(400).json({ success: false, message: 'প্রভিশনের মাস এবং তারিখ প্রদান করুন।' });
  }

  const effectiveProvisionDate = provision_date || getMonthEndDate(provision_month);

  const transaction = db.transaction(() => {
    // Select eligible OWN_PBS loans
    const eligibleLoans = db.prepare(`
      SELECT l.*, e.name as emp_name, e.emp_code
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.loan_source_type = 'OWN_PBS'
        AND l.is_interest_applicable = 1
        AND l.status = 'ACTIVE'
        AND l.principal_balance > 0
        AND l.is_deleted = 0
        AND e.is_deleted = 0
        AND l.id NOT IN (
          SELECT loan_id FROM interest_provisions
          WHERE provision_month = ?
        )
    `).all(provision_month);

    if (eligibleLoans.length === 0) {
      return { count: 0, totalInterest: 0, message: 'এই মাসের জন্য সকল প্রযোজ্য ঋণের সুদ ইতিমধ্যে প্রভিশন করা হয়েছে অথবা কোনো যোগ্য ঋণ নেই।' };
    }

    const insertProvision = db.prepare(`
      INSERT INTO interest_provisions (
        loan_id, employee_id, provision_month, provision_date, applied_rate,
        principal_amount_on_date, interest_amount, previous_interest_balance, new_interest_balance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateLoanInterest = db.prepare(`
      UPDATE loans
      SET interest_balance = interest_balance + ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    let processedCount = 0;
    let totalInterest = 0;

    const applicableRate = getApplicableInterestRate(provision_month);
    for (const loan of eligibleLoans) {
      let rate = applicableRate;
      if (loan.custom_interest_rate !== null && loan.custom_interest_rate !== undefined && loan.custom_interest_rate !== '') {
        rate = parseFloat(loan.custom_interest_rate);
      }
      const principalOnDate = getPreviousMonthEndingPrincipalBalance(loan, provision_month);
      const interestAmt = calculateMonthlyInterestProvision(principalOnDate, rate);

      if (interestAmt > 0) {
        insertProvision.run(
          loan.id,
          loan.employee_id,
          provision_month,
          effectiveProvisionDate,
          rate,
          principalOnDate,
          interestAmt,
          loan.interest_balance,
          loan.interest_balance + interestAmt
        );

        updateLoanInterest.run(interestAmt, loan.id);

        processedCount++;
        totalInterest += interestAmt;
      }
    }

    return { count: processedCount, totalInterest };
  });

  try {
    const result = transaction();
    if (result.count === 0 && result.message) {
      return res.json({ success: true, message: result.message, count: 0, totalInterest: 0 });
    }

    logAudit(
      req,
      'PROVISION',
      'INTEREST_PROVISION',
      null,
      `মাসিক সুদ প্রভিশন সম্পন্ন: মাস ${provision_month}, মোট ঋণ ${result.count} টি, মোট সুদ ${result.totalInterest} টাকা`
    );

    res.json({
      success: true,
      message: `${provision_month} মাসের জন্য ${result.count} টি ঋণে সর্বমোট ${result.totalInterest} টাকা সুদ প্রভিশন করা হয়েছে।`,
      count: result.count,
      totalInterest: result.totalInterest
    });
  } catch (err) {
    console.error('Interest provision execution error:', err);
    res.status(500).json({ success: false, message: 'সুদ প্রভিশন প্রক্রিয়াকরণ ব্যর্থ হয়েছে।' });
  }
});

// Soft Delete Provision (Reverts loan interest balance)
router.delete('/:id', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  const transaction = db.transaction(() => {
    const provId = req.params.id;
    const provision = db.prepare('SELECT * FROM interest_provisions WHERE id = ? AND is_deleted = 0').get(provId);
    if (!provision) {
      throw new Error('প্রভিশন রেকর্ড খুঁজে পাওয়া যায়নি।');
    }

    const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(provision.loan_id);
    if (!loan) {
      throw new Error('সংশ্লিষ্ট ঋণ রেকর্ড খুঁজে পাওয়া যায়নি।');
    }

    const now = new Date().toISOString();
    const deletedBy = req.user.username;

    // Mark deleted
    db.prepare(`
      UPDATE interest_provisions
      SET is_deleted = 1, deleted_at = ?, deleted_by = ?
      WHERE id = ?
    `).run(now, deletedBy, provId);

    // Revert loan interest balance
    const revertedInterestBalance = Math.max(0, loan.interest_balance - provision.interest_amount);
    db.prepare(`
      UPDATE loans
      SET interest_balance = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(revertedInterestBalance, loan.id);

    return { provision, loan };
  });

  try {
    const { provision, loan } = transaction();
    logAudit(req, 'DELETE', 'INTEREST_PROVISION', provision.id, `সুদ প্রভিশন বাতিল: ঋণ নং ${loan.loan_no}, মাস: ${provision.provision_month}, টাকা: ${provision.interest_amount}`);
    res.json({ success: true, message: 'সুদ প্রভিশন সফলভাবে বাতিল এবং ঋণ ব্যালেন্স সমন্বয় করা হয়েছে।' });
  } catch (err) {
    console.error('Delete provision error:', err);
    res.status(400).json({ success: false, message: err.message || 'সুদ প্রভিশন বাতিল করা যায়নি।' });
  }
});

module.exports = router;
