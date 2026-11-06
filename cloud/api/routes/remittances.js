const express = require('express');
const { authenticateToken, requireRole } = require('../lib/auth');
const { collection, getDb } = require('../lib/firestore');
const { allocateId, listRecords, writeAudit } = require('../lib/records');

const router = express.Router();
const staffRoles = ['admin', 'accounts'];

function bengaliDigits(value) {
  const digits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return String(value).replace(/\d/g, digit => digits[Number(digit)]);
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function formatPeriodText(fromDate, toDate, months) {
  const monthText = [...new Set(months)].sort().map(bengaliDigits).join(', ');
  if (fromDate && toDate && fromDate !== toDate) {
    return `${bengaliDigits(fromDate)} থেকে ${bengaliDigits(toDate)} (${monthText})`;
  }
  return monthText || bengaliDigits(fromDate || toDate || '');
}

async function loadRemittanceData() {
  const [repayments, loans, employees, otherPbs, advices, settings] = await Promise.all([
    listRecords('repayments', { includeDeleted: true }),
    listRecords('loans', { includeDeleted: true }),
    listRecords('employees', { includeDeleted: true }),
    listRecords('other_pbs', { includeDeleted: true }),
    listRecords('bank_advices', { includeDeleted: true }),
    collection('pbs_settings').doc('default').get()
  ]);
  return {
    repayments,
    loansById: new Map(loans.map(loan => [loan.id, loan])),
    employeesById: new Map(employees.map(employee => [employee.id, employee])),
    otherPbs,
    otherPbsById: new Map(otherPbs.map(pbs => [pbs.id, pbs])),
    advices,
    settings: settings.exists ? settings.data() : {}
  };
}

function joinRepayment(repayment, data) {
  const loan = data.loansById.get(repayment.loan_id);
  const employee = data.employeesById.get(repayment.employee_id);
  const pbs = loan && data.otherPbsById.get(loan.origin_pbs_id);
  if (!loan || !employee) return null;
  return {
    ...repayment,
    loan_id: loan.id,
    loan_no: loan.loan_no,
    sanction_no: loan.sanction_no,
    loan_lot_name: loan.loan_lot_name,
    origin_pbs_id: loan.origin_pbs_id,
    origin_pbs_name: loan.origin_pbs_name,
    emp_code: employee.emp_code,
    emp_name: employee.name,
    designation: employee.designation,
    department: employee.department,
    target_bank_name: pbs?.bank_name || '',
    target_bank_branch: pbs?.bank_branch || '',
    target_account_no: pbs?.account_no || '',
    target_routing_no: pbs?.routing_no || ''
  };
}

function groupPendingItems(items) {
  const grouped = new Map();
  for (const item of items) {
    const key = item.origin_pbs_name || '';
    if (!grouped.has(key)) {
      grouped.set(key, {
        pbsName: key,
        pbsId: item.origin_pbs_id,
        targetBank: item.target_bank_name || 'ব্যাংক তথ্য নির্ধারিত নয়',
        targetBranch: item.target_bank_branch || '',
        targetAccountNo: item.target_account_no || 'হিসাব নং নেই',
        targetRoutingNo: item.target_routing_no || '',
        totalAmount: 0,
        totalInstallmentsCount: 0,
        months: new Set(),
        dates: new Set(),
        employees: new Map(),
        repayments: []
      });
    }
    const group = grouped.get(key);
    group.totalAmount += Number(item.total_amount || 0);
    group.totalInstallmentsCount++;
    group.months.add(item.deduction_month);
    group.dates.add(item.deduction_date);
    if (!group.employees.has(item.emp_code)) {
      group.employees.set(item.emp_code, {
        empCode: item.emp_code,
        empName: item.emp_name,
        designation: item.designation,
        department: item.department,
        loanNo: item.loan_no,
        months: [],
        totalAmount: 0,
        installmentsCount: 0
      });
    }
    const employee = group.employees.get(item.emp_code);
    employee.months.push(item.deduction_month);
    employee.totalAmount += Number(item.total_amount || 0);
    employee.installmentsCount++;
    group.repayments.push(item);
  }
  return [...grouped.values()].map(group => {
    const monthsList = [...group.months].filter(Boolean).sort();
    const dates = [...group.dates].filter(Boolean).sort();
    const employees = [...group.employees.values()];
    return {
      pbsName: group.pbsName,
      pbsId: group.pbsId,
      targetBank: group.targetBank,
      targetBranch: group.targetBranch,
      targetAccountNo: group.targetAccountNo,
      targetRoutingNo: group.targetRoutingNo,
      totalAmount: group.totalAmount,
      totalInstallmentsCount: group.totalInstallmentsCount,
      distinctEmployeeCount: employees.length,
      monthsList,
      earliestDate: dates[0] || '',
      latestDate: dates[dates.length - 1] || '',
      periodText: formatPeriodText(dates[0], dates[dates.length - 1], monthsList),
      employees,
      repayments: group.repayments
    };
  });
}

router.get('/pending', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const data = await loadRemittanceData();
    const { targetPbsName, fromDate, toDate } = req.query;
    const items = data.repayments
      .filter(repayment => repayment.is_deleted !== true && repayment.remittance_status === 'PENDING')
      .map(repayment => joinRepayment(repayment, data))
      .filter(item => item && data.loansById.get(item.loan_id)?.loan_source_type === 'OTHER_PBS'
        && data.loansById.get(item.loan_id)?.is_deleted !== true
        && data.employeesById.get(item.employee_id)?.is_deleted !== true
        && (!targetPbsName || item.origin_pbs_name === targetPbsName)
        && (!fromDate || item.deduction_date >= fromDate)
        && (!toDate || item.deduction_date <= toDate))
      .sort((left, right) => String(left.origin_pbs_name).localeCompare(String(right.origin_pbs_name))
        || String(left.deduction_date).localeCompare(String(right.deduction_date)));
    res.json({ success: true, pendingList: groupPendingItems(items), totalPendingItems: items.length });
  } catch (error) {
    next(error);
  }
});

router.get('/advices', authenticateToken, async (req, res, next) => {
  try {
    const data = await loadRemittanceData();
    const activeAdvices = data.advices.filter(advice => advice.is_deleted !== true)
      .map(advice => ({
        ...advice,
        actual_item_count: data.repayments.filter(repayment => repayment.is_deleted !== true
          && repayment.bank_advice_id === advice.id).length
      }))
      .sort((left, right) => String(right.advice_date || '').localeCompare(String(left.advice_date || ''))
        || String(right.id).localeCompare(String(left.id)));
    res.json({ success: true, advices: activeAdvices });
  } catch (error) {
    next(error);
  }
});

router.get('/advices/:id', authenticateToken, async (req, res, next) => {
  try {
    const data = await loadRemittanceData();
    const advice = data.advices.find(item => item.id === String(req.params.id) && item.is_deleted !== true);
    if (!advice) return res.status(404).json({ success: false, message: 'ব্যাংক অ্যাডভাইস খুঁজে পাওয়া যায়নি।' });
    const items = data.repayments
      .filter(repayment => repayment.bank_advice_id === advice.id && repayment.is_deleted !== true)
      .map(repayment => {
        const joined = joinRepayment(repayment, data);
        const loan = data.loansById.get(repayment.loan_id);
        return joined && {
          ...joined,
          repayment_id: repayment.id,
          origin_bank_name: joined.target_bank_name,
          origin_bank_branch: joined.target_bank_branch,
          origin_account_no: joined.target_account_no,
          disbursed_amount: loan?.disbursed_amount,
          disbursement_date: loan?.disbursement_date,
          loan_source_type: loan?.loan_source_type
        };
      })
      .filter(Boolean)
      .sort((left, right) => String(left.origin_pbs_name).localeCompare(String(right.origin_pbs_name))
        || String(left.emp_code).localeCompare(String(right.emp_code))
        || String(left.deduction_date).localeCompare(String(right.deduction_date)));
    const employeeGroups = new Map();
    const pbsGroups = new Map();
    for (const item of items) {
      if (!employeeGroups.has(item.emp_code)) {
        employeeGroups.set(item.emp_code, {
          empCode: item.emp_code,
          empName: item.emp_name,
          designation: item.designation,
          department: item.department,
          loanNo: item.loan_no,
          months: [],
          totalAmount: 0,
          count: 0
        });
      }
      const employee = employeeGroups.get(item.emp_code);
      employee.months.push(item.deduction_month);
      employee.totalAmount += Number(item.total_amount || 0);
      employee.count++;
      const pbsName = item.origin_pbs_name || advice.target_pbs_name || 'অন্যান্য পবিস';
      if (!pbsGroups.has(pbsName)) {
        pbsGroups.set(pbsName, {
          pbsName,
          bankName: item.origin_bank_name || advice.target_bank_name || 'ব্যাংক তথ্য নেই',
          bankBranch: item.origin_bank_branch || advice.target_bank_branch || '',
          accountNo: item.origin_account_no || advice.target_account_no || 'হিসাব নং নেই',
          routingNo: item.target_routing_no || advice.target_routing_no || '',
          employees: new Map(),
          pbsTotal: 0
        });
      }
      const group = pbsGroups.get(pbsName);
      if (!group.employees.has(item.emp_code)) {
        group.employees.set(item.emp_code, {
          empCode: item.emp_code,
          empName: item.emp_name,
          designation: item.designation,
          department: item.department,
          loanNo: item.loan_no,
          months: [],
          totalAmount: 0
        });
      }
      const pbsEmployee = group.employees.get(item.emp_code);
      pbsEmployee.months.push(item.deduction_month);
      pbsEmployee.totalAmount += Number(item.total_amount || 0);
      group.pbsTotal += Number(item.total_amount || 0);
    }
    const groupedByPbs = [...pbsGroups.values()].map(group => ({
      ...group,
      employees: [...group.employees.values()]
    }));
    res.json({
      success: true,
      advice,
      ownPbs: data.settings,
      items,
      employeeSummary: [...employeeGroups.values()],
      groupedByPbs
    });
  } catch (error) {
    next(error);
  }
});

async function generateAdvice(req, res, { allPbs = false } = {}) {
  const body = req.body || {};
  const targetPbsName = allPbs ? 'সকল পবিস' : body.target_pbs_name;
  if (!targetPbsName || !validDate(body.advice_date)) {
    return res.status(400).json({ success: false, message: 'সংশ্লিষ্ট পবিসের নাম এবং সঠিক অ্যাডভাইসের তারিখ নির্বাচন করুন।' });
  }
  const data = await loadRemittanceData();
  let items = data.repayments
    .filter(repayment => repayment.is_deleted !== true && repayment.remittance_status === 'PENDING')
    .map(repayment => joinRepayment(repayment, data))
    .filter(item => item && data.loansById.get(item.loan_id)?.loan_source_type === 'OTHER_PBS'
      && data.loansById.get(item.loan_id)?.is_deleted !== true
      && data.employeesById.get(item.employee_id)?.is_deleted !== true
      && (allPbs || item.origin_pbs_name === targetPbsName)
      && (!body.from_date || item.deduction_date >= body.from_date)
      && (!body.to_date || item.deduction_date <= body.to_date)
      && (!Array.isArray(body.repayment_ids) || !body.repayment_ids.length || body.repayment_ids.includes(item.id)));
  if (!items.length) throw new Error('নির্বাচিত পবিস ও ডেট রেঞ্জের জন্য কোনো অনিষ্পন্ন কিস্তি কর্তন পাওয়া যায়নি।');
  if (items.length > 200) throw new Error(`একবারে সর্বোচ্চ ২০০টি কিস্তির অ্যাডভাইস তৈরি করা যাবে; নির্বাচিত হয়েছে ${items.length} টি।`);
  items = items.sort((left, right) => String(left.emp_code).localeCompare(String(right.emp_code))
    || String(left.deduction_date).localeCompare(String(right.deduction_date)));
  const adviceId = await allocateId('bank_advices');
  const adviceRef = collection('bank_advices').doc(adviceId);
  const itemRefs = items.map(item => collection('repayments').doc(item.id));
  const advice = await getDb().runTransaction(async transaction => {
    const [pendingSnapshot, adviceSnapshot] = await Promise.all([
      transaction.get(collection('repayments').where('remittance_status', '==', 'PENDING')),
      transaction.get(collection('bank_advices'))
    ]);
    const currentRepayments = await Promise.all(itemRefs.map(reference => transaction.get(reference)));
    const pendingIds = new Set(pendingSnapshot.docs.map(document => document.id));
    const currentItems = items.filter((item, index) => {
      const snapshot = currentRepayments[index];
      return snapshot?.exists && snapshot.get('is_deleted') !== true && pendingIds.has(item.id)
        && snapshot.get('remittance_status') === 'PENDING';
    });
    if (currentItems.length !== items.length) {
      throw new Error('নির্বাচিত কিছু কিস্তি ইতোমধ্যে অন্য অ্যাডভাইসে যুক্ত হয়েছে; তালিকা রিফ্রেশ করে আবার চেষ্টা করুন।');
    }
    const adviceNoCount = adviceSnapshot.size + 1;
    const year = body.advice_date.slice(0, 4);
    const adviceNo = `BA/${data.settings.pbs_code || 'PBS'}/${year}/${String(adviceNoCount).padStart(3, '0')}`;
    const months = [...new Set(items.map(item => item.deduction_month))].filter(Boolean).sort();
    const dates = [...new Set(items.map(item => item.deduction_date))].filter(Boolean).sort();
    const totalAmount = items.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
    const uniqueEmployees = new Set(items.map(item => item.emp_code));
    const otherPbs = !allPbs && (data.otherPbsById.get(body.target_pbs_id)
      || data.otherPbs.find(pbs => pbs.pbs_name === targetPbsName));
    const prefix = String(data.settings.memo_no_prefix || '২৭.১২.৬১০০.৫৪২.০১.০২৪').replace(/[.\-]+$/, '');
    const memoNo = body.memo_no || `${prefix}.${bengaliDigits(year.slice(-2))}-${bengaliDigits(adviceNoCount + 120)}`;
    const now = new Date().toISOString();
    const record = {
      id: adviceId,
      advice_no: adviceNo,
      memo_no: memoNo,
      advice_date: body.advice_date,
      target_pbs_id: allPbs ? null : otherPbs?.id || body.target_pbs_id || null,
      target_pbs_name: targetPbsName,
      target_bank_name: allPbs ? 'একাধিক ব্যাংক' : otherPbs?.bank_name || 'ব্যাংক নির্ধারিত নয়',
      target_bank_branch: allPbs ? '' : otherPbs?.bank_branch || '',
      target_account_no: allPbs ? '' : otherPbs?.account_no || 'হিসাব নং নেই',
      target_routing_no: allPbs ? '' : otherPbs?.routing_no || '',
      from_bank_name: [data.settings.bank_name, data.settings.bank_branch].filter(Boolean).join(', '),
      from_account_no: data.settings.account_no || '',
      deduction_month: months.join(', '),
      from_date: body.from_date || dates[0] || null,
      to_date: body.to_date || dates[dates.length - 1] || null,
      period_text: formatPeriodText(body.from_date || dates[0], body.to_date || dates[dates.length - 1], months),
      total_amount: totalAmount,
      amount_in_words: `${bengaliDigits(totalAmount)} টাকা মাত্র`,
      employee_count: uniqueEmployees.size,
      remarks: body.remarks || '',
      status: 'COMPLETED',
      is_deleted: false,
      created_at: now
    };
    transaction.create(adviceRef, record);
    currentItems.forEach((item, index) => transaction.update(itemRefs[index], {
      remittance_status: 'REMITTED',
      bank_advice_id: adviceId,
      updated_at: now
    }));
    return record;
  });
  await writeAudit(req.user, 'CREATE', 'BANK_ADVICE', adviceId,
    `Bank advice ${advice.advice_no}: ${targetPbsName}, ${advice.total_amount}`);
  res.json({
    success: true,
    message: 'পবিস ভিত্তিক ব্যাংক অ্যাডভাইস এবং সরকারি অবহিতকরণ চিঠি সফলভাবে প্রস্তুত হয়েছে।',
    adviceId,
    adviceNo: advice.advice_no,
    memoNo: advice.memo_no,
    periodText: advice.period_text,
    totalAmount: advice.total_amount,
    inWords: advice.amount_in_words
  });
}

router.post('/generate', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    await generateAdvice(req, res);
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'ব্যাংক অ্যাডভাইস প্রস্তুতকরণ ব্যর্থ হয়েছে।' });
  }
});

router.post('/generate-all', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    await generateAdvice(req, res, { allPbs: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'একত্রিত ব্যাংক অ্যাডভাইস প্রস্তুতকরণ ব্যর্থ হয়েছে।' });
  }
});

router.delete('/advices/:id', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const adviceRef = collection('bank_advices').doc(String(req.params.id));
    const repaymentQuery = collection('repayments').where('bank_advice_id', '==', String(req.params.id));
    const advice = await getDb().runTransaction(async transaction => {
      const [adviceSnapshot, repaymentsSnapshot] = await Promise.all([
        transaction.get(adviceRef),
        transaction.get(repaymentQuery)
      ]);
      if (!adviceSnapshot.exists || adviceSnapshot.get('is_deleted') === true) {
        throw new Error('ব্যাংক অ্যাডভাইস খুঁজে পাওয়া যায়নি।');
      }
      if (repaymentsSnapshot.size > 400) throw new Error('অ্যাডভাইসে অনেক কিস্তি রয়েছে; বাতিল করতে সহায়তা প্রয়োজন।');
      const now = new Date().toISOString();
      transaction.update(adviceRef, { is_deleted: true, deleted_at: now, deleted_by: req.user.username });
      repaymentsSnapshot.docs.forEach(document => transaction.update(document.ref, {
        remittance_status: 'PENDING',
        bank_advice_id: null,
        updated_at: now
      }));
      return { id: adviceSnapshot.id, advice_no: adviceSnapshot.get('advice_no') };
    });
    await writeAudit(req.user, 'DELETE', 'BANK_ADVICE', advice.id, `Bank advice cancelled: ${advice.advice_no}`);
    res.json({ success: true, message: 'ব্যাংক অ্যাডভাইস বাতিল করা হয়েছে এবং কিস্তিসমূহ পুনরায় অনিষ্পন্ন তালিকায় যুক্ত হয়েছে।' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'অ্যাডভাইস বাতিল করা যায়নি।' });
  }
});

module.exports = router;
