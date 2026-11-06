const express = require('express');
const { authenticateToken, requireRole } = require('../lib/auth');
const { collection } = require('../lib/firestore');
const { allocateId, getDb, listRecords, writeAudit } = require('../lib/records');

const router = express.Router();
const staffRoles = ['admin', 'accounts'];

function validMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function applicableRate(month, rules) {
  const date = `${month}-15`;
  const rule = rules
    .filter(item => item.is_active !== false && item.is_active !== 0
      && item.effective_from_date <= date
      && (!item.effective_to_date || item.effective_to_date >= date))
    .sort((left, right) => String(right.effective_from_date).localeCompare(String(left.effective_from_date))
      || String(right.id).localeCompare(String(left.id)))[0];
  if (rule && Number.isFinite(Number(rule.rate))) return Number(rule.rate);
  return month < '2020-01' ? 8 : 7;
}

function principalForMonth(loan, month, repayments) {
  const disbursementMonth = String(loan.disbursement_date || '').slice(0, 7);
  if (disbursementMonth > month) return 0;
  if (disbursementMonth === month) return Number(loan.disbursed_amount || 0);
  const futurePrincipal = repayments
    .filter(repayment => repayment.loan_id === loan.id
      && repayment.is_deleted !== true
      && repayment.deduction_month >= month)
    .reduce((sum, repayment) => sum + Number(repayment.principal_paid || 0), 0);
  return Math.max(0, Math.round(Number(loan.principal_balance || 0) + futurePrincipal));
}

function calculateProvision(loan, month, date, repayments, rules) {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const disbursementDate = String(loan.disbursement_date || '');
  const isDisbursementMonth = disbursementDate.slice(0, 7) === month;
  const startDay = isDisbursementMonth ? Number(disbursementDate.slice(8, 10)) || 1 : 1;
  let activeDays = isDisbursementMonth ? Math.max(0, daysInMonth - startDay + 1) : daysInMonth;
  if (date && date.slice(0, 7) === month && date.length >= 10) {
    const cutoffDay = Number(date.slice(8, 10)) || daysInMonth;
    if (cutoffDay < daysInMonth) activeDays = Math.max(0, cutoffDay - startDay + 1);
  }
  const customRate = loan.custom_interest_rate;
  const rate = customRate !== null && customRate !== undefined && customRate !== ''
    ? Number(customRate)
    : applicableRate(month, rules);
  const principal = principalForMonth(loan, month, repayments);
  const fullInterest = principal > 0 && rate > 0 ? (principal * (rate / 100)) / 12 : 0;
  const interestAmount = Math.round(activeDays < daysInMonth ? fullInterest * (activeDays / daysInMonth) : fullInterest);
  return { rate, principal, activeDays, daysInMonth, interestAmount };
}

async function loadProvisionData() {
  const [loans, employees, provisions, repayments, rules] = await Promise.all([
    listRecords('loans'),
    listRecords('employees'),
    listRecords('interest_provisions', { includeDeleted: true }),
    listRecords('repayments'),
    listRecords('interest_rules')
  ]);
  return {
    loans,
    employeesById: new Map(employees.map(employee => [employee.id, employee])),
    provisions,
    repayments,
    rules
  };
}

function eligibleLoans(data, month) {
  const alreadyProvisioned = new Set(data.provisions
    .filter(provision => provision.provision_month === month && provision.is_deleted !== true)
    .map(provision => provision.loan_id));
  return data.loans.filter(loan => loan.loan_source_type === 'OWN_PBS'
    && (loan.is_interest_applicable === true || loan.is_interest_applicable === 1)
    && loan.status === 'ACTIVE'
    && Number(loan.principal_balance) > 0
    && loan.is_deleted !== true
    && data.employeesById.has(loan.employee_id)
    && data.employeesById.get(loan.employee_id).is_deleted !== true
    && !(loan.opening_balance_as_of && String(loan.opening_balance_as_of).slice(0, 7) >= month)
    && !alreadyProvisioned.has(loan.id));
}

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const data = await loadProvisionData();
    const employeesById = data.employeesById;
    const loansById = new Map(data.loans.map(loan => [loan.id, loan]));
    let provisions = data.provisions
      .filter(provision => provision.is_deleted !== true && loansById.has(provision.loan_id))
      .map(provision => {
        const loan = loansById.get(provision.loan_id);
        const employee = employeesById.get(provision.employee_id);
        return {
          ...provision,
          loan_no: loan.loan_no,
          loan_lot_name: loan.loan_lot_name,
          disbursement_date: loan.disbursement_date,
          emp_code: employee?.emp_code,
          emp_name: employee?.name,
          designation: employee?.designation
        };
      });
    if (req.user.role === 'employee') {
      provisions = provisions.filter(provision => provision.employee_id === req.user.employeeId);
    }
    if (req.query.loanId) provisions = provisions.filter(provision => provision.loan_id === String(req.query.loanId));
    if (req.query.month) provisions = provisions.filter(provision => provision.provision_month === req.query.month);
    if (req.query.year) provisions = provisions.filter(provision => String(provision.provision_month).startsWith(`${req.query.year}-`));
    provisions.sort((left, right) => String(right.provision_month).localeCompare(String(left.provision_month))
      || String(right.id).localeCompare(String(left.id)));
    res.json({
      success: true,
      provisions,
      summary: {
        totalCount: provisions.length,
        totalInterestAmount: provisions.reduce((sum, provision) => sum + Number(provision.interest_amount || 0), 0)
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/preview', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const month = req.query.month;
    if (!validMonth(month)) {
      return res.status(400).json({ success: false, message: 'সঠিক প্রভিশন মাস প্রদান করুন।' });
    }
    const data = await loadProvisionData();
    const previewList = eligibleLoans(data, month).map(loan => {
      const calculation = calculateProvision(loan, month, null, data.repayments, data.rules);
      const employee = data.employeesById.get(loan.employee_id);
      return {
        loan_id: loan.id,
        loan_no: loan.loan_no,
        employee_id: loan.employee_id,
        emp_code: employee.emp_code,
        emp_name: employee.name,
        designation: employee.designation,
        disbursement_date: loan.disbursement_date,
        interest_rate: calculation.rate,
        rate_rule: month < '2020-01' ? '২০১৯ ডিসে পর্যন্ত (৮% সরল সুদ)' : '২০২০ জানু থেকে (৭% সরল সুদ)',
        current_principal: calculation.principal,
        active_days: calculation.activeDays,
        days_in_month: calculation.daysInMonth,
        is_fractional: calculation.activeDays < calculation.daysInMonth,
        calculated_monthly_interest: calculation.interestAmount,
        current_interest_balance: Number(loan.interest_balance || 0),
        new_interest_balance: Number(loan.interest_balance || 0) + calculation.interestAmount
      };
    });
    res.json({
      success: true,
      month,
      eligibleCount: previewList.length,
      totalCalculatedInterest: previewList.reduce((sum, item) => sum + item.calculated_monthly_interest, 0),
      previewList
    });
  } catch (error) {
    next(error);
  }
});

async function runMonth(month, date, user, data) {
  const eligible = eligibleLoans(data, month);
  if (!eligible.length) return { count: 0, totalInterest: 0 };
  if (eligible.length > 200) {
    throw new Error(`এই মাসে ${eligible.length} টি ঋণ প্রভিশনের যোগ্য; নিরাপদ ব্যাচ সীমা ২০০।`);
  }
  const provisionIds = eligible.map(() => allocateId('interest_provisions'));
  const result = await getDb().runTransaction(async transaction => {
    const snapshots = await Promise.all([
      transaction.get(collection('interest_provisions').where('provision_month', '==', month)),
      ...eligible.map(loan => transaction.get(collection('loans').doc(loan.id)))
    ]);
    const provisionsSnapshot = snapshots[0];
    const existingLoanIds = new Set(provisionsSnapshot.docs
      .filter(document => document.get('is_deleted') !== true)
      .map(document => document.get('loan_id')));
    let count = 0;
    let totalInterest = 0;
    const records = [];
    eligible.forEach((listedLoan, index) => {
      const loanSnapshot = snapshots[index + 1];
      if (!loanSnapshot.exists || loanSnapshot.get('is_deleted') === true || existingLoanIds.has(listedLoan.id)) return;
      const loan = { id: loanSnapshot.id, ...loanSnapshot.data() };
      if (loan.status !== 'ACTIVE' || Number(loan.principal_balance) <= 0) return;
      const calculation = calculateProvision(loan, month, date, data.repayments, data.rules);
      if (calculation.interestAmount <= 0) return;
      const previousInterest = Number(loan.interest_balance || 0);
      const now = new Date().toISOString();
      const provision = {
        id: provisionIds[index],
        loan_id: loan.id,
        employee_id: loan.employee_id,
        provision_month: month,
        provision_date: date,
        applied_rate: calculation.rate,
        principal_amount_on_date: calculation.principal,
        interest_amount: calculation.interestAmount,
        previous_interest_balance: previousInterest,
        new_interest_balance: previousInterest + calculation.interestAmount,
        is_deleted: false,
        created_at: now
      };
      records.push({ loan, provision });
      transaction.create(collection('interest_provisions').doc(provision.id), provision);
      transaction.update(collection('loans').doc(loan.id), {
        interest_balance: provision.new_interest_balance,
        updated_at: now
      });
      count++;
      totalInterest += calculation.interestAmount;
    });
    return { count, totalInterest };
  });
  if (result.count) {
    await writeAudit(user, 'PROVISION', 'INTEREST_PROVISION', month,
      `Monthly provision ${month}: ${result.count} loans, ${result.totalInterest}`);
  }
  return result;
}

router.post('/run-monthly', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const { provision_month: month, provision_date: date } = req.body || {};
    if (!validMonth(month) || !validDate(date)
      || date.slice(0, 7) !== month) {
      return res.status(400).json({ success: false, message: 'সঠিক প্রভিশন মাস এবং তারিখ প্রদান করুন।' });
    }
    const data = await loadProvisionData();
    const result = await runMonth(month, date, req.user, data);
    res.json({
      success: true,
      message: result.count
        ? `${month} মাসের জন্য ${result.count} টি ঋণে সর্বমোট ${result.totalInterest} টাকা সুদ প্রভিশন করা হয়েছে।`
        : 'এই মাসের জন্য সকল প্রযোজ্য ঋণের সুদ ইতিমধ্যে প্রভিশন করা হয়েছে অথবা কোনো যোগ্য ঋণ নেই।',
      count: result.count,
      totalInterest: result.totalInterest
    });
  } catch (error) {
    next(error);
  }
});

router.post('/auto-sync', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const data = await loadProvisionData();
    const months = new Set(data.repayments
      .filter(repayment => repayment.is_deleted !== true && validMonth(repayment.deduction_month))
      .map(repayment => repayment.deduction_month));
    months.add(new Date().toISOString().slice(0, 7));
    let totalProcessed = 0;
    let totalInterestAdded = 0;
    const processedMonths = [];
    for (const month of [...months].sort()) {
      const result = await runMonth(month, new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)
        .toISOString().slice(0, 10), req.user, data);
      if (result.count) {
        totalProcessed += result.count;
        totalInterestAdded += result.totalInterest;
        processedMonths.push(month);
      }
    }
    res.json({
      success: true,
      message: totalProcessed
        ? `সর্বমোট ${totalProcessed} টি ঋণে ${totalInterestAdded} টাকা সুদ অটো প্রভিশন সম্পন্ন হয়েছে।`
        : 'সকল ঋণের সুদ পূর্ব থেকেই স্বয়ংক্রিয়ভাবে প্রভিশন করা রয়েছে।',
      result: { totalProcessed, totalInterestAdded, processedMonths }
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const provisionRef = collection('interest_provisions').doc(String(req.params.id));
    const provisionSnapshot = await provisionRef.get();
    if (!provisionSnapshot.exists || provisionSnapshot.get('is_deleted') === true) {
      return res.status(404).json({ success: false, message: 'প্রভিশন রেকর্ড খুঁজে পাওয়া যায়নি।' });
    }
    const provision = { id: provisionSnapshot.id, ...provisionSnapshot.data() };
    const loanRef = collection('loans').doc(String(provision.loan_id));
    const loan = await getDb().runTransaction(async transaction => {
      const [currentProvision, loanSnapshot] = await Promise.all([
        transaction.get(provisionRef),
        transaction.get(loanRef)
      ]);
      if (!currentProvision.exists || currentProvision.get('is_deleted') === true) {
        throw new Error('প্রভিশন রেকর্ড খুঁজে পাওয়া যায়নি।');
      }
      if (!loanSnapshot.exists) throw new Error('সংশ্লিষ্ট ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।');
      const currentLoan = { id: loanSnapshot.id, ...loanSnapshot.data() };
      const now = new Date().toISOString();
      transaction.update(provisionRef, { is_deleted: true, deleted_at: now, deleted_by: req.user.username });
      transaction.update(loanRef, {
        interest_balance: Math.max(0, Number(currentLoan.interest_balance || 0) - Number(provision.interest_amount || 0)),
        updated_at: now
      });
      return currentLoan;
    });
    await writeAudit(req.user, 'DELETE', 'INTEREST_PROVISION', provision.id,
      `Provision reversed: ${loan.loan_no}, ${provision.provision_month}, ${provision.interest_amount}`);
    res.json({ success: true, message: 'সুদ প্রভিশন সফলভাবে বাতিল এবং ঋণ ব্যালেন্স সমন্বয় করা হয়েছে।' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
