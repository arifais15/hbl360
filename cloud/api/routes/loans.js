const express = require('express');
const { authenticateToken, requireRole } = require('../lib/auth');
const { collection } = require('../lib/firestore');
const { allocateId, getDb, getRecord, listRecords, writeAudit } = require('../lib/records');

const router = express.Router();
const staffRoles = ['admin', 'accounts'];

function isFiniteNumber(value) {
  return value !== '' && Number.isFinite(Number(value));
}

function loanRelations(loan, employee, otherPbs, repayments) {
  const loanRepayments = repayments.filter(repayment => repayment.loan_id === loan.id);
  return {
    ...loan,
    emp_code: employee?.emp_code,
    emp_name: employee?.name,
    designation: employee?.designation,
    department: employee?.department,
    mobile: employee?.mobile,
    current_posting_pbs: employee?.current_posting_pbs,
    other_pbs_short: otherPbs?.short_name || null,
    other_pbs_full_name: otherPbs?.pbs_name || null,
    other_bank_name: otherPbs?.bank_name || null,
    other_account_no: otherPbs?.account_no || null,
    repayments_count: loanRepayments.length,
    first_deduction_month: loanRepayments.map(repayment => repayment.deduction_month).sort()[0] || null,
    last_deduction_month: loanRepayments.map(repayment => repayment.deduction_month).sort().at(-1) || null
  };
}

async function getLoanViewData() {
  const [loans, employees, otherPbs, repayments] = await Promise.all([
    listRecords('loans'),
    listRecords('employees'),
    listRecords('other_pbs'),
    listRecords('repayments')
  ]);
  return {
    loans,
    employeesById: new Map(employees.map(employee => [employee.id, employee])),
    otherPbsById: new Map(otherPbs.map(pbs => [pbs.id, pbs])),
    repayments
  };
}

router.get('/my-loans', authenticateToken, async (req, res, next) => {
  try {
    if (!req.user.employeeId) {
      return res.status(400).json({ success: false, message: 'লগইনকৃত অ্যাকাউন্টের সাথে কোনো কর্মচারী প্রোফাইল যুক্ত নেই।' });
    }
    const data = await getLoanViewData();
    const employee = data.employeesById.get(req.user.employeeId);
    if (!employee) {
      return res.status(404).json({ success: false, message: 'কর্মচারী প্রোফাইল পাওয়া যায়নি।' });
    }
    const loans = data.loans
      .filter(loan => loan.employee_id === employee.id)
      .map(loan => ({
        ...loanRelations(loan, employee, data.otherPbsById.get(loan.origin_pbs_id), data.repayments),
        repayments_count: data.repayments.filter(repayment => repayment.loan_id === loan.id && repayment.employee_id === employee.id).length
      }))
      .sort((left, right) => String(right.disbursement_date || '').localeCompare(String(left.disbursement_date || '')));
    const repayments = data.repayments
      .filter(repayment => repayment.employee_id === employee.id)
      .map(repayment => {
        const loan = data.loans.find(item => item.id === repayment.loan_id);
        return { ...repayment, loan_no: loan?.loan_no || '', loan_lot_name: loan?.loan_lot_name || '' };
      })
      .sort((left, right) => String(right.deduction_month || '').localeCompare(String(left.deduction_month || '')))
      .slice(0, 24);
    res.json({ success: true, loans, repayments });
  } catch (error) {
    next(error);
  }
});

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const data = await getLoanViewData();
    const search = String(req.query.search || '').toLocaleLowerCase();
    let loans = data.loans
      .filter(loan => data.employeesById.has(loan.employee_id))
      .map(loan => loanRelations(loan, data.employeesById.get(loan.employee_id), data.otherPbsById.get(loan.origin_pbs_id), data.repayments));
    if (req.user.role === 'employee') {
      loans = loans.filter(loan => loan.employee_id === req.user.employeeId);
    }
    if (req.query.sourceType === 'OWN_PBS' || req.query.sourceType === 'OTHER_PBS') {
      loans = loans.filter(loan => loan.loan_source_type === req.query.sourceType);
    }
    if (req.query.status) {
      loans = loans.filter(loan => loan.status === req.query.status);
    }
    if (req.query.employeeId) {
      loans = loans.filter(loan => loan.employee_id === String(req.query.employeeId));
    }
    if (search) {
      loans = loans.filter(loan => [loan.loan_no, loan.sanction_no, loan.emp_code, loan.emp_name]
        .some(value => String(value || '').toLocaleLowerCase().includes(search)));
    }
    loans.sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
    const summary = {
      totalLoans: loans.length,
      totalDisbursed: loans.reduce((sum, loan) => sum + Number(loan.disbursed_amount || 0), 0),
      totalPrincipalBalance: loans.reduce((sum, loan) => sum + Number(loan.principal_balance || 0), 0),
      totalInterestBalance: loans.reduce((sum, loan) => sum + Number(loan.interest_balance || 0), 0),
      ownPbsCount: loans.filter(loan => loan.loan_source_type === 'OWN_PBS').length,
      otherPbsCount: loans.filter(loan => loan.loan_source_type === 'OTHER_PBS').length
    };
    res.json({ success: true, loans, summary });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const loan = await getRecord('loans', req.params.id);
    if (!loan) {
      return res.status(404).json({ success: false, message: 'ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।' });
    }
    if (req.user.role === 'employee' && req.user.employeeId !== loan.employee_id) {
      return res.status(403).json({ success: false, message: 'এই ঋণের তথ্য দেখার অনুমতি আপনার নেই।' });
    }
    const data = await getLoanViewData();
    const repayments = data.repayments
      .filter(record => record.loan_id === loan.id)
      .sort((left, right) => String(left.deduction_month || '').localeCompare(String(right.deduction_month || ''))
        || String(left.deduction_date || '').localeCompare(String(right.deduction_date || '')));
    const provisions = (await listRecords('interest_provisions'))
      .filter(record => record.loan_id === loan.id)
      .sort((left, right) => String(left.provision_month || '').localeCompare(String(right.provision_month || '')));
    res.json({
      success: true,
      loan: loanRelations(loan, data.employeesById.get(loan.employee_id), data.otherPbsById.get(loan.origin_pbs_id), data.repayments),
      repayments,
      provisions
    });
  } catch (error) {
    next(error);
  }
});

router.post('/', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const body = req.body || {};
    const loanNo = typeof body.loan_no === 'string' ? body.loan_no.trim() : '';
    const employeeId = String(body.employee_id || '');
    const sourceType = body.loan_source_type || 'OWN_PBS';
    const isOtherPbs = sourceType === 'OTHER_PBS';
    if (!loanNo || !employeeId
      || !isFiniteNumber(body.sanction_amount) || !isFiniteNumber(body.disbursed_amount)
      || !isFiniteNumber(body.monthly_installment)) {
      return res.status(400).json({ success: false, message: 'সকল আবশ্যকীয় তথ্য পূরণ করুন।' });
    }
    if (!['OWN_PBS', 'OTHER_PBS'].includes(sourceType)) {
      return res.status(400).json({ success: false, message: 'ঋণের উৎস সঠিকভাবে নির্বাচন করুন।' });
    }
    const today = new Date().toISOString().slice(0, 10);
    const sanctionDate = body.sanction_date || (isOtherPbs ? today : '');
    const disbursementDate = body.disbursement_date || (isOtherPbs ? sanctionDate : '');
    if (!sanctionDate || !disbursementDate) {
      return res.status(400).json({ success: false, message: 'মঞ্জুরির তারিখ ও বিতরণের তারিখ প্রদান করুন।' });
    }

    const id = await allocateId('loans');
    const loanRef = collection('loans').doc(id);
    const employeeRef = collection('employees').doc(employeeId);
    const otherPbsId = isOtherPbs && body.origin_pbs_id ? String(body.origin_pbs_id) : null;
    const otherPbsRef = otherPbsId ? collection('other_pbs').doc(otherPbsId) : null;
    let appliedRate = 0;
    if (!isOtherPbs) {
      appliedRate = body.custom_interest_rate === undefined || body.custom_interest_rate === ''
        ? (new Date(disbursementDate) < new Date('2020-01-01') ? 8 : 7)
        : Number(body.custom_interest_rate);
    }
    if (!Number.isFinite(appliedRate) || appliedRate < 0 || appliedRate > 100) {
      return res.status(400).json({ success: false, message: 'সুদের হার সঠিকভাবে দিন।' });
    }
    const principal = Number(body.disbursed_amount);
    const openingPrincipal = body.has_opening_balance || body.opening_principal_balance !== undefined
      ? Math.max(0, Number(body.opening_principal_balance || 0))
      : null;
    const openingInterest = openingPrincipal === null ? null : Math.max(0, Number(body.opening_interest_balance || 0));
    const settingsRef = collection('pbs_settings').doc('default');
    await getDb().runTransaction(async transaction => {
      const [employeeSnapshot, loanSnapshot, pbsSnapshot, settingsSnapshot] = await Promise.all([
        transaction.get(employeeRef),
        transaction.get(collection('loans').where('loan_no', '==', loanNo).limit(10)),
        otherPbsRef ? transaction.get(otherPbsRef) : Promise.resolve(null),
        transaction.get(settingsRef)
      ]);
      if (!employeeSnapshot.exists || employeeSnapshot.get('is_deleted') === true) {
        const missing = new Error('Employee does not exist.');
        missing.code = 'EMPLOYEE_MISSING';
        throw missing;
      }
      if (loanSnapshot.docs.some(document => document.get('is_deleted') !== true)) {
        const conflict = new Error('Loan number already exists.');
        conflict.code = 'LOAN_DUPLICATE';
        throw conflict;
      }
      if (otherPbsRef && !pbsSnapshot.exists) {
        const missing = new Error('Other PBS does not exist.');
        missing.code = 'PBS_MISSING';
        throw missing;
      }
      const data = {
        loan_no: loanNo,
        employee_id: employeeId,
        loan_lot_name: String(body.loan_lot_name || '১ম ঋণ').trim(),
        loan_source_type: sourceType,
        origin_pbs_id: otherPbsId,
        origin_pbs_name: isOtherPbs
          ? (pbsSnapshot?.get('pbs_name') || String(body.origin_pbs_name || 'অন্য পবিস').trim())
          : (settingsSnapshot.exists ? settingsSnapshot.get('pbs_name') : 'নিজস্ব পবিস'),
        sanction_no: String(body.sanction_no || (isOtherPbs ? 'অন্য পবিস' : '')).trim(),
        sanction_date: sanctionDate,
        disbursement_date: disbursementDate,
        sanction_amount: Number(body.sanction_amount),
        disbursed_amount: principal,
        monthly_installment: Number(body.monthly_installment),
        interest_rate: appliedRate,
        is_interest_applicable: isOtherPbs ? 0 : 1,
        principal_balance: openingPrincipal === null ? principal : openingPrincipal,
        interest_balance: openingPrincipal === null ? Number(body.initial_interest_balance || 0) : openingInterest,
        total_principal_paid: openingPrincipal === null ? 0 : Math.max(0, principal - openingPrincipal),
        total_interest_paid: 0,
        advance_balance: 0,
        status: 'ACTIVE',
        remarks: String(body.remarks || ''),
        opening_balance_as_of: openingPrincipal === null ? null : (body.opening_balance_as_of || disbursementDate),
        opening_principal_balance: openingPrincipal,
        opening_interest_balance: openingInterest,
        salary_deduction_suspended: false,
        is_deleted: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      transaction.create(loanRef, data);
    });
    await writeAudit(req.user, 'CREATE', 'LOAN', id, `Loan created: ${loanNo}`);
    res.json({ success: true, message: 'গৃহ ঋণ সফলভাবে অন্তর্ভুক্ত করা হয়েছে।', id, interestRate: appliedRate, isInterestApplicable: isOtherPbs ? 0 : 1 });
  } catch (error) {
    if (error.code === 'EMPLOYEE_MISSING') {
      return res.status(400).json({ success: false, message: 'কর্মচারী খুঁজে পাওয়া যায়নি।' });
    }
    if (error.code === 'LOAN_DUPLICATE') {
      return res.status(400).json({ success: false, message: 'এই ঋণ হিসাব নম্বর (Loan No) ইতিমধ্যে বিদ্যমান।' });
    }
    if (error.code === 'PBS_MISSING') {
      return res.status(400).json({ success: false, message: 'অন্যান্য পবিস খুঁজে পাওয়া যায়নি।' });
    }
    next(error);
  }
});

router.put('/:id', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const existing = await getRecord('loans', req.params.id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।' });
    }
    const body = req.body || {};
    const numericFields = ['sanction_amount', 'disbursed_amount', 'monthly_installment', 'custom_interest_rate', 'interest_rate'];
    if (numericFields.some(field => body[field] !== undefined && body[field] !== '' && !isFiniteNumber(body[field]))) {
      return res.status(400).json({ success: false, message: 'ঋণের সংখ্যাগত তথ্য সঠিকভাবে দিন।' });
    }
    const updateFields = [
      'employee_id', 'loan_no', 'loan_lot_name', 'loan_source_type', 'origin_pbs_id', 'origin_pbs_name',
      'sanction_no', 'sanction_date', 'disbursement_date', 'sanction_amount', 'disbursed_amount',
      'monthly_installment', 'status', 'remarks', 'opening_balance_as_of', 'opening_principal_balance',
      'opening_interest_balance'
    ];
    const update = {};
    for (const field of updateFields) {
      if (body[field] !== undefined) update[field] = body[field];
    }
    if (update.employee_id !== undefined) update.employee_id = String(update.employee_id);
    if (body.custom_interest_rate !== undefined || body.interest_rate !== undefined || body.loan_source_type !== undefined) {
      const sourceType = body.loan_source_type || existing.loan_source_type;
      update.interest_rate = sourceType === 'OTHER_PBS'
        ? 0
        : Number(body.custom_interest_rate ?? body.interest_rate ?? existing.interest_rate ?? 7);
      update.is_interest_applicable = sourceType === 'OTHER_PBS' ? 0 : 1;
    }
    if (body.disbursed_amount !== undefined) {
      const repayments = (await listRecords('repayments')).filter(item => item.loan_id === existing.id);
      const principalPaid = repayments.reduce((sum, item) => sum + Number(item.principal_paid || 0), 0);
      update.principal_balance = Math.max(0, Number(body.disbursed_amount) - principalPaid);
    }
    update.updated_at = new Date().toISOString();
    await getDb().runTransaction(async transaction => {
      const loanRef = collection('loans').doc(existing.id);
      const [current, matching] = await Promise.all([
        transaction.get(loanRef),
        update.loan_no && update.loan_no !== existing.loan_no
          ? transaction.get(collection('loans').where('loan_no', '==', String(update.loan_no).trim()).limit(10))
          : Promise.resolve(null)
      ]);
      if (!current.exists || current.get('is_deleted') === true) {
        const missing = new Error('Loan does not exist.');
        missing.code = 'LOAN_MISSING';
        throw missing;
      }
      if (matching?.docs.some(document => document.id !== existing.id && document.get('is_deleted') !== true)) {
        const conflict = new Error('Loan number already exists.');
        conflict.code = 'LOAN_DUPLICATE';
        throw conflict;
      }
      transaction.update(loanRef, update);
    });
    await writeAudit(req.user, 'UPDATE', 'LOAN', existing.id, `Loan updated: ${update.loan_no || existing.loan_no}`);
    res.json({ success: true, message: 'ঋণের তথ্য সফলভাবে হালনাগাদ করা হয়েছে।' });
  } catch (error) {
    if (error.code === 'LOAN_MISSING') {
      return res.status(404).json({ success: false, message: 'ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।' });
    }
    if (error.code === 'LOAN_DUPLICATE') {
      return res.status(400).json({ success: false, message: 'এই ঋণ হিসাব নম্বর (Loan No) ইতিমধ্যে বিদ্যমান।' });
    }
    next(error);
  }
});

router.delete('/:id', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const loan = await getRecord('loans', req.params.id);
    if (!loan) {
      return res.status(404).json({ success: false, message: 'ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।' });
    }
    const now = new Date().toISOString();
    await collection('loans').doc(loan.id).update({
      is_deleted: true, deleted_at: now, deleted_by: req.user.username, updated_at: now
    });
    await writeAudit(req.user, 'DELETE', 'LOAN', loan.id, `Loan moved to recycle bin: ${loan.loan_no}`);
    res.json({ success: true, message: 'ঋণ রেকর্ডটি সফলভাবে রিসাইকেল বিনে পাঠানো হয়েছে।' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
