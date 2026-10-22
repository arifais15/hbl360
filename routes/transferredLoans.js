const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const db = require('../database/db');
const xlsx = require('xlsx');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const {
  amountInBengaliWords,
  toBengaliDigits,
  formatBDT,
  formatBengaliMonth,
  distributeRepayment
} = require('../services/loanCalculationService');

// Helper: Format date to Bengali display e.g. "২০ অক্টোবর ২০২৬"
function formatDateBengaliDisplay(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const months = [
    'জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
    'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'
  ];
  const day = d.getDate();
  const mon = months[d.getMonth()];
  const yr = d.getFullYear();
  return `${toBengaliDigits(day)} ${mon} ${toBengaliDigits(yr)}`;
}

// Helper: Format YYYY-MM to Bengali display e.g. "জুলাই/২৪"
function formatMonthYearShort(monthStr) {
  if (!monthStr || monthStr.length < 7) return monthStr || '';
  const [yr, mon] = monthStr.split('-');
  const monNum = parseInt(mon, 10);
  const months = [
    'জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন',
    'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'
  ];
  const monName = months[monNum - 1] || mon;
  const yrShort = yr.slice(-2);
  return `${monName}/${toBengaliDigits(yrShort)}`;
}

// Helper: Generate list of YYYY-MM between two months inclusive
function getMonthsRange(startMonth, endMonth) {
  const result = [];
  let [sY, sM] = startMonth.split('-').map(Number);
  const [eY, eM] = endMonth.split('-').map(Number);

  while (sY < eY || (sY === eY && sM <= eM)) {
    const mm = String(sM).padStart(2, '0');
    result.push(`${sY}-${mm}`);
    sM++;
    if (sM > 12) {
      sM = 1;
      sY++;
    }
  }
  return result;
}

// 1. Get List of Transferred Employees with Own PBS Loans and Due Installments
router.get('/', authenticateToken, (req, res) => {
  try {
    const { targetPbsName, overdueOnly, asOnMonth, search } = req.query;

    const ownSettings = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get() || {};
    const ownPbsName = ownSettings.pbs_name || 'গাজীপুর পল্লী বিদ্যুৎ সমিতি-২';

    const currentYearMonth = asOnMonth || new Date().toISOString().slice(0, 7);

    // Fetch active loans originating from Own PBS
    let loansQuery = `
      SELECT l.*,
             e.id as employee_id, e.emp_code, e.name as emp_name,
             e.designation, e.department, e.mobile, e.email, e.current_posting_pbs
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.loan_source_type = 'OWN_PBS'
        AND l.is_deleted = 0
        AND e.is_deleted = 0
    `;
    const loansParams = [];

    if (search) {
      loansQuery += ` AND (e.name LIKE ? OR e.emp_code LIKE ? OR l.loan_no LIKE ?)`;
      const s = `%${search}%`;
      loansParams.push(s, s, s);
    }

    loansQuery += ` ORDER BY e.current_posting_pbs ASC, l.disbursement_date ASC`;

    const allLoans = db.prepare(loansQuery).all(...loansParams);

    // Repayments statement
    const getRepaymentsStmt = db.prepare(`
      SELECT deduction_month, deduction_date, total_amount, voucher_no, repayment_method
      FROM repayments
      WHERE loan_id = ? AND is_deleted = 0
      ORDER BY deduction_month ASC
    `);

    // Demand letters statement
    const getDemandLetterStmt = db.prepare(`
      SELECT id, letter_no, memo_no, letter_date, due_months_count, total_due_amount, status
      FROM demand_letters
      WHERE loan_id = ? AND is_deleted = 0
      ORDER BY letter_date DESC, id DESC
      LIMIT 1
    `);

    const records = [];

    for (const loan of allLoans) {
      const postingPbs = loan.current_posting_pbs || '';
      const isTransferred = postingPbs && postingPbs !== ownPbsName && postingPbs !== 'নিজস্ব পবিস';

      // If filtering by specific target PBS
      if (targetPbsName && postingPbs !== targetPbsName) {
        continue;
      }

      const repayments = getRepaymentsStmt.all(loan.id);
      const paidMonthsSet = new Set(repayments.map(r => r.deduction_month));

      // Determine last paid month and date
      const lastRepayment = repayments.length > 0 ? repayments[repayments.length - 1] : null;
      const lastPaidMonth = lastRepayment ? lastRepayment.deduction_month : null;
      const lastPaidDate = lastRepayment ? lastRepayment.deduction_date : null;

      // Determine tracking start month
      let trackingStartMonth = '';
      if (repayments.length > 0) {
        trackingStartMonth = repayments[0].deduction_month;
      } else {
        const disb = loan.disbursement_date || '2024-01-01';
        let [y, m] = disb.slice(0, 7).split('-').map(Number);
        m++;
        if (m > 12) { m = 1; y++; }
        trackingStartMonth = `${y}-${String(m).padStart(2, '0')}`;
      }
      if (trackingStartMonth < '2024-05' && loan.disbursement_date < '2024-01-01') {
        trackingStartMonth = '2024-05';
      }

      // Calculate overdue months up to currentYearMonth
      let dueMonthsList = [];
      const totalRemaining = loan.principal_balance + loan.interest_balance;
      if (loan.status === 'ACTIVE' && totalRemaining > 0) {
        if (trackingStartMonth <= currentYearMonth) {
          const allPotential = getMonthsRange(trackingStartMonth, currentYearMonth);
          dueMonthsList = allPotential.filter(m => !paidMonthsSet.has(m));
        }
      }

      // Cap due months by remaining balance
      const maxDueCount = Math.ceil(totalRemaining / (loan.monthly_installment || 1));
      if (dueMonthsList.length > maxDueCount) {
        dueMonthsList = dueMonthsList.slice(0, maxDueCount);
      }

      const dueMonthsCount = dueMonthsList.length;

      // Filter: if overdueOnly is true and there are 0 due months, skip
      if (overdueOnly === 'true' && dueMonthsCount === 0) {
        continue;
      }

      // Calculate Overdue Amount
      const rawOverdue = dueMonthsCount * loan.monthly_installment;
      const overdueAmount = Math.min(rawOverdue, totalRemaining);

      // Format Due Period Text
      let duePeriodText = 'কোন বকেয়া নেই';
      if (dueMonthsCount === 1) {
        duePeriodText = formatMonthYearShort(dueMonthsList[0]);
      } else if (dueMonthsCount > 1) {
        duePeriodText = `${formatMonthYearShort(dueMonthsList[0])} হতে ${formatMonthYearShort(dueMonthsList[dueMonthsList.length - 1])}`;
      }

      // Latest demand letter
      const latestLetter = getDemandLetterStmt.get(loan.id) || null;

      records.push({
        loanId: loan.id,
        loanNo: loan.loan_no,
        loanLotName: loan.loan_lot_name,
        disbursementDate: loan.disbursement_date,
        disbursedAmount: loan.disbursed_amount,
        monthlyInstallment: loan.monthly_installment,
        interestRate: loan.interest_rate,
        principalBalance: loan.principal_balance,
        interestBalance: loan.interest_balance,
        advanceBalance: loan.advance_balance || 0,
        totalBalance: totalRemaining,
        status: loan.status,
        salaryDeductionSuspended: Boolean(loan.salary_deduction_suspended),
        employeeId: loan.employee_id,
        empCode: loan.emp_code,
        empName: loan.emp_name,
        designation: loan.designation,
        department: loan.department,
        mobile: loan.mobile,
        currentPostingPbs: loan.current_posting_pbs || ownPbsName,
        isTransferred,
        lastPaidMonth,
        lastPaidMonthFormatted: lastPaidMonth ? formatMonthYearShort(lastPaidMonth) : 'এখনো আদায় হয়নি',
        lastPaidDate,
        dueMonthsCount,
        dueMonthsList,
        duePeriodText,
        overdueAmount,
        latestDemandLetter: latestLetter
      });
    }

    // Filter to transferred borrowers by default if overdueOnly not explicitly all
    const transferredRecords = records.filter(r => r.isTransferred);

    // Summary Statistics
    const totalTransferredBorrowers = transferredRecords.length;
    const totalOverdueInstallments = transferredRecords.reduce((sum, r) => sum + r.dueMonthsCount, 0);
    const totalOverdueAmount = transferredRecords.reduce((sum, r) => sum + r.overdueAmount, 0);
    const totalOutstandingBalance = transferredRecords.reduce((sum, r) => sum + r.totalBalance, 0);

    // Grouping summary by PBS
    const pbsSummaryMap = {};
    for (const r of transferredRecords) {
      const pbs = r.currentPostingPbs;
      if (!pbsSummaryMap[pbs]) {
        pbsSummaryMap[pbs] = {
          pbsName: pbs,
          borrowerCount: 0,
          totalDueMonths: 0,
          totalOverdueAmount: 0,
          totalBalance: 0
        };
      }
      pbsSummaryMap[pbs].borrowerCount++;
      pbsSummaryMap[pbs].totalDueMonths += r.dueMonthsCount;
      pbsSummaryMap[pbs].totalOverdueAmount += r.overdueAmount;
      pbsSummaryMap[pbs].totalBalance += r.totalBalance;
    }
    const pbsSummary = Object.values(pbsSummaryMap).sort((a, b) => b.totalOverdueAmount - a.totalOverdueAmount);

    res.json({
      success: true,
      ownPbs: ownSettings,
      currentYearMonth,
      currentYearMonthFormatted: formatMonthYearShort(currentYearMonth),
      totals: {
        totalTransferredBorrowers,
        totalOverdueInstallments,
        totalOverdueAmount,
        totalOutstandingBalance
      },
      pbsSummary,
      records: transferredRecords,
      allRecords: records
    });
  } catch (error) {
    console.error('Transferred loans list error:', error);
    res.status(500).json({ success: false, message: 'বদলিকৃত ঋণের বকেয়া তালিকা লোড করা যায়নি।' });
  }
});

// 2. Post Received Remittance / Collection from Other PBS
router.post('/post-collection', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const {
      loan_id,
      source_pbs_name,
      receipt_date,
      voucher_no,
      months, // Array of months e.g. ['2024-07', '2024-08'] or comma-separated
      monthly_amounts,
      total_amount,
      manual_posting,
      remarks
    } = req.body;

    if (!loan_id) {
      return res.status(400).json({ success: false, message: 'ঋণ হিসাব নির্বাচন করুন।' });
    }
    if (!receipt_date) {
      return res.status(400).json({ success: false, message: 'টাকা প্রাপ্তির তারিখ প্রদান করুন।' });
    }

    const loan = db.prepare(`
      SELECT l.*, e.name as emp_name, e.emp_code, e.current_posting_pbs
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.id = ? AND l.is_deleted = 0
    `).get(loan_id);

    if (!loan) {
      return res.status(404).json({ success: false, message: 'ঋণ রেকর্ডটি পাওয়া যায়নি।' });
    }

    let parsedMonths = [];
    if (Array.isArray(months)) {
      parsedMonths = months.map(m => String(m).trim()).filter(Boolean);
    } else if (typeof months === 'string') {
      parsedMonths = months.split(',').map(m => m.trim()).filter(Boolean);
    }

    if (manual_posting) {
      if (parsedMonths.length === 0 || parsedMonths.some(month => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
        return res.status(400).json({ success: false, message: 'ম্যানুয়াল পোস্টিংয়ের জন্য অন্তত একটি বৈধ মাস নির্বাচন করুন।' });
      }
    }

    if (parsedMonths.length === 0) {
      return res.status(400).json({ success: false, message: 'যে যে মাসের কিস্তি পরিশোধ হচ্ছে তা নির্বাচন করুন।' });
    }

    if (new Set(parsedMonths).size !== parsedMonths.length) {
      return res.status(400).json({ success: false, message: 'একই মাস একাধিকবার নির্বাচন করা যাবে না।' });
    }

    const amountNum = parseFloat(total_amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      return res.status(400).json({ success: false, message: 'সঠিক টাকার পরিমাণ প্রদান করুন।' });
    }

    let manualAmountsCents = null;
    if (manual_posting) {
      if (monthly_amounts !== undefined && !Array.isArray(monthly_amounts)) {
        return res.status(400).json({ success: false, message: 'মাসভিত্তিক টাকার তালিকা সঠিক নয়।' });
      }

      if (Array.isArray(monthly_amounts)) {
        const suppliedAmounts = monthly_amounts.map(amount => Number(amount));
        if (suppliedAmounts.length !== parsedMonths.length
          || suppliedAmounts.some(amount => !Number.isFinite(amount) || Math.round(amount * 100) <= 0)) {
          return res.status(400).json({ success: false, message: 'প্রতিটি নির্বাচিত মাসের জন্য বৈধ টাকার অঙ্ক দিন।' });
        }

        const entries = parsedMonths
          .map((month, index) => ({ month, cents: Math.round(suppliedAmounts[index] * 100) }))
          .sort((a, b) => a.month.localeCompare(b.month));
        const suppliedTotalCents = entries.reduce((sum, entry) => sum + entry.cents, 0);
        if (suppliedTotalCents !== Math.round(amountNum * 100)) {
          return res.status(400).json({ success: false, message: 'মাসভিত্তিক অঙ্কগুলোর যোগফল মোট প্রাপ্তির অঙ্কের সমান হতে হবে।' });
        }

        parsedMonths = entries.map(entry => entry.month);
        manualAmountsCents = entries.map(entry => entry.cents);
      } else {
        parsedMonths.sort();
        const totalCents = Math.round(amountNum * 100);
        const basePerMonthCents = Math.floor(totalCents / 100 / parsedMonths.length) * 100;
        if (basePerMonthCents <= 0) {
          return res.status(400).json({
            success: false,
            message: 'সমান ভাগের জন্য মোট অঙ্ক অন্তত নির্বাচিত মাসের সংখ্যার সমান টাকা হতে হবে।'
          });
        }
        manualAmountsCents = parsedMonths.map((_, index) => index === parsedMonths.length - 1
          ? totalCents - (basePerMonthCents * (parsedMonths.length - 1))
          : basePerMonthCents);
      }
    } else {
      parsedMonths.sort();
    }

    // Check for existing active repayments in any of these months
    const checkStmt = db.prepare(`
      SELECT deduction_month FROM repayments
      WHERE loan_id = ? AND deduction_month = ? AND is_deleted = 0
    `);
    for (const m of parsedMonths) {
      const exists = checkStmt.get(loan_id, m);
      if (exists) {
        return res.status(400).json({
          success: false,
          message: `${formatMonthYearShort(m)} মাসের কিস্তি ইতিপূর্বে পোস্টিং করা হয়েছে। ডুপ্লিকেট এন্ট্রি সম্ভব নয়।`
        });
      }
    }

    // Calculate installment amount per month
    const amountPerMonth = Math.round((amountNum / parsedMonths.length) * 100) / 100;
    const collectionBatchId = randomUUID();
    const collectionVoucherNo = voucher_no || `CRJ-${receipt_date.slice(5).replace('-', '/')}`;

    const executePosting = db.transaction(() => {
      let curPrin = loan.principal_balance;
      let curInt = loan.interest_balance;
      let totalPrinPaid = 0;
      let totalIntPaid = 0;
      let totalAdvancePaid = 0;

      const insertRepStmt = db.prepare(`
        INSERT INTO repayments (
          loan_id, employee_id, deduction_month, deduction_date, voucher_no,
          total_amount, principal_paid, interest_paid,
          advance_paid,
          previous_principal_balance, new_principal_balance,
          previous_interest_balance, new_interest_balance,
          repayment_method, collection_batch_id, remittance_status, remarks
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?,
          ?, ?,
          'INTER_PBS_COLLECTION', ?, 'NOT_APPLICABLE', ?
        )
      `);

      for (let i = 0; i < parsedMonths.length; i++) {
        const month = parsedMonths[i];
        const thisMonthAmount = manual_posting
          ? manualAmountsCents[i] / 100
          : (i === parsedMonths.length - 1
            ? (amountNum - (amountPerMonth * (parsedMonths.length - 1)))
            : amountPerMonth);

        const amountAppliedToLoan = Math.min(thisMonthAmount, curPrin + curInt);
        const advancePaid = Math.max(0, thisMonthAmount - amountAppliedToLoan);
        const { principalPaid, interestPaid } = distributeRepayment(amountAppliedToLoan, curPrin, curInt);

        const newPrin = Math.max(0, curPrin - principalPaid);
        const newInt = Math.max(0, curInt - interestPaid);

        const note = `${source_pbs_name ? source_pbs_name + ' হতে প্রাপ্ত: ' : ''}${remarks || 'অন্য পবিস হতে রেমিট্যান্স প্রাপ্তি'}`;

        insertRepStmt.run(
          loan.id, loan.employee_id, month, receipt_date, collectionVoucherNo,
          thisMonthAmount, principalPaid, interestPaid, advancePaid,
          curPrin, newPrin,
          curInt, newInt,
          collectionBatchId,
          note
        );

        totalPrinPaid += principalPaid;
        totalIntPaid += interestPaid;
        totalAdvancePaid += advancePaid;
        curPrin = newPrin;
        curInt = newInt;
      }

      // Update Loan Balances
      const newStatus = (curPrin <= 0 && curInt <= 0) ? 'CLOSED' : 'ACTIVE';
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
      `).run(curPrin, curInt, totalPrinPaid, totalIntPaid, totalAdvancePaid, newStatus, loan.id);

      // If fully paid or overdue cleared, update demand letter status to SETTLED
      db.prepare(`
        UPDATE demand_letters
        SET status = 'SETTLED'
        WHERE loan_id = ? AND status = 'ISSUED'
      `).run(loan.id);

      // Audit Log
      logAudit(
        req,
        'CREATE',
        'REPAYMENT',
        loan.id,
        `অন্য পবিস (${source_pbs_name || loan.current_posting_pbs}) হতে বদলিকৃত কর্মচারী ${loan.emp_name}-এর ঋণ নং ${loan.loan_no}-এর ${parsedMonths.length} মাসের জন্য মোট ${amountNum} টাকা আদায় পোস্টিং করা হয়েছে। (অগ্রিম: ${totalAdvancePaid}, ভাউচার: ${voucher_no || '-'})`
      );

      return {
        newPrincipalBalance: curPrin,
        newInterestBalance: curInt,
        totalPrincipalPaid: totalPrinPaid,
        totalInterestPaid: totalIntPaid,
        totalAdvancePaid,
        advanceBalance: loan.advance_balance + totalAdvancePaid,
        newStatus
      };
    });

    const result = executePosting();

    res.json({
      success: true,
      message: `${loan.emp_name}-এর ${parsedMonths.length} মাসের জন্য মোট ${formatBDT(amountNum)} টাকা সফলভাবে পোস্টিং হয়েছে।${result.totalAdvancePaid > 0 ? ` ${formatBDT(result.totalAdvancePaid)} টাকা অগ্রিম জমা হিসেবে রাখা হয়েছে।` : ''}`,
      result
    });
  } catch (error) {
    console.error('Post collection error:', error);
    res.status(500).json({ success: false, message: 'কিস্তি পোস্টিং ব্যর্থ হয়েছে: ' + error.message });
  }
});

// 3. Generate Official Demand Letter (তাগাদা পত্র) for Transferred Employee
router.post('/generate-consolidated-demand-letter', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const ownSettings = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get() || {};
    const ownPbsName = ownSettings.pbs_name || 'গাজীপুর পল্লী বিদ্যুৎ সমিতি-২';
    const today = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const letterDate = req.body.letter_date || today;
    const asOnMonth = letterDate.slice(0, 7);
    const loans = db.prepare(`
      SELECT l.*, e.id AS employee_id, e.emp_code, e.name AS emp_name,
             e.designation, e.current_posting_pbs
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.loan_source_type = 'OWN_PBS'
        AND l.status = 'ACTIVE'
        AND l.is_deleted = 0
        AND e.is_deleted = 0
      ORDER BY e.current_posting_pbs ASC, e.emp_code ASC, l.loan_no ASC
    `).all();
    const repaymentsStmt = db.prepare(`
      SELECT deduction_month
      FROM repayments
      WHERE loan_id = ? AND is_deleted = 0
      ORDER BY deduction_month ASC
    `);
    const rows = [];

    for (const loan of loans) {
      const pbsName = loan.current_posting_pbs || '';
      if (!pbsName || pbsName === ownPbsName || pbsName === 'নিজস্ব পবিস') continue;

      const totalRemaining = Number(loan.principal_balance || 0) + Number(loan.interest_balance || 0);
      const monthlyInstallment = Number(loan.monthly_installment || 0);
      if (totalRemaining <= 0 || monthlyInstallment <= 0) continue;

      const repayments = repaymentsStmt.all(loan.id);
      const paidMonths = new Set(repayments.map(repayment => repayment.deduction_month));
      let startMonth;
      if (repayments.length > 0) {
        startMonth = repayments[0].deduction_month;
      } else {
        const disbursementDate = loan.disbursement_date || '2024-01-01';
        let [year, month] = disbursementDate.slice(0, 7).split('-').map(Number);
        month++;
        if (month > 12) {
          month = 1;
          year++;
        }
        startMonth = `${year}-${String(month).padStart(2, '0')}`;
      }
      if (startMonth < '2024-05' && loan.disbursement_date < '2024-01-01') {
        startMonth = '2024-05';
      }
      if (startMonth > asOnMonth) continue;

      const dueMonths = getMonthsRange(startMonth, asOnMonth).filter(month => !paidMonths.has(month));
      const maxDueCount = Math.ceil(totalRemaining / monthlyInstallment);
      const cappedDueMonths = dueMonths.slice(0, maxDueCount);
      if (cappedDueMonths.length === 0) continue;

      let duePeriodText = formatMonthYearShort(cappedDueMonths[0]);
      if (cappedDueMonths.length > 1) {
        duePeriodText += ` হতে ${formatMonthYearShort(cappedDueMonths[cappedDueMonths.length - 1])}`;
      }
      rows.push({
        pbsName,
        employeeId: loan.employee_id,
        employeeName: loan.emp_name,
        empCode: loan.emp_code,
        designation: loan.designation || '',
        loanNo: loan.loan_no,
        monthlyInstallment,
        dueMonthsCount: cappedDueMonths.length,
        duePeriodText,
        overdueAmount: Math.min(cappedDueMonths.length * monthlyInstallment, totalRemaining)
      });
    }

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: 'কোনো পবিসে বকেয়া কিস্তি পাওয়া যায়নি; সম্মিলিত তাগাদা পত্র তৈরি করা হয়নি।' });
    }

    const pbsSummaryMap = new Map();
    for (const row of rows) {
      const summary = pbsSummaryMap.get(row.pbsName) || {
        pbsName: row.pbsName,
        employeeIds: new Set(),
        totalDueAmount: 0
      };
      summary.employeeIds.add(row.employeeId);
      summary.totalDueAmount += row.overdueAmount;
      pbsSummaryMap.set(row.pbsName, summary);
    }
    const pbsSummary = Array.from(pbsSummaryMap.values(), summary => ({
      pbsName: summary.pbsName,
      employeeCount: summary.employeeIds.size,
      totalDueAmount: summary.totalDueAmount
    }));
    const employeeCount = new Set(rows.map(row => row.employeeId)).size;
    const totalDueAmount = rows.reduce((sum, row) => sum + row.overdueAmount, 0);
    const totalDueInstallments = rows.reduce((sum, row) => sum + row.dueMonthsCount, 0);
    const count = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM demand_letters) +
        (SELECT COUNT(*) FROM consolidated_demand_letters) AS count
    `).get().count + 1;
    const letterNo = `DL-${letterDate.slice(0, 7).replace('-', '')}-${String(count).padStart(3, '0')}`;
    const memoPrefix = (ownSettings.memo_no_prefix || '২৭.১২.৬১০০.৫৪২.০১.০২৪').replace(/[.\-]+$/, '');
    const memoNo = `${memoPrefix}.${toBengaliDigits(letterDate.slice(2, 4))}-${toBengaliDigits(String(count).padStart(3, '0'))}`;
    const amountInWords = amountInBengaliWords(totalDueAmount);
    const snapshot = JSON.stringify({ rows, pbsSummary, totalDueAmount, totalDueInstallments });

    const insertLetter = db.prepare(`
      INSERT INTO consolidated_demand_letters (
        letter_no, memo_no, letter_date, total_due_amount,
        total_due_installments, pbs_count, employee_count,
        amount_in_words, details_json, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = insertLetter.run(
      letterNo, memoNo, letterDate, totalDueAmount, totalDueInstallments,
      pbsSummary.length, employeeCount, amountInWords, snapshot, req.user.username
    );

    logAudit(req, 'CREATE', 'CONSOLIDATED_DEMAND_LETTER', result.lastInsertRowid, {
      letterNo,
      memoNo,
      pbsCount: pbsSummary.length,
      employeeCount,
      totalDueAmount
    });

    res.json({
      success: true,
      message: `সম্মিলিত তাগাদা পত্রে ${toBengaliDigits(pbsSummary.length)}টি পবিসের ${toBengaliDigits(employeeCount)} জন কর্মচারীর বকেয়া যুক্ত হয়েছে।`,
      consolidated: true,
      letter: {
        letter_no: letterNo,
        memo_no: memoNo,
        letter_date: letterDate,
        total_due_amount: totalDueAmount,
        total_due_installments: totalDueInstallments,
        pbs_count: pbsSummary.length,
        employee_count: employeeCount,
        amount_in_words: amountInWords
      },
      ownPbs: ownSettings,
      rows,
      pbsSummary,
      letterDateFormatted: formatDateBengaliDisplay(letterDate)
    });
  } catch (error) {
    console.error('Generate consolidated demand letter error:', error);
    res.status(500).json({ success: false, message: 'সম্মিলিত তাগাদা পত্র তৈরি করা যায়নি।' });
  }
});

router.post('/generate-demand-letter', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const {
      loan_id,
      memo_no,
      letter_date,
      target_pbs_name,
      due_months_count,
      due_period_text,
      total_due_amount,
      remarks
    } = req.body;

    if (!loan_id) {
      return res.status(400).json({ success: false, message: 'ঋণ হিসাব নির্বাচন করুন।' });
    }

    const loan = db.prepare(`
      SELECT l.*, e.id as emp_id, e.name as emp_name, e.emp_code, e.designation, e.department, e.current_posting_pbs
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.id = ? AND l.is_deleted = 0
    `).get(loan_id);

    if (!loan) {
      return res.status(404).json({ success: false, message: 'ঋণ রেকর্ড পাওয়া যায়নি।' });
    }

    const today = new Date().toISOString().slice(0, 10);
    const effDate = letter_date || today;
    const effPbs = target_pbs_name || loan.current_posting_pbs;

    // Find other_pbs record if exists
    const otherPbs = db.prepare('SELECT id, bank_name, bank_branch, account_no, routing_no FROM other_pbs WHERE pbs_name = ?').get(effPbs);
    const targetPbsId = otherPbs ? otherPbs.id : null;

    // Generate unique letter number: DL-YYYYMM-XXXX
    const countLetters = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM demand_letters) +
        (SELECT COUNT(*) FROM consolidated_demand_letters) AS cnt
    `).get().cnt;
    const letterNo = `DL-${effDate.slice(0, 7).replace('-', '')}-${String(countLetters + 1).padStart(3, '0')}`;

    // Auto generate official BREB memo no if not provided
    const ownSettings = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get() || {};
    const memoPrefix = (ownSettings.memo_no_prefix || '২৭.১২.৬১০০.৫৪২.০১.০২৪').replace(/[.\-]+$/, '');
    const defaultMemo = memo_no || `${memoPrefix}.${toBengaliDigits(effDate.slice(2, 4))}-${toBengaliDigits(String(countLetters + 1).padStart(3, '0'))}`;

    const dueAmountNum = parseFloat(total_due_amount) || (due_months_count * loan.monthly_installment);
    const words = amountInBengaliWords(dueAmountNum);

    const insertLetter = db.prepare(`
      INSERT INTO demand_letters (
        letter_no, memo_no, letter_date,
        target_pbs_name, target_pbs_id,
        employee_id, employee_name, emp_code, designation,
        loan_id, loan_no, disbursed_amount, monthly_installment,
        due_months_count, due_period_text, total_due_amount,
        amount_in_words, principal_balance, interest_balance,
        remarks, status, created_by
      ) VALUES (
        ?, ?, ?,
        ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, 'ISSUED', ?
      )
    `);

    const runRes = insertLetter.run(
      letterNo, defaultMemo, effDate,
      effPbs, targetPbsId,
      loan.emp_id, loan.emp_name, loan.emp_code, loan.designation,
      loan.id, loan.loan_no, loan.disbursed_amount, loan.monthly_installment,
      due_months_count || 1, due_period_text || '', dueAmountNum,
      words, loan.principal_balance, loan.interest_balance,
      remarks || '', req.user.username
    );

    logAudit(
      req,
      'CREATE',
      'DEMAND_LETTER',
      runRes.lastInsertRowid,
      `${effPbs}-এর অনুকূলে বদলিকৃত কর্মচারী ${loan.emp_name}-এর বকেয়া ${due_months_count} মাসের কিস্তির তাগাদা পত্র তৈরি করা হয়েছে। (স্মারক নং: ${defaultMemo})`
    );

    res.json({
      success: true,
      message: 'তাগাদা পত্র সফলভাবে প্রস্তুত করা হয়েছে।',
      letterId: runRes.lastInsertRowid
    });
  } catch (error) {
    console.error('Generate demand letter error:', error);
    res.status(500).json({ success: false, message: 'তাগাদা পত্র তৈরি করা যায়নি: ' + error.message });
  }
});

// 4. Get Demand Letter Printable Document by ID
router.get('/demand-letter/:id', authenticateToken, (req, res) => {
  try {
    const letterId = req.params.id;
    const letter = db.prepare(`
      SELECT dl.*,
             l.sanction_no, l.sanction_date, l.disbursement_date, l.loan_lot_name,
             e.department, e.joining_date, e.mobile
      FROM demand_letters dl
      JOIN loans l ON dl.loan_id = l.id
      JOIN employees e ON dl.employee_id = e.id
      WHERE dl.id = ? AND dl.is_deleted = 0
    `).get(letterId);

    if (!letter) {
      return res.status(404).json({ success: false, message: 'তাগাদা পত্র পাওয়া যায়নি।' });
    }

    const ownSettings = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get() || {};

    // Get target PBS info
    let targetPbs = null;
    if (letter.target_pbs_id) {
      targetPbs = db.prepare('SELECT * FROM other_pbs WHERE id = ?').get(letter.target_pbs_id);
    }
    if (!targetPbs && letter.target_pbs_name) {
      targetPbs = db.prepare('SELECT * FROM other_pbs WHERE pbs_name = ?').get(letter.target_pbs_name);
    }

    // Get list of repayments to reconstruct the exact due months
    const repayments = db.prepare(`
      SELECT deduction_month FROM repayments WHERE loan_id = ? AND is_deleted = 0 ORDER BY deduction_month ASC
    `).all(letter.loan_id);
    const paidSet = new Set(repayments.map(r => r.deduction_month));

    const letterYm = letter.letter_date.slice(0, 7);
    let startMonth = '';
    if (repayments.length > 0) {
      startMonth = repayments[0].deduction_month;
    } else {
      let [y, m] = letter.disbursement_date.slice(0, 7).split('-').map(Number);
      m++;
      if (m > 12) { m = 1; y++; }
      startMonth = `${y}-${String(m).padStart(2, '0')}`;
    }
    if (startMonth < '2024-05' && letter.disbursement_date < '2024-01-01') {
      startMonth = '2024-05';
    }

    let dueMonthsDetailed = [];
    if (startMonth <= letterYm) {
      const allR = getMonthsRange(startMonth, letterYm);
      let dues = allR.filter(m => !paidSet.has(m));
      if (letter.due_months_count && dues.length > letter.due_months_count) {
        dues = dues.slice(0, letter.due_months_count);
      }
      dueMonthsDetailed = dues.map((m, idx) => ({
        sl: idx + 1,
        month: m,
        monthFormatted: formatMonthYearShort(m),
        installment: letter.monthly_installment,
        remarks: 'বেতন হতে অকর্তিত'
      }));
    }

    res.json({
      success: true,
      letter,
      ownPbs: ownSettings,
      targetPbs,
      dueMonthsDetailed,
      letterDateFormatted: formatDateBengaliDisplay(letter.letter_date),
      sanctionDateFormatted: formatDateBengaliDisplay(letter.sanction_date),
      disbursementDateFormatted: formatDateBengaliDisplay(letter.disbursement_date)
    });
  } catch (error) {
    console.error('Get demand letter error:', error);
    res.status(500).json({ success: false, message: 'তাগাদা পত্রের ডাটা লোড করা যায়নি।' });
  }
});

// 5. Update Current Posting PBS of an Employee
router.put('/salary-deduction-suspension', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const { loanId, suspended } = req.body;
    if (!Number.isInteger(Number(loanId)) || typeof suspended !== 'boolean') {
      return res.status(400).json({ success: false, message: 'ঋণ নির্বাচন এবং কর্তন স্থগিতের সঠিক অবস্থা প্রদান করুন।' });
    }

    const loan = db.prepare(`
      SELECT l.id, l.loan_no, l.loan_source_type, l.salary_deduction_suspended,
             e.name AS emp_name
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.id = ? AND l.is_deleted = 0
    `).get(Number(loanId));

    if (!loan) {
      return res.status(404).json({ success: false, message: 'ঋণ রেকর্ডটি পাওয়া যায়নি।' });
    }
    db.prepare(`
      UPDATE loans
      SET salary_deduction_suspended = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(suspended ? 1 : 0, loan.id);

    logAudit(
      req,
      'UPDATE',
      'LOAN',
      loan.id,
      `ঋণ নং ${loan.loan_no}-এর বেতন কর্তন ${suspended ? 'স্থগিত' : 'পুনরায় চালু'} করা হয়েছে।`
    );

    res.json({
      success: true,
      salaryDeductionSuspended: suspended,
      message: `${loan.emp_name}-এর ঋণ নং ${loan.loan_no}-এর বেতন কর্তন ${suspended ? 'স্থগিত' : 'পুনরায় চালু'} হয়েছে।`
    });
  } catch (error) {
    console.error('Update salary deduction suspension error:', error);
    res.status(500).json({ success: false, message: 'বেতন কর্তনের স্থগিত অবস্থা আপডেট করা যায়নি।' });
  }
});

// 6. Update Current Posting PBS of an Employee
router.put('/update-posting-pbs', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const { employeeId, currentPostingPbs } = req.body;
    if (!employeeId || !currentPostingPbs) {
      return res.status(400).json({ success: false, message: 'কর্মচারী এবং বর্তমান পদায়ন পবিস নির্বাচন করুন।' });
    }

    const emp = db.prepare('SELECT id, name, emp_code, current_posting_pbs FROM employees WHERE id = ?').get(employeeId);
    if (!emp) {
      return res.status(404).json({ success: false, message: 'কর্মচারী পাওয়া যায়নি।' });
    }

    db.prepare(`
      UPDATE employees
      SET current_posting_pbs = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(currentPostingPbs, employeeId);

    logAudit(
      req.user.id,
      req.user.username,
      'UPDATE',
      'EMPLOYEE',
      employeeId,
      `কর্মচারী ${emp.name} (পে আইডি: ${emp.emp_code})-এর বর্তমান পদায়ন পরিবর্তন করা হয়েছে: ${emp.current_posting_pbs || 'নিজস্ব পবিস'} -> ${currentPostingPbs}`,
      req.ip
    );

    res.json({
      success: true,
      message: `${emp.name}-এর বর্তমান পদায়ন "${currentPostingPbs}" সফলভাবে আপডেট হয়েছে।`
    });
  } catch (error) {
    console.error('Update posting PBS error:', error);
    res.status(500).json({ success: false, message: 'পদায়ন আপডেট ব্যর্থ হয়েছে: ' + error.message });
  }
});

// 6. Export Transferred Loans Overdue Report to Excel
router.get('/export/excel', authenticateToken, (req, res) => {
  try {
    const ownSettings = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get() || {};
    const ownPbsName = ownSettings.pbs_name || 'গাজীপুর পল্লী বিদ্যুৎ সমিতি-২';
    const currentYearMonth = new Date().toISOString().slice(0, 7);

    const loans = db.prepare(`
      SELECT l.*,
             e.emp_code, e.name as emp_name, e.designation, e.department, e.current_posting_pbs
      FROM loans l
      JOIN employees e ON l.employee_id = e.id
      WHERE l.loan_source_type = 'OWN_PBS'
        AND l.is_deleted = 0
        AND e.is_deleted = 0
        AND l.status = 'ACTIVE'
        AND (e.current_posting_pbs != ? AND e.current_posting_pbs != 'নিজস্ব পবিস' AND e.current_posting_pbs IS NOT NULL AND e.current_posting_pbs != '')
      ORDER BY e.current_posting_pbs ASC, e.emp_code ASC
    `).all(ownPbsName);

    const getRepaymentsStmt = db.prepare(`
      SELECT deduction_month FROM repayments WHERE loan_id = ? AND is_deleted = 0 ORDER BY deduction_month ASC
    `);

    const rows = [];
    loans.forEach((loan, idx) => {
      const reps = getRepaymentsStmt.all(loan.id);
      const paidSet = new Set(reps.map(r => r.deduction_month));
      const lastPaidMonth = reps.length > 0 ? reps[reps.length - 1].deduction_month : null;

      let nextDueStartMonth = '';
      if (lastPaidMonth) {
        let [y, m] = lastPaidMonth.split('-').map(Number);
        m++;
        if (m > 12) { m = 1; y++; }
        nextDueStartMonth = `${y}-${String(m).padStart(2, '0')}`;
      } else {
        const disb = loan.disbursement_date || '2024-01-01';
        let [y, m] = disb.slice(0, 7).split('-').map(Number);
        m++;
        if (m > 12) { m = 1; y++; }
        nextDueStartMonth = `${y}-${String(m).padStart(2, '0')}`;
      }

      let dueList = [];
      if (nextDueStartMonth <= currentYearMonth) {
        dueList = getMonthsRange(nextDueStartMonth, currentYearMonth).filter(m => !paidSet.has(m));
      }

      const dueCount = dueList.length;
      const totalRemaining = loan.principal_balance + loan.interest_balance;
      const overdueAmt = Math.min(dueCount * loan.monthly_installment, totalRemaining);

      let periodText = 'কোন বকেয়া নেই';
      if (dueCount === 1) {
        periodText = formatMonthYearShort(dueList[0]);
      } else if (dueCount > 1) {
        periodText = `${formatMonthYearShort(dueList[0])} হতে ${formatMonthYearShort(dueList[dueList.length - 1])}`;
      }

      rows.push({
        'ক্র: নং': idx + 1,
        'পে আইডি': loan.emp_code,
        'কর্মচারীর নাম': loan.emp_name,
        'পদবী': loan.designation,
        'বর্তমান পদায়নকৃত পবিস': loan.current_posting_pbs,
        'ঋণ নং': loan.loan_no,
        'বিতরণকৃত মূল ঋণ': loan.disbursed_amount,
        'মাসিক কিস্তি': loan.monthly_installment,
        'সর্বশেষ পরিশোধের মাস': lastPaidMonth ? formatMonthYearShort(lastPaidMonth) : 'এখনো পরিশোধ হয়নি',
        'বকেয়া মাসের সংখ্যা': dueCount,
        'বকেয়া সময়সীমা': periodText,
        'মোট বকেয়া কিস্তির টাকা': overdueAmt,
        'অবশিষ্ট আসল স্থিতি': loan.principal_balance,
        'অবশিষ্ট সুদ স্থিতি': loan.interest_balance,
        'সর্বমোট অবশিষ্ট স্থিতি': totalRemaining
      });
    });

    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(wb, ws, 'Transferred_Loans_Overdue');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename=transferred_loans_overdue_report.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    console.error('Export transferred loans excel error:', error);
    res.status(500).json({ success: false, message: 'এক্সেল এক্সপোর্ট ব্যর্থ হয়েছে।' });
  }
});

module.exports = router;
