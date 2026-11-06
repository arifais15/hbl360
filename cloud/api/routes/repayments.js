const express = require('express');
const { randomUUID } = require('node:crypto');
const { authenticateToken, requireRole } = require('../lib/auth');
const { collection } = require('../lib/firestore');
const { allocateId, getDb, getRecord, listRecords, writeAudit } = require('../lib/records');

const router = express.Router();
const staffRoles = ['admin', 'accounts'];
const ALLOWED_METHODS = new Set(['SALARY_DEDUCTION', 'BANK_DEPOSIT', 'CASH', 'LUMPSUM_SETTLEMENT', 'INTER_PBS_COLLECTION']);

function distribute(amount, principal, interest) {
  const requestedAmount = Math.max(0, Number(amount) || 0);
  const principalBalance = Math.max(0, Number(principal) || 0);
  const interestBalance = Math.max(0, Number(interest) || 0);
  const appliedAmount = Math.min(requestedAmount, principalBalance + interestBalance);
  const principalPaid = Math.min(appliedAmount, principalBalance);
  const interestPaid = Math.min(appliedAmount - principalPaid, interestBalance);
  return {
    principalPaid: Math.round(principalPaid),
    interestPaid: Math.round(interestPaid),
    newPrincipalBalance: Math.round(principalBalance - principalPaid),
    newInterestBalance: Math.round(interestBalance - interestPaid),
    appliedAmount: Math.round(appliedAmount),
    unappliedAmount: Math.round(requestedAmount - appliedAmount)
  };
}

function repaymentDocument(loan, body, distribution, id, batchId = null) {
  const otherPbsRepayment = loan.loan_source_type === 'OTHER_PBS';
  return {
    id,
    loan_id: loan.id,
    employee_id: loan.employee_id,
    deduction_month: body.deduction_month,
    deduction_date: body.deduction_date,
    voucher_no: String(body.voucher_no || ''),
    total_amount: Number(body.amount),
    principal_paid: distribution.principalPaid,
    interest_paid: distribution.interestPaid,
    advance_paid: distribution.unappliedAmount,
    previous_principal_balance: Number(loan.principal_balance || 0),
    new_principal_balance: distribution.newPrincipalBalance,
    previous_interest_balance: Number(loan.interest_balance || 0),
    new_interest_balance: distribution.newInterestBalance,
    repayment_method: body.repayment_method || 'SALARY_DEDUCTION',
    collection_batch_id: batchId,
    remittance_status: otherPbsRepayment ? 'PENDING' : 'NOT_APPLICABLE',
    bank_advice_id: null,
    principal_posting: body.principal_posting || null,
    interest_posting: body.interest_posting || null,
    remarks: String(body.remarks || ''),
    is_deleted: false,
    created_at: new Date().toISOString()
  };
}

async function postOneRepayment(loanId, body, user, { allowSuspended = false, batchId = null } = {}) {
  const repaymentId = await allocateId('repayments');
  const repaymentRef = collection('repayments').doc(repaymentId);
  const loanRef = collection('loans').doc(String(loanId));
  const result = await getDb().runTransaction(async transaction => {
    const loanSnapshot = await transaction.get(loanRef);
    if (!loanSnapshot.exists || loanSnapshot.get('is_deleted') === true) {
      throw new Error('ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।');
    }
    const loan = { id: loanSnapshot.id, ...loanSnapshot.data() };
    const method = body.repayment_method || 'SALARY_DEDUCTION';
    if (!ALLOWED_METHODS.has(method)) throw new Error('কিস্তি আদায়ের পদ্ধতি সঠিক নয়।');
    if (loan.salary_deduction_suspended && method === 'SALARY_DEDUCTION' && !allowSuspended) {
      throw new Error('এই ঋণের নিয়মিত বেতন হতে কিস্তি কর্তন স্থগিত রয়েছে।');
    }
    const existing = await transaction.get(collection('repayments').where('loan_id', '==', loan.id));
    const duplicate = existing.docs.find(document => document.get('is_deleted') !== true
      && document.get('deduction_month') === body.deduction_month);
    if (duplicate) {
      throw new Error(`ডুপ্লিকেট প্রতিরোধ: ${body.deduction_month} মাসের কিস্তি ইতোমধ্যে পোস্টিং করা হয়েছে।`);
    }

    const distribution = distribute(body.amount, loan.principal_balance, loan.interest_balance);
    const repayment = repaymentDocument(loan, body, distribution, repaymentId, batchId);
    const now = new Date().toISOString();
    transaction.create(repaymentRef, repayment);
    transaction.update(loanRef, {
      principal_balance: distribution.newPrincipalBalance,
      interest_balance: distribution.newInterestBalance,
      total_principal_paid: Number(loan.total_principal_paid || 0) + distribution.principalPaid,
      total_interest_paid: Number(loan.total_interest_paid || 0) + distribution.interestPaid,
      advance_balance: Number(loan.advance_balance || 0) + distribution.unappliedAmount,
      status: distribution.newPrincipalBalance <= 0 && distribution.newInterestBalance <= 0 ? 'CLOSED' : 'ACTIVE',
      updated_at: now
    });
    return { repaymentId, loan, distribution, remittanceStatus: repayment.remittance_status };
  });
  return result;
}

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const [repayments, loans, employees, bankAdvices] = await Promise.all([
      listRecords('repayments'),
      listRecords('loans'),
      listRecords('employees'),
      listRecords('bank_advices')
    ]);
    const loansById = new Map(loans.map(loan => [loan.id, loan]));
    const employeesById = new Map(employees.map(employee => [employee.id, employee]));
    const advicesById = new Map(bankAdvices.map(advice => [advice.id, advice]));
    let rows = repayments
      .filter(repayment => loansById.has(repayment.loan_id) && employeesById.has(repayment.employee_id))
      .map(repayment => {
        const loan = loansById.get(repayment.loan_id);
        const employee = employeesById.get(repayment.employee_id);
        const advice = advicesById.get(repayment.bank_advice_id);
        return {
          ...repayment,
          loan_no: loan.loan_no,
          loan_lot_name: loan.loan_lot_name,
          loan_source_type: loan.loan_source_type,
          origin_pbs_name: loan.origin_pbs_name,
          emp_code: employee.emp_code,
          emp_name: employee.name,
          designation: employee.designation,
          advice_no: advice?.advice_no || null,
          memo_no: advice?.memo_no || null
        };
      });
    if (req.user.role === 'employee') rows = rows.filter(row => row.employee_id === req.user.employeeId);
    else if (req.query.employeeId) rows = rows.filter(row => row.employee_id === String(req.query.employeeId));
    if (req.query.loanId) rows = rows.filter(row => row.loan_id === String(req.query.loanId));
    if (req.query.month) rows = rows.filter(row => row.deduction_month === req.query.month);
    if (req.query.remittanceStatus) rows = rows.filter(row => row.remittance_status === req.query.remittanceStatus);
    if (req.query.search) {
      const search = String(req.query.search).toLocaleLowerCase();
      rows = rows.filter(row => [row.loan_no, row.emp_code, row.emp_name, row.voucher_no]
        .some(value => String(value || '').toLocaleLowerCase().includes(search)));
    }
    rows.sort((left, right) => String(right.deduction_month || '').localeCompare(String(left.deduction_month || ''))
      || String(right.created_at || '').localeCompare(String(left.created_at || '')));
    const summary = {
      totalCount: rows.length,
      totalAmount: rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0),
      totalPrincipal: rows.reduce((sum, row) => sum + Number(row.principal_paid || 0), 0),
      totalInterest: rows.reduce((sum, row) => sum + Number(row.interest_paid || 0), 0)
    };
    res.json({ success: true, repayments: rows, summary });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.loan_id || !body.deduction_month || !body.deduction_date
      || !Number.isFinite(Number(body.amount)) || Number(body.amount) <= 0) {
      return res.status(400).json({ success: false, message: 'সকল প্রয়োজনীয় তথ্য এবং সঠিক টাকার পরিমাণ প্রদান করুন।' });
    }
    const result = await postOneRepayment(body.loan_id, body, req.user, {
      allowSuspended: body.allow_suspended_repayment === true
    });
    await writeAudit(req.user, 'CREATE', 'REPAYMENT', result.repaymentId,
      `Repayment ${body.deduction_month}: ${body.amount} (principal ${result.distribution.principalPaid}, interest ${result.distribution.interestPaid})`);
    res.json({
      success: true,
      message: 'কিস্তির অর্থ সফলভাবে পোস্ট করা হয়েছে.',
      id: result.repaymentId,
      distribution: result.distribution
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'কিস্তি সংরক্ষণ ব্যর্থ হয়েছে।' });
  }
});

router.post('/batch', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const { deduction_month: month, deduction_date: date, voucher_no: voucher, loan_ids: selectedIds } = req.body || {};
    if (!month || !date) {
      return res.status(400).json({ success: false, message: 'কর্তনের মাস এবং তারিখ নির্বাচন করুন।' });
    }
    if (!Array.isArray(selectedIds) || !selectedIds.length || selectedIds.length > 200) {
      return res.status(400).json({ success: false, message: 'ব্যাচ কর্তনের জন্য ১ থেকে ২০০টি ঋণ নির্বাচন করুন।' });
    }
    const [loans, employees, repayments] = await Promise.all([
      listRecords('loans'),
      listRecords('employees'),
      listRecords('repayments')
    ]);
    const employeesById = new Map(employees.map(employee => [employee.id, employee]));
    const alreadyPosted = new Set(repayments
      .filter(repayment => repayment.deduction_month === month)
      .map(repayment => repayment.loan_id));
    const selected = new Set(selectedIds.map(String));
    const eligible = loans.filter(loan => loan.status === 'ACTIVE'
      && loan.salary_deduction_suspended !== true
      && employeesById.has(loan.employee_id)
      && !alreadyPosted.has(loan.id)
      && selected.has(loan.id));
    const repaymentIds = eligible.map(() => collection('repayments').doc().id);
    const result = await getDb().runTransaction(async transaction => {
      const loansById = new Map();
      const existingByLoan = new Map();
      const snapshots = await Promise.all(eligible.flatMap(loan => [
        transaction.get(collection('loans').doc(loan.id)),
        transaction.get(collection('repayments').where('loan_id', '==', loan.id))
      ]));
      for (let index = 0; index < eligible.length; index++) {
        loansById.set(eligible[index].id, snapshots[index * 2]);
        existingByLoan.set(eligible[index].id, snapshots[index * 2 + 1]);
      }

      let totalDeducted = 0;
      let totalAdvancePaid = 0;
      let count = 0;
      eligible.forEach((listedLoan, index) => {
        const loanSnapshot = loansById.get(listedLoan.id);
        if (!loanSnapshot.exists || loanSnapshot.get('is_deleted') === true) return;
        const loan = { id: loanSnapshot.id, ...loanSnapshot.data() };
        if (existingByLoan.get(loan.id).docs.some(document => document.get('is_deleted') !== true
          && document.get('deduction_month') === month)) {
          throw new Error(`ঋণ নং ${loan.loan_no} এর ${month} মাসের কিস্তি ইতোমধ্যে পোস্টিং করা হয়েছে।`);
        }
        const amount = Number(loan.monthly_installment);
        if (!Number.isFinite(amount) || amount <= 0 || loan.salary_deduction_suspended === true) return;
        const distribution = distribute(amount, loan.principal_balance, loan.interest_balance);
        const repayment = repaymentDocument(loan, {
          deduction_month: month,
          deduction_date: date,
          voucher_no: voucher || `SALARY-${month}`,
          amount,
          repayment_method: 'SALARY_DEDUCTION',
          remarks: `${month} মাসের বেতন হতে মাসিক কিস্তি কর্তন`
        }, distribution, repaymentIds[index]);
        transaction.create(collection('repayments').doc(repaymentIds[index]), repayment);
        transaction.update(collection('loans').doc(loan.id), {
          principal_balance: distribution.newPrincipalBalance,
          interest_balance: distribution.newInterestBalance,
          total_principal_paid: Number(loan.total_principal_paid || 0) + distribution.principalPaid,
          total_interest_paid: Number(loan.total_interest_paid || 0) + distribution.interestPaid,
          advance_balance: Number(loan.advance_balance || 0) + distribution.unappliedAmount,
          status: distribution.newPrincipalBalance <= 0 && distribution.newInterestBalance <= 0 ? 'CLOSED' : 'ACTIVE',
          updated_at: new Date().toISOString()
        });
        totalDeducted += amount;
        totalAdvancePaid += distribution.unappliedAmount;
        count++;
      });
      return { totalDeducted, totalAdvancePaid, count };
    });
    const { totalDeducted, totalAdvancePaid, count } = result;
    await writeAudit(req.user, 'BATCH_DEDUCT', 'REPAYMENT', month, `Monthly batch repayment: ${count} loans, ${totalDeducted}`);
    res.json({
      success: true,
      message: `${count} টি ঋণের কিস্তি সফলভাবে কর্তন করা হয়েছে (সর্বমোট: ${totalDeducted} টাকা)।`,
      count,
      totalDeducted,
      totalAdvancePaid
    });
  } catch (error) {
    next(error);
  }
});

router.post('/multi-month', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.loan_id || !body.receipt_date || !Array.isArray(body.schedule) || !body.schedule.length) {
      return res.status(400).json({ success: false, message: 'ঋণ, প্রাপ্তির তারিখ এবং কিস্তির শিডিউল আবশ্যক।' });
    }
    if (body.schedule.length > 400) {
      return res.status(400).json({ success: false, message: 'একবারে সর্বোচ্চ ৪০০ মাসের পোস্টিং করা যাবে।' });
    }
    const months = new Set();
    for (const item of body.schedule) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(item.deduction_month || '') || months.has(item.deduction_month)
        || !Number.isFinite(Number(item.amount)) || Number(item.amount) <= 0) {
        return res.status(400).json({ success: false, message: 'শিডিউলে মাস অথবা টাকার পরিমাণ সঠিক নয়।' });
      }
      months.add(item.deduction_month);
    }
    const loanRef = collection('loans').doc(String(body.loan_id));
    const sortedSchedule = [...body.schedule].sort((a, b) => a.deduction_month.localeCompare(b.deduction_month));
    const batchId = randomUUID();
    const ids = sortedSchedule.map(() => collection('repayments').doc().id);
    const result = await getDb().runTransaction(async transaction => {
      const [loanSnapshot, existingSnapshot] = await Promise.all([
        transaction.get(loanRef),
        transaction.get(collection('repayments').where('loan_id', '==', String(body.loan_id)))
      ]);
      if (!loanSnapshot.exists || loanSnapshot.get('is_deleted') === true) {
        throw new Error('ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।');
      }
      const existingMonths = new Set(existingSnapshot.docs
        .filter(document => document.get('is_deleted') !== true)
        .map(document => document.get('deduction_month')));
      const duplicate = sortedSchedule.find(item => existingMonths.has(item.deduction_month));
      if (duplicate) throw new Error(`${duplicate.deduction_month} মাসের কিস্তি ইতিপূর্বে পোস্টিং করা হয়েছে।`);

      const loan = { id: loanSnapshot.id, ...loanSnapshot.data() };
      let principal = Number(loan.principal_balance || 0);
      let interest = Number(loan.interest_balance || 0);
      let totalPrincipal = 0;
      let totalInterest = 0;
      let totalAdvance = 0;
      let totalAmount = 0;
      const items = [];
      const now = new Date().toISOString();
      sortedSchedule.forEach((item, index) => {
        const amount = Number(item.amount);
        const distribution = distribute(amount, principal, interest);
        const repaymentId = ids[index];
        const repayment = repaymentDocument(loan, {
          ...item,
          amount,
          deduction_date: body.receipt_date,
          voucher_no: item.voucher_no || body.bank_advice_no || `BA-${body.receipt_date.slice(0, 7).replace('-', '')}`,
          repayment_method: body.repayment_method || 'INTER_PBS_COLLECTION',
          remarks: item.remarks || (body.source_pbs_name ? `${body.source_pbs_name} হতে রেমিট্যান্স প্রাপ্তি` : 'অন্য পবিস হতে রেমিট্যান্স প্রাপ্তি')
        }, { ...distribution, newPrincipalBalance: distribution.newPrincipalBalance, newInterestBalance: distribution.newInterestBalance }, repaymentId, batchId);
        repayment.previous_principal_balance = principal;
        repayment.new_principal_balance = distribution.newPrincipalBalance;
        repayment.previous_interest_balance = interest;
        repayment.new_interest_balance = distribution.newInterestBalance;
        transaction.create(collection('repayments').doc(repaymentId), repayment);
        items.push({
          id: repaymentId,
          month: item.deduction_month,
          amount,
          principalPaid: distribution.principalPaid,
          interestPaid: distribution.interestPaid,
          advancePaid: distribution.unappliedAmount,
          newPrincipalBalance: distribution.newPrincipalBalance,
          newInterestBalance: distribution.newInterestBalance
        });
        principal = distribution.newPrincipalBalance;
        interest = distribution.newInterestBalance;
        totalAmount += amount;
        totalPrincipal += distribution.principalPaid;
        totalInterest += distribution.interestPaid;
        totalAdvance += distribution.unappliedAmount;
      });
      transaction.update(loanRef, {
        principal_balance: principal,
        interest_balance: interest,
        total_principal_paid: Number(loan.total_principal_paid || 0) + totalPrincipal,
        total_interest_paid: Number(loan.total_interest_paid || 0) + totalInterest,
        advance_balance: Number(loan.advance_balance || 0) + totalAdvance,
        status: principal <= 0 && interest <= 0 ? 'CLOSED' : 'ACTIVE',
        updated_at: now
      });
      return { loan, items, totalAmount, totalPrincipal, totalInterest, totalAdvance, principal, interest };
    });
    await writeAudit(req.user, 'CREATE', 'REPAYMENT', result.loan.id,
      `Multi-month repayment batch ${batchId}: ${result.items.length} months, ${result.totalAmount}`);
    res.json({
      success: true,
      message: `একসাথে ${result.items.length} মাসের কিস্তি পোস্টিং সফলভাবে সম্পন্ন হয়েছে।`,
      batchId,
      summary: {
        monthsCount: result.items.length,
        totalAmount: result.totalAmount,
        totalPrincipalPaid: result.totalPrincipal,
        totalInterestPaid: result.totalInterest,
        totalAdvancePaid: result.totalAdvance,
        newPrincipalBalance: result.principal,
        newInterestBalance: result.interest,
        newStatus: result.principal <= 0 && result.interest <= 0 ? 'CLOSED' : 'ACTIVE'
      },
      items: result.items
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'মাল্টি-মান্থ কিস্তি পোস্টিং ব্যর্থ হয়েছে।' });
  }
});

async function reverseRepayments(ids, user) {
  let deletedCount = 0;
  let totalRestoredAmount = 0;
  for (const id of ids) {
    const repaymentRef = collection('repayments').doc(String(id));
    const repaymentSnapshot = await repaymentRef.get();
    if (!repaymentSnapshot.exists || repaymentSnapshot.get('is_deleted') === true) continue;
    const repayment = { id: repaymentSnapshot.id, ...repaymentSnapshot.data() };
    const loanRef = collection('loans').doc(String(repayment.loan_id));
    await getDb().runTransaction(async transaction => {
      const [currentRepayment, loanSnapshot] = await Promise.all([
        transaction.get(repaymentRef),
        transaction.get(loanRef)
      ]);
      if (!currentRepayment.exists || currentRepayment.get('is_deleted') === true) return;
      if (!loanSnapshot.exists) throw new Error('সংশ্লিষ্ট ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।');
      const loan = loanSnapshot.data();
      const principal = Number(loan.principal_balance || 0) + Number(repayment.principal_paid || 0);
      const interest = Number(loan.interest_balance || 0) + Number(repayment.interest_paid || 0);
      const now = new Date().toISOString();
      transaction.update(repaymentRef, { is_deleted: true, deleted_at: now, deleted_by: user.username });
      transaction.update(loanRef, {
        principal_balance: principal,
        interest_balance: interest,
        total_principal_paid: Math.max(0, Number(loan.total_principal_paid || 0) - Number(repayment.principal_paid || 0)),
        total_interest_paid: Math.max(0, Number(loan.total_interest_paid || 0) - Number(repayment.interest_paid || 0)),
        advance_balance: Math.max(0, Number(loan.advance_balance || 0) - Number(repayment.advance_paid || 0)),
        status: principal <= 0 && interest <= 0 ? 'CLOSED' : 'ACTIVE',
        updated_at: now
      });
    });
    deletedCount++;
    totalRestoredAmount += Number(repayment.total_amount || 0);
  }
  return { deletedCount, totalRestoredAmount };
}

router.delete('/:id', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const result = await reverseRepayments([req.params.id], req.user);
    if (!result.deletedCount) {
      return res.status(404).json({ success: false, message: 'কিস্তি রেকর্ড খুঁজে পাওয়া যায়নি।' });
    }
    await writeAudit(req.user, 'DELETE', 'REPAYMENT', req.params.id, `Repayment reversed: ${result.totalRestoredAmount}`);
    res.json({ success: true, message: 'কিস্তি কর্তন সফলভাবে বাতিল এবং ঋণ ব্যালেন্স পূর্বাবস্থায় ফিরিয়ে আনা হয়েছে।' });
  } catch (error) {
    next(error);
  }
});

router.post('/batch-delete', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 200) {
      return res.status(400).json({ success: false, message: 'মুছে ফেলার জন্য ১ থেকে ২০০টি কিস্তি নির্বাচন করুন।' });
    }
    const result = await reverseRepayments(ids, req.user);
    if (!result.deletedCount) {
      return res.status(400).json({ success: false, message: 'কোনো বৈধ কিস্তি রেকর্ড মুছে ফেলার জন্য পাওয়া যায়নি।' });
    }
    await writeAudit(req.user, 'BATCH_DELETE', 'REPAYMENTS', '', `Reversed ${result.deletedCount} repayments`);
    res.json({
      success: true,
      message: `নির্বাচিত ${result.deletedCount} টি কিস্তি সফলভাবে বাতিল এবং ঋণ ব্যালেন্স পূর্বাবস্থায় ফিরিয়ে আনা হয়েছে।`,
      deletedCount: result.deletedCount,
      totalRestoredAmount: result.totalRestoredAmount
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
