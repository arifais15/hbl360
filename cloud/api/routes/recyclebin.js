const express = require('express');
const { authenticateToken, requireRole } = require('../lib/auth');
const { collection, getDb } = require('../lib/firestore');
const { listRecords, writeAudit } = require('../lib/records');

const router = express.Router();
const staffRoles = ['admin', 'accounts'];

router.get('/', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const [employees, loans, repayments, provisions, advices] = await Promise.all([
      listRecords('employees', { includeDeleted: true }),
      listRecords('loans', { includeDeleted: true }),
      listRecords('repayments', { includeDeleted: true }),
      listRecords('interest_provisions', { includeDeleted: true }),
      listRecords('bank_advices', { includeDeleted: true })
    ]);
    const employeesById = new Map(employees.map(employee => [employee.id, employee]));
    const loansById = new Map(loans.map(loan => [loan.id, loan]));
    const deletedItems = [];

    employees.filter(employee => employee.is_deleted === true).forEach(employee => {
      deletedItems.push({
        id: employee.id,
        code: employee.emp_code,
        title: employee.name,
        subtitle: employee.designation || '',
        deleted_at: employee.deleted_at,
        deleted_by: employee.deleted_by,
        entity_type: 'EMPLOYEE'
      });
    });
    loans.filter(loan => loan.is_deleted === true).forEach(loan => {
      deletedItems.push({
        id: loan.id,
        code: loan.loan_no,
        title: `ঋণ - ${loan.loan_lot_name || ''} (${employeesById.get(loan.employee_id)?.name || ''})`,
        subtitle: `পরিমাণ: ${loan.disbursed_amount || 0} টাকা, স্থিতি: ${loan.principal_balance || 0}`,
        deleted_at: loan.deleted_at,
        deleted_by: loan.deleted_by,
        entity_type: 'LOAN'
      });
    });
    repayments.filter(repayment => repayment.is_deleted === true).forEach(repayment => {
      const loan = loansById.get(repayment.loan_id);
      deletedItems.push({
        id: repayment.id,
        code: repayment.deduction_month,
        title: `কিস্তি কর্তন - ${employeesById.get(repayment.employee_id)?.name || ''}`,
        subtitle: `টাকা: ${repayment.total_amount || 0}, ঋণ নং: ${loan?.loan_no || ''}`,
        deleted_at: repayment.deleted_at,
        deleted_by: repayment.deleted_by,
        entity_type: 'REPAYMENT'
      });
    });
    provisions.filter(provision => provision.is_deleted === true).forEach(provision => {
      const loan = loansById.get(provision.loan_id);
      deletedItems.push({
        id: provision.id,
        code: provision.provision_month,
        title: `সুদ প্রভিশন - ${employeesById.get(provision.employee_id)?.name || ''}`,
        subtitle: `সুদের পরিমাণ: ${provision.interest_amount || 0} টাকা, ঋণ: ${loan?.loan_no || ''}`,
        deleted_at: provision.deleted_at,
        deleted_by: provision.deleted_by,
        entity_type: 'PROVISION'
      });
    });
    advices.filter(advice => advice.is_deleted === true).forEach(advice => {
      deletedItems.push({
        id: advice.id,
        code: advice.advice_no,
        title: `ব্যাংক অ্যাডভাইস - ${advice.target_pbs_name || ''}`,
        subtitle: `মোট টাকা: ${advice.total_amount || 0}, মাস: ${advice.deduction_month || ''}`,
        deleted_at: advice.deleted_at,
        deleted_by: advice.deleted_by,
        entity_type: 'BANK_ADVICE'
      });
    });
    deletedItems.sort((left, right) => String(right.deleted_at || '').localeCompare(String(left.deleted_at || '')));
    res.json({ success: true, deletedItems, totalCount: deletedItems.length });
  } catch (error) {
    next(error);
  }
});

router.post('/restore', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const { entity_type: entityType, id } = req.body || {};
    if (!entityType || !id) {
      return res.status(400).json({ success: false, message: 'সঠিক রেকর্ড নির্বাচন করুন।' });
    }

    const entityCollections = {
      EMPLOYEE: 'employees',
      LOAN: 'loans',
      REPAYMENT: 'repayments',
      PROVISION: 'interest_provisions',
      BANK_ADVICE: 'bank_advices'
    };
    const name = entityCollections[entityType];
    if (!name) return res.status(400).json({ success: false, message: 'রেকর্ডের ধরন সঠিক নয়।' });
    const recordRef = collection(name).doc(String(id));
    const result = await getDb().runTransaction(async transaction => {
      const recordSnapshot = await transaction.get(recordRef);
      if (!recordSnapshot.exists || recordSnapshot.get('is_deleted') !== true) {
        throw new Error('রেকর্ডটি রিসাইকেল বিনে পাওয়া যায়নি।');
      }
      const record = { id: recordSnapshot.id, ...recordSnapshot.data() };
      const now = new Date().toISOString();
      const restoreFields = { is_deleted: false, deleted_at: null, deleted_by: null };
      let loanRef;
      let loanSnapshot;
      let duplicateSnapshot;
      let usersSnapshot;

      if (entityType === 'EMPLOYEE') {
        usersSnapshot = await transaction.get(collection('users').where('employee_id', '==', record.id));
      } else if (entityType === 'REPAYMENT' || entityType === 'PROVISION') {
        loanRef = collection('loans').doc(String(record.loan_id));
        if (entityType === 'REPAYMENT') {
          [loanSnapshot, duplicateSnapshot] = await Promise.all([
            transaction.get(loanRef),
            transaction.get(collection('repayments').where('loan_id', '==', record.loan_id))
          ]);
        } else {
          [loanSnapshot, duplicateSnapshot] = await Promise.all([
            transaction.get(loanRef),
            transaction.get(collection('interest_provisions').where('loan_id', '==', record.loan_id))
          ]);
        }
        if (!loanSnapshot.exists) throw new Error('সংশ্লিষ্ট ঋণ রেকর্ডটি খুঁজে পাওয়া যায়নি।');
        const duplicate = duplicateSnapshot.docs.find(document => document.get('is_deleted') !== true
          && (entityType === 'REPAYMENT'
            ? document.get('deduction_month') === record.deduction_month
            : document.get('provision_month') === record.provision_month));
        if (duplicate) throw new Error('একই মাসের একটি সক্রিয় রেকর্ড ইতোমধ্যে বিদ্যমান রয়েছে।');
      }

      transaction.update(recordRef, { ...restoreFields, restored_at: now, restored_by: req.user.username });
      if (entityType === 'EMPLOYEE') {
        usersSnapshot.docs.forEach(user => {
          transaction.update(user.ref, restoreFields);
        });
      } else if (entityType === 'REPAYMENT') {
        const loan = loanSnapshot.data();
        const principal = Math.max(0, Number(loan.principal_balance || 0) - Number(record.principal_paid || 0));
        const interest = Math.max(0, Number(loan.interest_balance || 0) - Number(record.interest_paid || 0));
        transaction.update(loanRef, {
          principal_balance: principal,
          interest_balance: interest,
          total_principal_paid: Number(loan.total_principal_paid || 0) + Number(record.principal_paid || 0),
          total_interest_paid: Number(loan.total_interest_paid || 0) + Number(record.interest_paid || 0),
          advance_balance: Number(loan.advance_balance || 0) + Number(record.advance_paid || 0),
          status: principal <= 0 && interest <= 0 ? 'CLOSED' : 'ACTIVE',
          updated_at: now
        });
      } else if (entityType === 'PROVISION') {
        transaction.update(loanRef, {
          interest_balance: Number(loanSnapshot.get('interest_balance') || 0) + Number(record.interest_amount || 0),
          updated_at: now
        });
      }
      return { record, message: `রেকর্ড ${record.code || record.id} পুনরুদ্ধার করা হয়েছে।` };
    });
    await writeAudit(req.user, 'RESTORE', entityType, String(id), result.message);
    res.json({ success: true, message: result.message });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message || 'রেকর্ড পুনরুদ্ধার করা যায়নি।' });
  }
});

module.exports = router;
