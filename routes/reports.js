const express = require('express');
const router = express.Router();
const db = require('../database/db');
const xlsx = require('xlsx');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { getFiscalYearComparativeStatement, getAvailableFiscalYears } = require('../services/fiscalYearService');

function getControlLedgerRepaymentEvents(fromDate, toDate, employeeId, balanceType = 'principal') {
  let query = `
    SELECT r.deduction_date, MIN(r.deduction_month) AS deduction_month,
           MIN(r.voucher_no) AS voucher_no, COUNT(DISTINCT r.voucher_no) AS voucher_count,
           r.repayment_method,
           SUM(r.principal_paid) AS principal_paid,
           SUM(r.total_amount) AS total_paid
    FROM repayments r
    JOIN loans l ON r.loan_id = l.id
    WHERE l.loan_source_type = 'OWN_PBS' AND r.is_deleted = 0
      AND r.deduction_date >= ? AND r.deduction_date <= ?
  `;
  const params = [fromDate, toDate];

  if (employeeId) {
    query += ' AND r.employee_id = ?';
    params.push(employeeId);
  }

  query += `
    GROUP BY r.deduction_date, r.repayment_method,
      CASE
        WHEN r.repayment_method = 'INTER_PBS_COLLECTION'
          THEN COALESCE(r.collection_batch_id, 'LEGACY:' || r.deduction_date)
        ELSE COALESCE(r.deduction_month, '') || ':' || COALESCE(r.voucher_no, '')
      END
    ORDER BY r.deduction_date ASC
  `;

  return db.prepare(query).all(...params).map(row => {
    let particulars = row.voucher_no || '';
    if (row.repayment_method === 'INTER_PBS_COLLECTION') {
      if (row.voucher_count !== 1 || !particulars) {
        particulars = `CRJ-${row.deduction_date.slice(5).replace('-', '/')}`;
      }
    } else if (!particulars || particulars.startsWith('SALARY-')) {
      const month = row.deduction_month || row.deduction_date.slice(0, 7);
      particulars = `PJ-${month.slice(5)}/${month.slice(2, 4)}`;
    } else if (row.repayment_method === 'BANK_DEPOSIT' || row.repayment_method === 'CASH') {
      particulars = `CRJ-${row.deduction_date.slice(5).replace('-', '/')}`;
    }

    return {
      date: row.deduction_date,
      dateFormatted: formatGlDate(row.deduction_date),
      particulars,
      debit: 0,
      credit: balanceType === 'total' ? row.total_paid : row.principal_paid,
      type: 'REPAYMENT'
    };
  });
}

// 1. Own PBS Loans Ledger (নিজস্ব পিবিএসের ঋণের খতিয়ান)
router.get('/own-pbs-ledger', authenticateToken, (req, res) => {
  try {
    const { loanId, fromDate, toDate } = req.query;

    let query = `
      SELECT l.id as loan_id, l.loan_no, l.loan_lot_name, l.disbursement_date,
             l.disbursed_amount, l.interest_rate, l.principal_balance, l.interest_balance,
             l.total_principal_paid, l.total_interest_paid, l.status,
             e.emp_code, e.name as emp_name, e.designation, e.department
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.loan_source_type = 'OWN_PBS'
        AND l.is_deleted = 0
        AND e.is_deleted = 0
    `;
    const params = [];

    // Role check: employee can only see their own
    if (req.user.role === 'employee') {
      query += ` AND l.employee_id = ?`;
      params.push(req.user.employeeId);
    }

    if (loanId) {
      query += ` AND l.id = ?`;
      params.push(loanId);
    }

    query += ` ORDER BY l.disbursement_date ASC, l.id ASC`;

    const loans = db.prepare(query).all(...params);

    // If single loan requested, generate complete chronological transaction ledger
    if (loanId && loans.length > 0) {
      const selectedLoan = loans[0];

      // Get all disbursements, repayments, and provisions
      const ledgerEntries = [];

      // Opening Disbursement Entry (Debit)
      ledgerEntries.push({
        date: selectedLoan.disbursement_date,
        type: 'DISBURSEMENT',
        description: `ঋণ বিতরণ (আসল) - ${selectedLoan.loan_lot_name}`,
        voucher: selectedLoan.loan_no,
        debitPrincipal: selectedLoan.disbursed_amount,
        creditPrincipal: 0,
        debitInterest: 0,
        creditInterest: 0
      });

      // Provisions (Debit Interest)
      const provisions = db.prepare(`
        SELECT provision_date, provision_month, interest_amount, applied_rate
        FROM interest_provisions
        WHERE loan_id = ? AND is_deleted = 0
        ORDER BY provision_date ASC
      `).all(loanId);

      for (const p of provisions) {
        ledgerEntries.push({
          date: p.provision_date,
          type: 'INTEREST_PROVISION',
          description: `${p.provision_month} মাসের সরল সুদ প্রভিশন (${p.applied_rate}%)`,
          voucher: `PROV-${p.provision_month}`,
          debitPrincipal: 0,
          creditPrincipal: 0,
          debitInterest: p.interest_amount,
          creditInterest: 0
        });
      }

      // Repayments (Credit Principal & Credit Interest)
      const repayments = db.prepare(`
        SELECT deduction_date, deduction_month, voucher_no, total_amount, principal_paid, interest_paid
        FROM repayments
        WHERE loan_id = ? AND is_deleted = 0
        ORDER BY deduction_date ASC
      `).all(loanId);

      for (const r of repayments) {
        ledgerEntries.push({
          date: r.deduction_date,
          type: 'REPAYMENT',
          description: `${r.deduction_month} মাসের বেতন হতে কিস্তি আদায়`,
          voucher: r.voucher_no || `SALARY-${r.deduction_month}`,
          debitPrincipal: 0,
          creditPrincipal: r.principal_paid,
          debitInterest: 0,
          creditInterest: r.interest_paid
        });
      }

      // Calculate prior historical payments and accrued interest
      const recordedPrincipalPaid = repayments.reduce((s, r) => s + (r.principal_paid || 0), 0);
      const recordedInterestPaid = repayments.reduce((s, r) => s + (r.interest_paid || 0), 0);
      const recordedInterestProvisioned = provisions.reduce((s, p) => s + (p.interest_amount || 0), 0);

      const priorPrincipalPaid = Math.max(0, (selectedLoan.total_principal_paid || 0) - recordedPrincipalPaid);
      const priorInterestAccrued = Math.max(0, (selectedLoan.interest_balance || 0) - (recordedInterestProvisioned - recordedInterestPaid));

      if (priorPrincipalPaid > 0) {
        ledgerEntries.push({
          date: selectedLoan.disbursement_date,
          type: 'PRIOR_PRINCIPAL_PAID',
          description: 'সফ্টওয়্যার অন্তর্ভুক্তির পূর্ববর্তী পুঞ্জীভূত আসল কিস্তি পরিশোধ',
          voucher: 'OPENING-PRIN',
          debitPrincipal: 0,
          creditPrincipal: priorPrincipalPaid,
          debitInterest: 0,
          creditInterest: 0
        });
      }

      if (priorInterestAccrued > 0) {
        ledgerEntries.push({
          date: selectedLoan.disbursement_date,
          type: 'PRIOR_INTEREST_ACCRUED',
          description: 'সফ্টওয়্যার অন্তর্ভুক্তির পূর্ববর্তী পুঞ্জীভূত ধার্যকৃত সুদ স্থিতি',
          voucher: 'OPENING-INT',
          debitPrincipal: 0,
          creditPrincipal: 0,
          debitInterest: priorInterestAccrued,
          creditInterest: 0
        });
      }

      // Sort chronologically
      ledgerEntries.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const order = { DISBURSEMENT: 1, PRIOR_PRINCIPAL_PAID: 2, PRIOR_INTEREST_ACCRUED: 3, INTEREST_PROVISION: 4, REPAYMENT: 5 };
        return (order[a.type] || 0) - (order[b.type] || 0);
      });

      // Compute running balances
      let runPrincipal = 0;
      let runInterest = 0;
      for (const entry of ledgerEntries) {
        runPrincipal += entry.debitPrincipal - entry.creditPrincipal;
        runInterest += entry.debitInterest - entry.creditInterest;
        entry.principalBalance = runPrincipal;
        entry.interestBalance = runInterest;
        entry.netBalance = runPrincipal + runInterest;
      }

      return res.json({
        success: true,
        loan: selectedLoan,
        ledgerEntries
      });
    }

    res.json({ success: true, loans });
  } catch (error) {
    console.error('Own PBS ledger error:', error);
    res.status(500).json({ success: false, message: 'নিজস্ব পবিস লেজার লোড করা যায়নি।' });
  }
});

// 1b. Employee-wise Loan Ledger with loan-wise subtotals + PBS-wise subtotals
router.get('/employee-loan-ledger', authenticateToken, (req, res) => {
  try {
    const { employeeId } = req.query;

    // Role check: employees can only view their own
    let targetEmployeeId = employeeId;
    if (req.user.role === 'employee') {
      targetEmployeeId = req.user.employeeId;
      if (!targetEmployeeId) {
        const matched = db.prepare('SELECT id FROM employees WHERE emp_code = ? OR id = ?').get(req.user.username, req.user.id);
        if (matched) targetEmployeeId = matched.id;
      }
    }

    // Get all employees who have loans with summary stats
    let empQuery = `
      SELECT e.id, e.emp_code, e.name, e.designation, e.department,
             COUNT(l.id) as loan_count,
             SUM(CASE WHEN l.loan_source_type = 'OWN_PBS' THEN 1 ELSE 0 END) as own_loan_count,
             SUM(CASE WHEN l.loan_source_type = 'OTHER_PBS' THEN 1 ELSE 0 END) as other_loan_count,
             SUM(l.disbursed_amount) as total_disbursed,
             SUM(l.total_principal_paid) as total_principal_paid,
             SUM(l.principal_balance) as principal_balance,
             SUM(l.interest_balance) as interest_balance,
             SUM(l.principal_balance + l.interest_balance) as net_balance
      FROM employees e
      JOIN loans l ON l.employee_id = e.id
      WHERE e.is_deleted = 0 AND l.is_deleted = 0
      GROUP BY e.id
      ORDER BY e.emp_code ASC
    `;
    const allEmployees = db.prepare(empQuery).all();

    if (!targetEmployeeId) {
      return res.json({ success: true, employees: allEmployees, ledger: null });
    }

    // Get selected employee info
    const employee = db.prepare(`SELECT * FROM employees WHERE id = ? AND is_deleted = 0`).get(targetEmployeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'কর্মচারী পাওয়া যায়নি।' });
    }

    // Get all loans for this employee (both own + other PBS)
    const loans = db.prepare(`
      SELECT l.*, op.pbs_name as origin_pbs_display
      FROM loans l
      LEFT JOIN other_pbs op ON l.origin_pbs_id = op.id
      WHERE l.employee_id = ? AND l.is_deleted = 0
      ORDER BY l.loan_source_type ASC, l.disbursement_date ASC, l.id ASC
    `).all(targetEmployeeId);

    if (loans.length === 0) {
      return res.json({ success: true, employees: allEmployees, employee, loans: [], ledger: null });
    }

    // Build ledger entries per loan
    const loanLedgers = [];

    for (const loan of loans) {
      const entries = [];

      // Opening disbursement
      entries.push({
        date: loan.disbursement_date,
        type: 'DISBURSEMENT',
        description: `ঋণ বিতরণ (আসল) - ${loan.loan_lot_name}`,
        voucher: loan.loan_no,
        debitPrincipal: loan.disbursed_amount,
        creditPrincipal: 0,
        debitInterest: 0,
        creditInterest: 0
      });

      // Interest provisions (only for OWN_PBS)
      if (loan.loan_source_type === 'OWN_PBS') {
        const provisions = db.prepare(`
          SELECT provision_date, provision_month, interest_amount, applied_rate
          FROM interest_provisions WHERE loan_id = ? AND is_deleted = 0
          ORDER BY provision_date ASC
        `).all(loan.id);

        for (const p of provisions) {
          entries.push({
            date: p.provision_date,
            type: 'INTEREST_PROVISION',
            description: `${p.provision_month} মাসের সরল সুদ প্রভিশন (${p.applied_rate}%)`,
            voucher: `PROV-${p.provision_month}`,
            debitPrincipal: 0,
            creditPrincipal: 0,
            debitInterest: p.interest_amount,
            creditInterest: 0
          });
        }
      }

      // Repayments
      const repayments = db.prepare(`
        SELECT deduction_date, deduction_month, voucher_no, total_amount, principal_paid, interest_paid
        FROM repayments WHERE loan_id = ? AND is_deleted = 0
        ORDER BY deduction_date ASC
      `).all(loan.id);

      for (const r of repayments) {
        entries.push({
          date: r.deduction_date,
          type: 'REPAYMENT',
          description: `${r.deduction_month} মাসের বেতন হতে কিস্তি আদায়`,
          voucher: r.voucher_no || `SALARY-${r.deduction_month}`,
          debitPrincipal: 0,
          creditPrincipal: r.principal_paid,
          debitInterest: 0,
          creditInterest: r.interest_paid
        });
      }

      // Calculate prior historical payments and accrued interest
      const recordedPrincipalPaid = repayments.reduce((s, r) => s + (r.principal_paid || 0), 0);
      const recordedInterestPaid = repayments.reduce((s, r) => s + (r.interest_paid || 0), 0);
      const provisionsList = loan.loan_source_type === 'OWN_PBS'
        ? db.prepare(`SELECT interest_amount FROM interest_provisions WHERE loan_id = ? AND is_deleted = 0`).all(loan.id)
        : [];
      const recordedInterestProvisioned = provisionsList.reduce((s, p) => s + (p.interest_amount || 0), 0);

      const priorPrincipalPaid = Math.max(0, (loan.total_principal_paid || 0) - recordedPrincipalPaid);
      const priorInterestAccrued = Math.max(0, (loan.interest_balance || 0) - (recordedInterestProvisioned - recordedInterestPaid));

      if (priorPrincipalPaid > 0) {
        entries.push({
          date: loan.disbursement_date,
          type: 'PRIOR_PRINCIPAL_PAID',
          description: 'সফ্টওয়্যার অন্তর্ভুক্তির পূর্ববর্তী পুঞ্জীভূত আসল কিস্তি পরিশোধ',
          voucher: 'OPENING-PRIN',
          debitPrincipal: 0,
          creditPrincipal: priorPrincipalPaid,
          debitInterest: 0,
          creditInterest: 0
        });
      }

      if (priorInterestAccrued > 0) {
        entries.push({
          date: loan.disbursement_date,
          type: 'PRIOR_INTEREST_ACCRUED',
          description: 'সফ্টওয়্যার অন্তর্ভুক্তির পূর্ববর্তী পুঞ্জীভূত ধার্যকৃত সুদ স্থিতি',
          voucher: 'OPENING-INT',
          debitPrincipal: 0,
          creditPrincipal: 0,
          debitInterest: priorInterestAccrued,
          creditInterest: 0
        });
      }

      // Sort chronologically
      entries.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        const order = { DISBURSEMENT: 1, PRIOR_PRINCIPAL_PAID: 2, PRIOR_INTEREST_ACCRUED: 3, INTEREST_PROVISION: 4, REPAYMENT: 5 };
        return (order[a.type] || 0) - (order[b.type] || 0);
      });

      // Compute running balances
      let runPrincipal = 0, runInterest = 0;
      for (const entry of entries) {
        runPrincipal += entry.debitPrincipal - entry.creditPrincipal;
        runInterest += entry.debitInterest - entry.creditInterest;
        entry.principalBalance = runPrincipal;
        entry.interestBalance = runInterest;
        entry.netBalance = runPrincipal + runInterest;
      }

      // Loan subtotal directly derived from entries for 100% mathematical integrity
      const totalDisbursed = entries.reduce((s, e) => s + e.debitPrincipal, 0);
      const totalPrincipalPaid = entries.reduce((s, e) => s + e.creditPrincipal, 0);
      const totalInterestProvisioned = entries.reduce((s, e) => s + e.debitInterest, 0);
      const totalInterestPaid = entries.reduce((s, e) => s + e.creditInterest, 0);
      const principalBalance = totalDisbursed - totalPrincipalPaid;
      const interestBalance = totalInterestProvisioned - totalInterestPaid;
      const netBalance = principalBalance + interestBalance;

      const loanSubtotal = {
        totalDisbursed,
        totalPrincipalPaid,
        totalInterestProvisioned,
        totalInterestPaid,
        principalBalance,
        interestBalance,
        netBalance
      };

      loanLedgers.push({
        loan,
        entries,
        subtotal: loanSubtotal
      });
    }

    // PBS-wise subtotals (group by origin_pbs_name)
    const pbsGroups = {};
    for (const ll of loanLedgers) {
      const pbsKey = ll.loan.origin_pbs_name;
      if (!pbsGroups[pbsKey]) {
        pbsGroups[pbsKey] = {
          pbsName: pbsKey,
          loanSourceType: ll.loan.loan_source_type,
          totalDisbursed: 0,
          totalPrincipalPaid: 0,
          totalInterestProvisioned: 0,
          totalInterestPaid: 0,
          principalBalance: 0,
          interestBalance: 0,
          netBalance: 0,
          loanCount: 0
        };
      }
      const g = pbsGroups[pbsKey];
      g.totalDisbursed += ll.subtotal.totalDisbursed;
      g.totalPrincipalPaid += ll.subtotal.totalPrincipalPaid;
      g.totalInterestProvisioned += ll.subtotal.totalInterestProvisioned;
      g.totalInterestPaid += ll.subtotal.totalInterestPaid;
      g.principalBalance += ll.subtotal.principalBalance;
      g.interestBalance += ll.subtotal.interestBalance;
      g.netBalance += ll.subtotal.netBalance;
      g.loanCount += 1;
    }

    // Grand total
    const grandTotal = {
      totalDisbursed: loanLedgers.reduce((s, ll) => s + ll.subtotal.totalDisbursed, 0),
      totalPrincipalPaid: loanLedgers.reduce((s, ll) => s + ll.subtotal.totalPrincipalPaid, 0),
      totalInterestProvisioned: loanLedgers.reduce((s, ll) => s + ll.subtotal.totalInterestProvisioned, 0),
      totalInterestPaid: loanLedgers.reduce((s, ll) => s + ll.subtotal.totalInterestPaid, 0),
      principalBalance: loanLedgers.reduce((s, ll) => s + ll.subtotal.principalBalance, 0),
      interestBalance: loanLedgers.reduce((s, ll) => s + ll.subtotal.interestBalance, 0),
      netBalance: loanLedgers.reduce((s, ll) => s + ll.subtotal.netBalance, 0),
      loanCount: loanLedgers.length
    };

    res.json({
      success: true,
      employees: allEmployees,
      employee,
      loanLedgers,
      pbsSummary: Object.values(pbsGroups),
      grandTotal
    });

  } catch (error) {
    console.error('Employee loan ledger error:', error);
    res.status(500).json({ success: false, message: 'কর্মচারীভিত্তিক ঋণ খতিয়ান লোড করা যায়নি।' });
  }
});


// 2. Other PBS Loans Recovery & Remittance Ledger (অন্য পবিসের ঋণ লেজার - ডেবিট/ক্রেডিট সহ)
router.get('/other-pbs-ledger', authenticateToken, (req, res) => {
  try {
    const { originPbsName, month } = req.query;

    let query = `
      SELECT r.id as repayment_id, r.deduction_month, r.deduction_date, r.total_amount as credit_deduction,
             r.remittance_status, r.voucher_no,
             l.loan_no, l.sanction_no, l.origin_pbs_name,
             e.emp_code, e.name as emp_name, e.designation,
             b.advice_no, b.memo_no, b.advice_date as debit_remittance_date,
             CASE WHEN r.remittance_status = 'REMITTED' THEN r.total_amount ELSE 0 END as debit_remittance
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      JOIN employees e ON r.employee_id = e.id
      LEFT JOIN bank_advices b ON r.bank_advice_id = b.id
      WHERE l.loan_source_type = 'OTHER_PBS'
        AND r.is_deleted = 0
        AND l.is_deleted = 0
    `;
    const params = [];

    // Role check: employee can only see their own
    if (req.user.role === 'employee') {
      query += ` AND r.employee_id = ?`;
      params.push(req.user.employeeId);
    }

    if (originPbsName) {
      query += ` AND l.origin_pbs_name = ?`;
      params.push(originPbsName);
    }

    if (month) {
      query += ` AND r.deduction_month = ?`;
      params.push(month);
    }

    query += ` ORDER BY r.deduction_month DESC, r.id DESC`;

    const records = db.prepare(query).all(...params);

    // Group summary by PBS
    const pbsSummary = {};
    for (const r of records) {
      const pbs = r.origin_pbs_name;
      if (!pbsSummary[pbs]) {
        pbsSummary[pbs] = {
          pbsName: pbs,
          totalDeducted: 0,
          totalRemitted: 0,
          pendingRemittance: 0,
          itemsCount: 0
        };
      }
      pbsSummary[pbs].totalDeducted += r.credit_deduction;
      pbsSummary[pbs].totalRemitted += r.debit_remittance;
      pbsSummary[pbs].itemsCount += 1;
    }

    for (const pbs in pbsSummary) {
      pbsSummary[pbs].pendingRemittance = pbsSummary[pbs].totalDeducted - pbsSummary[pbs].totalRemitted;
    }

    res.json({
      success: true,
      records,
      pbsSummary: Object.values(pbsSummary)
    });
  } catch (error) {
    console.error('Other PBS ledger error:', error);
    res.status(500).json({ success: false, message: 'অন্য পবিস লেজার লোড করা যায়নি।' });
  }
});

// 3. Fiscal Year Comparative Statement (অর্থবছর অনুযায়ী তুলনামূলক স্টেটমেন্ট)
router.get('/comparative-statement', authenticateToken, (req, res) => {
  try {
    const availableYears = getAvailableFiscalYears();
    const selectedYears = req.query.years ? req.query.years.split(',') : availableYears.slice(0, 4);

    const statement = getFiscalYearComparativeStatement(selectedYears);

    res.json({
      success: true,
      availableYears,
      statement
    });
  } catch (error) {
    console.error('Comparative statement error:', error);
    res.status(500).json({ success: false, message: 'তুলনামূলক স্টেটমেন্ট তৈরি করা যায়নি।' });
  }
});

// 4. Audit Log Report (সম্পূর্ণ অডিট লগ)
router.get('/audit-logs', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const { action, entityType, username, fromDate, toDate, search, limit = 100 } = req.query;

    let query = `SELECT * FROM audit_logs WHERE 1=1`;
    const params = [];

    if (action) {
      query += ` AND action = ?`;
      params.push(action);
    }

    if (entityType) {
      query += ` AND entity_type = ?`;
      params.push(entityType);
    }

    if (username) {
      query += ` AND username = ?`;
      params.push(username);
    }

    if (fromDate) {
      query += ` AND DATE(created_at) >= ?`;
      params.push(fromDate);
    }

    if (toDate) {
      query += ` AND DATE(created_at) <= ?`;
      params.push(toDate);
    }

    if (search) {
      query += ` AND (details LIKE ? OR username LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY id DESC LIMIT ?`;
    params.push(parseInt(limit, 10));

    const logs = db.prepare(query).all(...params);
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Audit logs error:', error);
    res.status(500).json({ success: false, message: 'অডিট লগ রিপোর্ট আনা সম্ভব হয়নি।' });
  }
});

// 5. Excel Export for Comparative Statement & Ledgers
router.get('/export/excel', authenticateToken, (req, res) => {
  try {
    const { reportType } = req.query; // 'comparative' or 'own_ledger' or 'other_ledger'
    const wb = xlsx.utils.book_new();

    if (reportType === 'comparative') {
      const availableYears = getAvailableFiscalYears().slice(0, 4);
      const statement = getFiscalYearComparativeStatement(availableYears);

      // Sheet 1: Own PBS Comparative
      const ownData = statement.ownPbsStats.map(s => ({
        'অর্থবছর': s.fiscalYear,
        'প্রারম্ভিক আসল স্থিতি': s.openingPrincipal,
        'প্রারম্ভিক সুদ স্থিতি': s.openingInterest,
        'নতুন বিতরণকৃত ঋণ': s.disbursed,
        'আসল আদায়': s.principalRecovered,
        'ধার্যকৃত সুদ (প্রভিশন)': s.interestProvisioned,
        'সুদ আদায়': s.interestRecovered,
        'সমাপনী আসল স্থিতি': s.closingPrincipal,
        'সমাপনী সুদ স্থিতি': s.closingInterest,
        'মোট সমাপনী স্থিতি': s.totalClosingBalance
      }));
      const wsOwn = xlsx.utils.json_to_sheet(ownData);
      xlsx.utils.book_append_sheet(wb, wsOwn, 'নিজস্ব পবিস তুলনামূলক');

      // Sheet 2: Other PBS Comparative
      const otherData = statement.otherPbsStats.map(s => ({
        'অর্থবছর': s.fiscalYear,
        'প্রারম্ভিক প্রদেয় স্থিতি': s.openingPayable,
        'বেতন থেকে কর্তনকৃত কিস্তি': s.deductedFromSalary,
        'কর্তনের সংখ্যা': s.deductionCount,
        'সংশ্লিষ্ট পবিসে প্রেরিত অর্থ': s.remittedToPBS,
        'ব্যাংক অ্যাডভাইস সংখ্যা': s.adviceCount,
        'সমাপনী অপরিশোধিত স্থিতি': s.closingPayable
      }));
      const wsOther = xlsx.utils.json_to_sheet(otherData);
      xlsx.utils.book_append_sheet(wb, wsOther, 'অন্য পবিস তুলনামূলক');

    } else if (reportType === 'own_ledger' || reportType === 'employee_ledger') {
      const { employeeId } = req.query;
      let query = `
        SELECT e.emp_code as 'পে আইডি', e.name as 'নাম', e.designation as 'পদবী', e.department as 'বিভাগ',
               l.loan_no as 'ঋণ হিসাব নং', l.loan_lot_name as 'লট / বিবরণ',
               op.pbs_name as 'উৎস পবিস',
               l.disbursement_date as 'বিতরণ তারিখ',
               l.disbursed_amount as 'মঞ্জুরকৃত আসল',
               l.total_principal_paid as 'পরিশোধিত আসল',
               l.principal_balance as 'অবশিষ্ট আসল',
               l.interest_balance as 'ধার্যকৃত সুদ স্থিতি',
               (l.principal_balance + l.interest_balance) as 'সর্বমোট অবশিষ্ট স্থিতি',
               l.status as 'স্ট্যাটাস'
        FROM loans l
        JOIN employees e ON l.employee_id = e.id
        LEFT JOIN other_pbs op ON l.origin_pbs_id = op.id
        WHERE l.is_deleted = 0 AND e.is_deleted = 0
      `;
      const params = [];
      if (employeeId) {
        query += ` AND e.id = ?`;
        params.push(employeeId);
      }
      query += ` ORDER BY e.emp_code ASC, l.disbursement_date ASC`;

      const rows = db.prepare(query).all(...params);
      const ws = xlsx.utils.json_to_sheet(rows);
      xlsx.utils.book_append_sheet(wb, ws, 'কর্মচারী ঋণ খতিয়ান');
    } else if (reportType === 'own_control_sheet') {
      const { asOnDate = new Date().toISOString().slice(0, 10), comparativeDate, balanceType = 'total' } = req.query;
      const dComp = comparativeDate || (() => {
        const d = new Date(asOnDate);
        d.setFullYear(d.getFullYear() - 1);
        return d.toISOString().slice(0, 10);
      })();

      const ownSettings = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get();
      const employees = db.prepare(`
        SELECT DISTINCT e.id, e.emp_code, e.name, e.designation, e.department
        FROM employees e
        JOIN loans l ON l.employee_id = e.id
        WHERE l.loan_source_type = 'OWN_PBS' AND l.is_deleted = 0 AND e.is_deleted = 0
        ORDER BY CAST(e.emp_code AS INTEGER) ASC, e.emp_code ASC
      `).all();

      const getLoansStmt = db.prepare(`
        SELECT * FROM loans
        WHERE employee_id = ? AND loan_source_type = 'OWN_PBS' AND is_deleted = 0
      `);

      const repAfterStmt = db.prepare(`
        SELECT COALESCE(SUM(principal_paid), 0) as prin, COALESCE(SUM(interest_paid), 0) as intPaid
        FROM repayments
        WHERE loan_id = ? AND deduction_date > ? AND is_deleted = 0
      `);

      const provAfterStmt = db.prepare(`
        SELECT COALESCE(SUM(interest_amount), 0) as intProv
        FROM interest_provisions
        WHERE loan_id = ? AND provision_date > ? AND is_deleted = 0
      `);

      const asOnHeader = formatDateDisplay(asOnDate);
      const compHeader = formatDateDisplay(dComp);

      const exportRows = employees.map(emp => {
        const loans = getLoansStmt.all(emp.id);
        let valAsOn = 0, valComp = 0;

        for (const loan of loans) {
          if (loan.disbursement_date <= asOnDate) {
            const rA = repAfterStmt.get(loan.id, asOnDate);
            const pA = provAfterStmt.get(loan.id, asOnDate);
            const prin = Math.max(0, loan.principal_balance + rA.prin);
            const intB = Math.max(0, loan.interest_balance + rA.intPaid - pA.intProv);
            valAsOn += balanceType === 'principal' ? prin : (prin + intB);
          }
          if (loan.disbursement_date <= dComp) {
            const rC = repAfterStmt.get(loan.id, dComp);
            const pC = provAfterStmt.get(loan.id, dComp);
            const prin = Math.max(0, loan.principal_balance + rC.prin);
            const intB = Math.max(0, loan.interest_balance + rC.intPaid - pC.intProv);
            valComp += balanceType === 'principal' ? prin : (prin + intB);
          }
        }

        return {
          'EM_ID': emp.emp_code,
          'Name': emp.name,
          'Designation': emp.designation,
          [asOnHeader]: valAsOn,
          [compHeader]: valComp,
          'Difference': valAsOn - valComp
        };
      });

      const ws = xlsx.utils.json_to_sheet(exportRows);
      xlsx.utils.book_append_sheet(wb, ws, 'Control_sheet_comparative');
    } else if (reportType === 'house_loan_ledger_14320') {
      let { fromDate, toDate, employeeId } = req.query;
      const today = new Date().toISOString().slice(0, 10);
      if (!fromDate) fromDate = '2024-06-01';
      if (!toDate) toDate = today;

      let loansQuery = `
        SELECT l.*, e.name as emp_name, e.emp_code, e.designation
        FROM loans l
        JOIN employees e ON l.employee_id = e.id
        WHERE l.loan_source_type = 'OWN_PBS' AND l.is_deleted = 0 AND e.is_deleted = 0
      `;
      const loansParams = [];
      if (employeeId) {
        loansQuery += ` AND l.employee_id = ?`;
        loansParams.push(employeeId);
      }
      const loans = db.prepare(loansQuery).all(...loansParams);

      const repAfterStmt = db.prepare(`
        SELECT COALESCE(SUM(principal_paid), 0) as prin
        FROM repayments
        WHERE loan_id = ? AND deduction_date >= ? AND is_deleted = 0
      `);

      let openingDebit = 0;
      let openingCredit = 0;
      let openingBalance = 0;

      for (const loan of loans) {
        if (loan.disbursement_date < fromDate) {
          const rAfter = repAfterStmt.get(loan.id, fromDate);
          const balAsOfFromDate = Math.max(0, loan.principal_balance + rAfter.prin);
          const disbursed = loan.disbursed_amount;
          const paidBefore = Math.max(0, disbursed - balAsOfFromDate);

          openingDebit += disbursed;
          openingCredit += paidBefore;
          openingBalance += balAsOfFromDate;
        }
      }

      const exportRows = [];
      let runningBalance = openingBalance;

      if (openingDebit > 0 || openingCredit > 0 || openingBalance > 0) {
        exportRows.push({
          'Date': formatGlDate(fromDate),
          'particulars': 'Opening Balance',
          'Debit': openingDebit,
          'Credit': openingCredit,
          'Balance': openingBalance
        });
      }

      let disQuery = `
        SELECT l.*, e.name as emp_name, e.emp_code
        FROM loans l
        JOIN employees e ON l.employee_id = e.id
        WHERE l.loan_source_type = 'OWN_PBS' AND l.is_deleted = 0 AND e.is_deleted = 0
          AND l.disbursement_date >= ? AND l.disbursement_date <= ?
      `;
      const disParams = [fromDate, toDate];
      if (employeeId) {
        disQuery += ` AND l.employee_id = ?`;
        disParams.push(employeeId);
      }
      const disbursedInPeriod = db.prepare(disQuery).all(...disParams);

      const repEvents = getControlLedgerRepaymentEvents(fromDate, toDate, employeeId);

      const allEvents = [];
      for (const d of disbursedInPeriod) {
        allEvents.push({
          date: d.disbursement_date,
          dateFormatted: formatGlDate(d.disbursement_date),
          particulars: 'Balance B/F',
          debit: d.disbursed_amount,
          credit: 0,
          type: 'DISBURSEMENT'
        });
      }
      for (const r of repEvents) {
        allEvents.push(r);
      }

      allEvents.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.type === 'DISBURSEMENT' && b.type !== 'DISBURSEMENT') return -1;
        if (a.type !== 'DISBURSEMENT' && b.type === 'DISBURSEMENT') return 1;
        return 0;
      });

      for (const ev of allEvents) {
        runningBalance = runningBalance + ev.debit - ev.credit;
        exportRows.push({
          'Date': ev.dateFormatted,
          'particulars': ev.particulars,
          'Debit': ev.debit,
          'Credit': ev.credit,
          'Balance': runningBalance
        });
      }

      let totalDebit = openingDebit;
      let totalCredit = openingCredit;
      for (const ev of allEvents) {
        totalDebit += ev.debit;
        totalCredit += ev.credit;
      }
      const closingBalance = totalDebit - totalCredit;

      exportRows.push({
        'Date': '',
        'particulars': 'Total',
        'Debit': totalDebit,
        'Credit': totalCredit,
        'Balance': closingBalance
      });

      const ws = xlsx.utils.json_to_sheet(exportRows);
      xlsx.utils.book_append_sheet(wb, ws, 'House_Loan_Ledger_143.20');
    } else if (reportType === 'other_pbs_ledger_24250') {
      let { fromDate, toDate, otherPbsId } = req.query;
      const today = new Date().toISOString().slice(0, 10);
      if (!fromDate) fromDate = '2024-06-01';
      if (!toDate) toDate = today;

      let priorCredQuery = `
        SELECT COALESCE(SUM(r.total_amount), 0) as amt
        FROM repayments r
        JOIN loans l ON r.loan_id = l.id
        WHERE l.loan_source_type = 'OTHER_PBS' AND r.is_deleted = 0 AND r.deduction_date < ?
      `;
      const priorCredParams = [fromDate];
      if (otherPbsId) {
        priorCredQuery += ` AND l.origin_pbs_id = ?`;
        priorCredParams.push(otherPbsId);
      }
      const priorCredits = db.prepare(priorCredQuery).get(...priorCredParams).amt;

      let priorDebQuery = `
        SELECT COALESCE(SUM(total_amount), 0) as amt
        FROM bank_advices
        WHERE is_deleted = 0 AND advice_date < ?
      `;
      const priorDebParams = [fromDate];
      if (otherPbsId) {
        priorDebQuery += ` AND target_pbs_id = ?`;
        priorDebParams.push(otherPbsId);
      }
      const priorDebits = db.prepare(priorDebQuery).get(...priorDebParams).amt;

      const openingBalance = priorCredits - priorDebits;
      const exportRows = [];
      let runningBalance = openingBalance;

      if (priorCredits > 0 || priorDebits > 0 || openingBalance !== 0) {
        exportRows.push({
          'Date': formatGlDate(fromDate),
          'particulars': 'Opening Balance',
          'Debit': priorDebits,
          'Credit': priorCredits,
          'Balance': openingBalance
        });
      }

      let dedQuery = `
        SELECT r.deduction_date, r.deduction_month, r.voucher_no,
               SUM(r.total_amount) as total_amount
        FROM repayments r
        JOIN loans l ON r.loan_id = l.id
        WHERE l.loan_source_type = 'OTHER_PBS' AND r.is_deleted = 0
          AND r.deduction_date >= ? AND r.deduction_date <= ?
      `;
      const dedParams = [fromDate, toDate];
      if (otherPbsId) {
        dedQuery += ` AND l.origin_pbs_id = ?`;
        dedParams.push(otherPbsId);
      }
      dedQuery += ` GROUP BY r.deduction_date, r.deduction_month, r.voucher_no ORDER BY r.deduction_date ASC`;
      const deductions = db.prepare(dedQuery).all(...dedParams);

      let advQuery = `
        SELECT advice_date, advice_no, total_amount
        FROM bank_advices
        WHERE is_deleted = 0 AND advice_date >= ? AND advice_date <= ?
      `;
      const advParams = [fromDate, toDate];
      if (otherPbsId) {
        advQuery += ` AND target_pbs_id = ?`;
        advParams.push(otherPbsId);
      }
      advQuery += ` ORDER BY advice_date ASC`;
      const advices = db.prepare(advQuery).all(...advParams);

      const events = [];
      for (const d of deductions) {
        let part = d.voucher_no || '';
        if (!part || part.startsWith('SALARY-') || /^\d+$/.test(part)) {
          const m = d.deduction_month || d.deduction_date.slice(0, 7);
          part = `PJ-${m.slice(5)}/${m.slice(2, 4)}`;
        }
        events.push({
          date: d.deduction_date,
          dateFormatted: formatGlDate(d.deduction_date),
          particulars: part,
          debit: 0,
          credit: d.total_amount,
          type: 'DEDUCTION'
        });
      }

      for (const a of advices) {
        let part = a.advice_no || '';
        if (!part.startsWith('BA-') && !part.startsWith('BA/') && !part.startsWith('JV-')) {
          part = `BA-${part}`;
        }
        events.push({
          date: a.advice_date,
          dateFormatted: formatGlDate(a.advice_date),
          particulars: part,
          debit: a.total_amount,
          credit: 0,
          type: 'REMITTANCE'
        });
      }

      events.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        if (a.type === 'DEDUCTION' && b.type !== 'DEDUCTION') return -1;
        if (a.type !== 'DEDUCTION' && b.type === 'DEDUCTION') return 1;
        return 0;
      });

      for (const ev of events) {
        runningBalance = runningBalance + ev.credit - ev.debit;
        exportRows.push({
          'Date': ev.dateFormatted,
          'particulars': ev.particulars,
          'Debit': ev.debit,
          'Credit': ev.credit,
          'Balance': runningBalance
        });
      }

      let totalDebit = priorDebits;
      let totalCredit = priorCredits;
      for (const ev of events) {
        totalDebit += ev.debit;
        totalCredit += ev.credit;
      }

      exportRows.push({
        'Date': '',
        'particulars': 'Total',
        'Debit': totalDebit,
        'Credit': totalCredit,
        'Balance': runningBalance
      });

      const ws = xlsx.utils.json_to_sheet(exportRows);
      xlsx.utils.book_append_sheet(wb, ws, 'House_Loan_Ledger_242.50');
    }

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename=pbs_house_loan_${reportType || 'report'}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Excel export error:', error);
    res.status(500).json({ success: false, message: 'এক্সেল এক্সপোর্ট ব্যর্থ হয়েছে।' });
  }
});

// Helper: Format date to "DD-MM-YY" (e.g. "01-06-24" matching legacy software)
function formatGlDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const day = String(d.getDate()).padStart(2, '0');
  const mon = String(d.getMonth() + 1).padStart(2, '0');
  const yr = String(d.getFullYear()).slice(-2);
  return `${day}-${mon}-${yr}`;
}

// Helper: Format date to "DD-MMM-YY" (e.g. "30-Jun-26")
function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  const mon = months[d.getMonth()];
  const yr = String(d.getFullYear()).slice(-2);
  return `${day}-${mon}-${yr}`;
}

// 6. Own PBS Control Sheet (House Loan Balance as on Date with Comparative Year)
router.get('/own-control-sheet', authenticateToken, (req, res) => {
  try {
    let { asOnDate, comparativeDate, balanceType } = req.query;

    const today = new Date().toISOString().slice(0, 10);
    if (!asOnDate) {
      const curYear = new Date().getFullYear();
      asOnDate = `${curYear}-06-30`;
      if (today < asOnDate) {
        asOnDate = today;
      }
    }

    if (!comparativeDate) {
      const d = new Date(asOnDate);
      d.setFullYear(d.getFullYear() - 1);
      comparativeDate = d.toISOString().slice(0, 10);
    }

    balanceType = balanceType || 'total'; // 'total' or 'principal'

    const ownSettings = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get();

    const employees = db.prepare(`
      SELECT DISTINCT e.id, e.emp_code, e.name, e.designation, e.department
      FROM employees e
      JOIN loans l ON l.employee_id = e.id
      WHERE l.loan_source_type = 'OWN_PBS' AND l.is_deleted = 0 AND e.is_deleted = 0
      ORDER BY CAST(e.emp_code AS INTEGER) ASC, e.emp_code ASC
    `).all();

    const getLoansStmt = db.prepare(`
      SELECT * FROM loans
      WHERE employee_id = ? AND loan_source_type = 'OWN_PBS' AND is_deleted = 0
    `);

    const repAfterStmt = db.prepare(`
      SELECT COALESCE(SUM(principal_paid), 0) as prin, COALESCE(SUM(interest_paid), 0) as intPaid
      FROM repayments
      WHERE loan_id = ? AND deduction_date > ? AND is_deleted = 0
    `);

    const provAfterStmt = db.prepare(`
      SELECT COALESCE(SUM(interest_amount), 0) as intProv
      FROM interest_provisions
      WHERE loan_id = ? AND provision_date > ? AND is_deleted = 0
    `);

    function calculateLoanBalanceAsOf(loan, targetDate) {
      if (loan.disbursement_date > targetDate) {
        return { principal: 0, interest: 0, total: 0 };
      }
      const repAfter = repAfterStmt.get(loan.id, targetDate);
      const provAfter = provAfterStmt.get(loan.id, targetDate);

      const principal = Math.max(0, loan.principal_balance + repAfter.prin);
      const interest = Math.max(0, loan.interest_balance + repAfter.intPaid - provAfter.intProv);
      return {
        principal,
        interest,
        total: principal + interest
      };
    }

    const rows = employees.map(emp => {
      const loans = getLoansStmt.all(emp.id);

      let prinAsOn = 0, intAsOn = 0, totalAsOn = 0;
      let prinComp = 0, intComp = 0, totalComp = 0;

      for (const loan of loans) {
        const bAsOn = calculateLoanBalanceAsOf(loan, asOnDate);
        const bComp = calculateLoanBalanceAsOf(loan, comparativeDate);

        prinAsOn += bAsOn.principal;
        intAsOn += bAsOn.interest;
        totalAsOn += bAsOn.total;

        prinComp += bComp.principal;
        intComp += bComp.interest;
        totalComp += bComp.total;
      }

      const valAsOn = balanceType === 'principal' ? prinAsOn : totalAsOn;
      const valComp = balanceType === 'principal' ? prinComp : totalComp;
      const diff = valAsOn - valComp;

      return {
        emp_id: emp.emp_code,
        name: emp.name,
        designation: emp.designation,
        department: emp.department,
        loan_count: loans.length,
        valAsOn,
        valComp,
        diff,
        prinAsOn,
        intAsOn,
        prinComp,
        intComp
      };
    });

    const totals = {
      totalAsOn: rows.reduce((s, r) => s + r.valAsOn, 0),
      totalComp: rows.reduce((s, r) => s + r.valComp, 0),
      totalDiff: rows.reduce((s, r) => s + r.diff, 0),
      totalEmployees: rows.length
    };

    res.json({
      success: true,
      pbs: ownSettings,
      asOnDate,
      comparativeDate,
      asOnDateFormatted: formatDateDisplay(asOnDate),
      comparativeDateFormatted: formatDateDisplay(comparativeDate),
      balanceType,
      rows,
      totals
    });
  } catch (error) {
    console.error('Control sheet error:', error);
    res.status(500).json({ success: false, message: 'কন্ট্রোল শিট তৈরি করা যায়নি।' });
  }
});

// 7. House Loan Ledger (AccountsCode: 143.20) General Ledger
router.get('/house-loan-ledger-14320', authenticateToken, (req, res) => {
  try {
    let { fromDate, toDate, employeeId, balanceType } = req.query;

    const today = new Date().toISOString().slice(0, 10);
    if (!fromDate) {
      fromDate = '2024-06-01';
    }
    if (!toDate) {
      toDate = today;
    }
    balanceType = balanceType || 'principal'; // 'principal' (GL 143.20) or 'total'

    const ownSettings = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get();

    // Fetch relevant loans
    let loansQuery = `
      SELECT l.*, e.name as emp_name, e.emp_code, e.designation
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.loan_source_type = 'OWN_PBS' AND l.is_deleted = 0 AND e.is_deleted = 0
    `;
    const loansParams = [];
    if (employeeId) {
      loansQuery += ` AND l.employee_id = ?`;
      loansParams.push(employeeId);
    }
    const loans = db.prepare(loansQuery).all(...loansParams);

    // Repayment statement for calculating balance as of fromDate
    const repAfterStmt = db.prepare(`
      SELECT COALESCE(SUM(principal_paid), 0) as prin, COALESCE(SUM(interest_paid), 0) as intPaid, COALESCE(SUM(total_amount), 0) as totalPaid
      FROM repayments
      WHERE loan_id = ? AND deduction_date >= ? AND is_deleted = 0
    `);

    const provAfterStmt = db.prepare(`
      SELECT COALESCE(SUM(interest_amount), 0) as intAmt
      FROM interest_provisions
      WHERE loan_id = ? AND provision_date >= ? AND is_deleted = 0
    `);

    // 1. Calculate Opening Balance as of fromDate
    let openingDebit = 0;
    let openingCredit = 0;
    let openingBalance = 0;

    for (const loan of loans) {
      if (loan.disbursement_date < fromDate) {
        const rAfter = repAfterStmt.get(loan.id, fromDate);
        if (balanceType === 'total') {
          const pAfter = provAfterStmt.get(loan.id, fromDate);
          const prinBal = Math.max(0, loan.principal_balance + rAfter.prin);
          const intBal = Math.max(0, loan.interest_balance + rAfter.intPaid - pAfter.intAmt);
          const totalBal = prinBal + intBal;

          const provBefore = db.prepare(`SELECT COALESCE(SUM(interest_amount), 0) as intAmt FROM interest_provisions WHERE loan_id = ? AND provision_date < ? AND is_deleted = 0`).get(loan.id, fromDate);
          const repBefore = db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as totalPaid FROM repayments WHERE loan_id = ? AND deduction_date < ? AND is_deleted = 0`).get(loan.id, fromDate);

          openingDebit += (loan.disbursed_amount + provBefore.intAmt);
          openingCredit += repBefore.totalPaid;
          openingBalance += totalBal;
        } else {
          const balAsOfFromDate = Math.max(0, loan.principal_balance + rAfter.prin);
          const disbursed = loan.disbursed_amount;
          const paidBefore = Math.max(0, disbursed - balAsOfFromDate);

          openingDebit += disbursed;
          openingCredit += paidBefore;
          openingBalance += balAsOfFromDate;
        }
      }
    }

    const rows = [];
    let runningBalance = openingBalance;

    // Add Opening Balance row if fromDate has prior transactions
    if (openingDebit > 0 || openingCredit > 0 || openingBalance > 0) {
      rows.push({
        date: fromDate,
        dateFormatted: formatGlDate(fromDate),
        particulars: 'Opening Balance',
        debit: openingDebit,
        credit: openingCredit,
        balance: openingBalance,
        isOpening: true
      });
    }

    // 2. Fetch Loans disbursed in period
    let disQuery = `
      SELECT l.*, e.name as emp_name, e.emp_code
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.loan_source_type = 'OWN_PBS' AND l.is_deleted = 0 AND e.is_deleted = 0
        AND l.disbursement_date >= ? AND l.disbursement_date <= ?
    `;
    const disParams = [fromDate, toDate];
    if (employeeId) {
      disQuery += ` AND l.employee_id = ?`;
      disParams.push(employeeId);
    }
    const disbursedInPeriod = db.prepare(disQuery).all(...disParams);

    // 3. Fetch Repayments in period
    const repEvents = getControlLedgerRepaymentEvents(fromDate, toDate, employeeId, balanceType);

    const allEvents = [];
    for (const d of disbursedInPeriod) {
      allEvents.push({
        date: d.disbursement_date,
        dateFormatted: formatGlDate(d.disbursement_date),
        particulars: 'Balance B/F',
        debit: d.disbursed_amount,
        credit: 0,
        type: 'DISBURSEMENT'
      });
    }

    // 4. If balanceType === 'total', include interest provisions in period as Debits
    if (balanceType === 'total') {
      let provQuery = `
        SELECT p.provision_date, p.provision_month, SUM(p.interest_amount) as interest_amount
        FROM interest_provisions p
        JOIN loans l ON p.loan_id = l.id
        WHERE l.loan_source_type = 'OWN_PBS' AND p.is_deleted = 0
          AND p.provision_date >= ? AND p.provision_date <= ?
      `;
      const provParams = [fromDate, toDate];
      if (employeeId) {
        provQuery += ` AND p.employee_id = ?`;
        provParams.push(employeeId);
      }
      provQuery += ` GROUP BY p.provision_date, p.provision_month ORDER BY p.provision_date ASC`;
      const provisions = db.prepare(provQuery).all(...provParams);

      for (const p of provisions) {
        const m = p.provision_month;
        allEvents.push({
          date: p.provision_date,
          dateFormatted: formatGlDate(p.provision_date),
          particulars: `JV-${m.slice(5)}/${m.slice(2, 4)}`,
          debit: p.interest_amount,
          credit: 0,
          type: 'INTEREST_PROVISION'
        });
      }
    }

    for (const r of repEvents) {
      allEvents.push(r);
    }

    allEvents.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.type === 'DISBURSEMENT' && b.type !== 'DISBURSEMENT') return -1;
      if (a.type !== 'DISBURSEMENT' && b.type === 'DISBURSEMENT') return 1;
      if (a.type === 'INTEREST_PROVISION' && b.type === 'REPAYMENT') return -1;
      if (a.type === 'REPAYMENT' && b.type === 'INTEREST_PROVISION') return 1;
      return 0;
    });

    for (const ev of allEvents) {
      runningBalance = runningBalance + ev.debit - ev.credit;
      rows.push({
        date: ev.date,
        dateFormatted: ev.dateFormatted,
        particulars: ev.particulars,
        debit: ev.debit,
        credit: ev.credit,
        balance: runningBalance,
        type: ev.type
      });
    }

    let totalDebit = openingDebit;
    let totalCredit = openingCredit;
    for (const ev of allEvents) {
      totalDebit += ev.debit;
      totalCredit += ev.credit;
    }
    const closingBalance = totalDebit - totalCredit;

    let selectedEmployee = null;
    if (employeeId) {
      selectedEmployee = db.prepare('SELECT id, emp_code, name, designation, department FROM employees WHERE id = ?').get(employeeId);
    }

    res.json({
      success: true,
      pbs: ownSettings,
      accountCode: balanceType === 'total' ? '143.20 (আসল + সুদ)' : '143.20',
      accountName: 'House Loan Ledger',
      balanceType,
      fromDate,
      toDate,
      fromDateFormatted: formatGlDate(fromDate),
      toDateFormatted: formatGlDate(toDate),
      employee: selectedEmployee,
      rows,
      totals: {
        totalDebit,
        totalCredit,
        closingBalance
      }
    });
  } catch (error) {
    console.error('House loan ledger 143.20 error:', error);
    res.status(500).json({ success: false, message: 'হাউজ লোন লেজার ১৪৩.২০ তৈরি করা যায়নি।' });
  }
});

// 8. Other PBS House Loan Payable Ledger (AccountsCode: 242.50)
router.get('/other-pbs-ledger-24250', authenticateToken, (req, res) => {
  try {
    let { fromDate, toDate, otherPbsId } = req.query;

    const today = new Date().toISOString().slice(0, 10);
    if (!fromDate) {
      fromDate = '2024-06-01';
    }
    if (!toDate) {
      toDate = today;
    }

    const ownSettings = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get();

    // Fetch list of Other PBS for filter dropdown
    const otherPbsList = db.prepare(`
      SELECT DISTINCT op.id, op.pbs_name, op.short_name, op.bank_name, op.bank_branch, op.account_no
      FROM other_pbs op
      JOIN loans l ON l.origin_pbs_id = op.id
      WHERE l.loan_source_type = 'OTHER_PBS' AND l.is_deleted = 0
      ORDER BY op.pbs_name ASC
    `).all();

    let selectedOtherPbs = null;
    if (otherPbsId) {
      selectedOtherPbs = db.prepare('SELECT * FROM other_pbs WHERE id = ?').get(otherPbsId);
    }

    // 1. Calculate Opening Balance as of fromDate (Account 242.50 is Liability -> Credit Normal Balance)
    // Deductions prior to fromDate (Credits to 242.50)
    let priorCredQuery = `
      SELECT COALESCE(SUM(r.total_amount), 0) as amt
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      WHERE l.loan_source_type = 'OTHER_PBS' AND r.is_deleted = 0 AND r.deduction_date < ?
    `;
    const priorCredParams = [fromDate];
    if (otherPbsId) {
      priorCredQuery += ` AND l.origin_pbs_id = ?`;
      priorCredParams.push(otherPbsId);
    }
    const priorCredits = db.prepare(priorCredQuery).get(...priorCredParams).amt;

    // Advices/Remittances prior to fromDate (Debits to 242.50)
    let priorDebQuery = `
      SELECT COALESCE(SUM(total_amount), 0) as amt
      FROM bank_advices
      WHERE is_deleted = 0 AND advice_date < ?
    `;
    const priorDebParams = [fromDate];
    if (otherPbsId) {
      priorDebQuery += ` AND target_pbs_id = ?`;
      priorDebParams.push(otherPbsId);
    }
    const priorDebits = db.prepare(priorDebQuery).get(...priorDebParams).amt;

    const openingBalance = priorCredits - priorDebits;

    const rows = [];
    let runningBalance = openingBalance;

    if (priorCredits > 0 || priorDebits > 0 || openingBalance !== 0) {
      rows.push({
        date: fromDate,
        dateFormatted: formatGlDate(fromDate),
        particulars: 'Opening Balance',
        debit: priorDebits,
        credit: priorCredits,
        balance: openingBalance,
        isOpening: true
      });
    }

    // 2. Fetch Deductions in period (Credits to 242.50)
    let dedQuery = `
      SELECT r.deduction_date, r.deduction_month, r.voucher_no,
             SUM(r.total_amount) as total_amount, COUNT(*) as cnt
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      WHERE l.loan_source_type = 'OTHER_PBS' AND r.is_deleted = 0
        AND r.deduction_date >= ? AND r.deduction_date <= ?
    `;
    const dedParams = [fromDate, toDate];
    if (otherPbsId) {
      dedQuery += ` AND l.origin_pbs_id = ?`;
      dedParams.push(otherPbsId);
    }
    dedQuery += ` GROUP BY r.deduction_date, r.deduction_month, r.voucher_no ORDER BY r.deduction_date ASC`;
    const deductions = db.prepare(dedQuery).all(...dedParams);

    // 3. Fetch Bank Advices in period (Debits to 242.50)
    let advQuery = `
      SELECT advice_date, advice_no, total_amount, target_pbs_name
      FROM bank_advices
      WHERE is_deleted = 0 AND advice_date >= ? AND advice_date <= ?
    `;
    const advParams = [fromDate, toDate];
    if (otherPbsId) {
      advQuery += ` AND target_pbs_id = ?`;
      advParams.push(otherPbsId);
    }
    advQuery += ` ORDER BY advice_date ASC`;
    const advices = db.prepare(advQuery).all(...advParams);

    const events = [];

    for (const d of deductions) {
      let part = d.voucher_no || '';
      if (!part || part.startsWith('SALARY-') || /^\d+$/.test(part)) {
        const m = d.deduction_month || d.deduction_date.slice(0, 7);
        part = `PJ-${m.slice(5)}/${m.slice(2, 4)}`;
      }
      events.push({
        date: d.deduction_date,
        dateFormatted: formatGlDate(d.deduction_date),
        particulars: part,
        debit: 0,
        credit: d.total_amount,
        type: 'DEDUCTION'
      });
    }

    for (const a of advices) {
      let part = a.advice_no || '';
      if (!part.startsWith('BA-') && !part.startsWith('BA/') && !part.startsWith('JV-')) {
        part = `BA-${part}`;
      }
      events.push({
        date: a.advice_date,
        dateFormatted: formatGlDate(a.advice_date),
        particulars: part,
        debit: a.total_amount,
        credit: 0,
        type: 'REMITTANCE'
      });
    }

    // Sort chronologically: Deductions (Credits) first if same date, then Remittances (Debits)
    events.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.type === 'DEDUCTION' && b.type !== 'DEDUCTION') return -1;
      if (a.type !== 'DEDUCTION' && b.type === 'DEDUCTION') return 1;
      return 0;
    });

    for (const ev of events) {
      runningBalance = runningBalance + ev.credit - ev.debit;
      rows.push({
        date: ev.date,
        dateFormatted: ev.dateFormatted,
        particulars: ev.particulars,
        debit: ev.debit,
        credit: ev.credit,
        balance: runningBalance,
        type: ev.type
      });
    }

    let totalDebit = priorDebits;
    let totalCredit = priorCredits;
    for (const ev of events) {
      totalDebit += ev.debit;
      totalCredit += ev.credit;
    }
    const closingBalance = runningBalance;
    const balanceNature = closingBalance >= 0 ? 'Credit' : 'Debit';

    res.json({
      success: true,
      pbs: ownSettings,
      accountCode: '242.50',
      accountName: 'House Loan Ledger',
      selectedOtherPbs,
      otherPbsList,
      fromDate,
      toDate,
      fromDateFormatted: formatGlDate(fromDate),
      toDateFormatted: formatGlDate(toDate),
      rows,
      totals: {
        totalDebit,
        totalCredit,
        closingBalance,
        balanceDisplay: Math.abs(closingBalance),
        balanceNature
      }
    });
  } catch (error) {
    console.error('Other PBS ledger 242.50 error:', error);
    res.status(500).json({ success: false, message: 'অন্য পবিসের লেজার ২৪২.৫০ তৈরি করা যায়নি।' });
  }
});

module.exports = router;
