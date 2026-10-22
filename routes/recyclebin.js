const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

// List All Soft-Deleted Items across the system
router.get('/', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const deletedItems = [];

    // 1. Deleted Employees
    const deletedEmployees = db.prepare(`
      SELECT id, emp_code as code, name as title, designation as subtitle,
             deleted_at, deleted_by, 'EMPLOYEE' as entity_type
      FROM employees WHERE is_deleted = 1
    `).all();
    deletedItems.push(...deletedEmployees);

    // 2. Deleted Loans
    const deletedLoans = db.prepare(`
      SELECT l.id, l.loan_no as code, ('ঋণ - ' || l.loan_lot_name || ' (' || e.name || ')') as title,
             ('পরিমাণ: ' || l.disbursed_amount || ' টাকা, স্থিতি: ' || l.principal_balance) as subtitle,
             l.deleted_at, l.deleted_by, 'LOAN' as entity_type
      FROM loans l
      LEFT JOIN employees e ON l.employee_id = e.id
      WHERE l.is_deleted = 1
    `).all();
    deletedItems.push(...deletedLoans);

    // 3. Deleted Repayments (Deductions)
    const deletedRepayments = db.prepare(`
      SELECT r.id, r.deduction_month as code, ('কিস্তি কর্তন - ' || e.name) as title,
             ('টাকা: ' || r.total_amount || ', ঋণ নং: ' || l.loan_no) as subtitle,
             r.deleted_at, r.deleted_by, 'REPAYMENT' as entity_type
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      JOIN employees e ON r.employee_id = e.id
      WHERE r.is_deleted = 1
    `).all();
    deletedItems.push(...deletedRepayments);

    // 4. Deleted Interest Provisions
    const deletedProvisions = db.prepare(`
      SELECT p.id, p.provision_month as code, ('সুদ প্রভিশন - ' || e.name) as title,
             ('সুদের পরিমাণ: ' || p.interest_amount || ' টাকা, ঋণ: ' || l.loan_no) as subtitle,
             p.deleted_at, p.deleted_by, 'PROVISION' as entity_type
      FROM interest_provisions p
      JOIN loans l ON p.loan_id = l.id
      JOIN employees e ON p.employee_id = e.id
      WHERE p.is_deleted = 1
    `).all();
    deletedItems.push(...deletedProvisions);

    // 5. Deleted Bank Advices
    const deletedAdvices = db.prepare(`
      SELECT b.id, b.advice_no as code, ('ব্যাংক অ্যাডভাইস - ' || b.target_pbs_name) as title,
             ('মোট টাকা: ' || b.total_amount || ', মাস: ' || b.deduction_month) as subtitle,
             b.deleted_at, b.deleted_by, 'BANK_ADVICE' as entity_type
      FROM bank_advices b
      WHERE b.is_deleted = 1
    `).all();
    deletedItems.push(...deletedAdvices);

    // Sort by deleted_at descending
    deletedItems.sort((a, b) => (b.deleted_at || '').localeCompare(a.deleted_at || ''));

    res.json({ success: true, deletedItems, totalCount: deletedItems.length });
  } catch (error) {
    console.error('Fetch recycle bin error:', error);
    res.status(500).json({ success: false, message: 'রিসাইকেল বিন তথ্য লোড করা যায়নি।' });
  }
});

// Restore Record from Recycle Bin (পুনরুদ্ধার)
router.post('/restore', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  const { entity_type, id } = req.body;

  if (!entity_type || !id) {
    return res.status(400).json({ success: false, message: 'সঠিক রেকর্ড নির্বাচন করুন।' });
  }

  const transaction = db.transaction(() => {
    switch (entity_type) {
      case 'EMPLOYEE': {
        const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND is_deleted = 1').get(id);
        if (!emp) throw new Error('কর্মচারী রেকর্ড পাওয়া যায়নি।');
        db.prepare('UPDATE employees SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(id);
        db.prepare('UPDATE users SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL WHERE employee_id = ?').run(id);
        return `কর্মচারী ${emp.name} (${emp.emp_code}) পুনরুদ্ধার করা হয়েছে।`;
      }

      case 'LOAN': {
        const loan = db.prepare('SELECT * FROM loans WHERE id = ? AND is_deleted = 1').get(id);
        if (!loan) throw new Error('ঋণ রেকর্ড পাওয়া যায়নি।');
        db.prepare('UPDATE loans SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(id);
        return `ঋণ হিসাব নং ${loan.loan_no} পুনরুদ্ধার করা হয়েছে।`;
      }

      case 'REPAYMENT': {
        const rep = db.prepare('SELECT * FROM repayments WHERE id = ? AND is_deleted = 1').get(id);
        if (!rep) throw new Error('কিস্তি রেকর্ড পাওয়া যায়নি।');
        const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(rep.loan_id);
        if (!loan) throw new Error('সংশ্লিষ্ট ঋণ পাওয়া যায়নি।');

        // Duplicate guard: Check if an active repayment already exists for this loan & month
        const activeRep = db.prepare(`
          SELECT id, deduction_date, total_amount, voucher_no
          FROM repayments
          WHERE loan_id = ? AND deduction_month = ? AND is_deleted = 0
        `).get(rep.loan_id, rep.deduction_month);

        if (activeRep) {
          throw new Error(
            `ডুপ্লিকেট প্রতিরোধ: এই ঋণে ইতোমধ্যে ${rep.deduction_month} মাসের একটি সক্রিয় কিস্তি কর্তন (ভাউচার: ${activeRep.voucher_no || 'N/A'}, টাকা: ${activeRep.total_amount}, তারিখ: ${activeRep.deduction_date}) বিদ্যমান রয়েছে। ডুপ্লিকেট এড়াতে একই মাসে দুটি কিস্তি কার্যকর করা যাবে না।`
          );
        }

        // Restore repayment
        db.prepare('UPDATE repayments SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(id);

        // Re-apply payment deduction onto loan
        const newPrincipal = Math.max(0, loan.principal_balance - rep.principal_paid);
        const newInterest = Math.max(0, loan.interest_balance - rep.interest_paid);
        db.prepare(`
          UPDATE loans
          SET principal_balance = ?,
              interest_balance = ?,
              total_principal_paid = total_principal_paid + ?,
              total_interest_paid = total_interest_paid + ?,
              advance_balance = advance_balance + ?,
              status = ?
          WHERE id = ?
        `).run(
          newPrincipal,
          newInterest,
          rep.principal_paid,
          rep.interest_paid,
          rep.advance_paid || 0,
          newPrincipal <= 0 && newInterest <= 0 ? 'CLOSED' : 'ACTIVE',
          loan.id
        );

        return `কিস্তি কর্তন (${rep.deduction_month}, টাকা: ${rep.total_amount}) পুনরুদ্ধার করা হয়েছে।`;
      }

      case 'PROVISION': {
        const prov = db.prepare('SELECT * FROM interest_provisions WHERE id = ? AND is_deleted = 1').get(id);
        if (!prov) throw new Error('প্রভিশন রেকর্ড পাওয়া যায়নি।');
        const loan = db.prepare('SELECT * FROM loans WHERE id = ?').get(prov.loan_id);
        if (!loan) throw new Error('সংশ্লিষ্ট ঋণ পাওয়া যায়নি।');

        // Duplicate guard: Check if an active provision already exists for this loan & month
        const activeProv = db.prepare(`
          SELECT id, provision_date, interest_amount
          FROM interest_provisions
          WHERE loan_id = ? AND provision_month = ? AND is_deleted = 0
        `).get(prov.loan_id, prov.provision_month);

        if (activeProv) {
          throw new Error(
            `ডুপ্লিকেট প্রতিরোধ: এই ঋণে ইতোমধ্যে ${prov.provision_month} মাসের একটি সুদ প্রভিশন (টাকা: ${activeProv.interest_amount}) কার্যকর রয়েছে।`
          );
        }

        // Restore provision
        db.prepare('UPDATE interest_provisions SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(id);

        // Re-apply interest addition to loan
        db.prepare(`
          UPDATE loans
          SET interest_balance = interest_balance + ?
          WHERE id = ?
        `).run(prov.interest_amount, loan.id);

        return `সুদ প্রভিশন (${prov.provision_month}, টাকা: ${prov.interest_amount}) পুনরুদ্ধার করা হয়েছে।`;
      }

      case 'BANK_ADVICE': {
        const advice = db.prepare('SELECT * FROM bank_advices WHERE id = ? AND is_deleted = 1').get(id);
        if (!advice) throw new Error('ব্যাংক অ্যাডভাইস রেকর্ড পাওয়া যায়নি।');

        db.prepare('UPDATE bank_advices SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL WHERE id = ?').run(id);
        db.prepare(`
          UPDATE repayments
          SET remittance_status = 'REMITTED', bank_advice_id = ?
          WHERE is_deleted = 0 AND id IN (
            SELECT id FROM repayments WHERE bank_advice_id = ? OR (deduction_month = ? AND loan_id IN (
              SELECT id FROM loans WHERE origin_pbs_name = ?
            ))
          )
        `).run(id, id, advice.deduction_month, advice.target_pbs_name);

        return `ব্যাংক অ্যাডভাইস ${advice.advice_no} পুনরুদ্ধার করা হয়েছে।`;
      }

      default:
        throw new Error('অজানা রেকর্ড প্রকার।');
    }
  });

  try {
    const message = transaction();
    logAudit(req, 'RESTORE', entity_type, id, message);
    res.json({ success: true, message });
  } catch (err) {
    console.error('Restore error:', err);
    res.status(400).json({ success: false, message: err.message || 'পুনরুদ্ধার ব্যর্থ হয়েছে।' });
  }
});

module.exports = router;
