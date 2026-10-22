const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');
const {
  amountInBengaliWords,
  toBengaliDigits,
  formatBDT,
  formatBengaliMonth,
  formatPeriodText
} = require('../services/loanCalculationService');

// Get Pending Remittances grouped by Target PBS and Date Range / Multiple Months
router.get('/pending', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const { targetPbsName, fromDate, toDate } = req.query;

    let query = `
      SELECT r.id as repayment_id, r.deduction_month, r.deduction_date, r.total_amount,
             l.id as loan_id, l.loan_no, l.sanction_no, l.loan_lot_name, l.origin_pbs_id, l.origin_pbs_name,
             e.id as employee_id, e.emp_code, e.name as emp_name, e.designation, e.department,
             p.bank_name as target_bank_name, p.bank_branch as target_bank_branch,
             p.account_no as target_account_no, p.routing_no as target_routing_no
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      JOIN employees e ON r.employee_id = e.id
      LEFT JOIN other_pbs p ON l.origin_pbs_id = p.id
      WHERE l.loan_source_type = 'OTHER_PBS'
        AND r.remittance_status = 'PENDING'
        AND r.is_deleted = 0
        AND l.is_deleted = 0
        AND e.is_deleted = 0
    `;
    const params = [];

    if (targetPbsName) {
      query += ` AND l.origin_pbs_name = ?`;
      params.push(targetPbsName);
    }

    if (fromDate) {
      query += ` AND r.deduction_date >= ?`;
      params.push(fromDate);
    }

    if (toDate) {
      query += ` AND r.deduction_date <= ?`;
      params.push(toDate);
    }

    query += ` ORDER BY l.origin_pbs_name ASC, r.deduction_date ASC`;

    const pendingDeductions = db.prepare(query).all(...params);

    // Group primarily by Target PBS (পবিস ভিত্তিক গ্রুপ)
    const pbsGroups = {};
    for (const item of pendingDeductions) {
      const pbs = item.origin_pbs_name;
      if (!pbsGroups[pbs]) {
        pbsGroups[pbs] = {
          pbsName: pbs,
          pbsId: item.origin_pbs_id,
          targetBank: item.target_bank_name || 'ব্যাংক তথ্য নির্ধারিত নয়',
          targetBranch: item.target_bank_branch || '',
          targetAccountNo: item.target_account_no || 'হিসাব নং নেই',
          targetRoutingNo: item.target_routing_no || '',
          totalAmount: 0,
          totalInstallmentsCount: 0,
          monthsSet: new Set(),
          datesSet: new Set(),
          employeeMap: {},
          repayments: []
        };
      }

      const grp = pbsGroups[pbs];
      grp.totalAmount += item.total_amount;
      grp.totalInstallmentsCount += 1;
      grp.monthsSet.add(item.deduction_month);
      grp.datesSet.add(item.deduction_date);

      // Track by Employee (Pay ID)
      if (!grp.employeeMap[item.emp_code]) {
        grp.employeeMap[item.emp_code] = {
          empCode: item.emp_code,
          empName: item.emp_name,
          designation: item.designation,
          department: item.department,
          loanNo: item.loan_no,
          months: [],
          totalAmount: 0,
          installmentsCount: 0
        };
      }
      grp.employeeMap[item.emp_code].months.push(item.deduction_month);
      grp.employeeMap[item.emp_code].totalAmount += item.total_amount;
      grp.employeeMap[item.emp_code].installmentsCount += 1;

      grp.repayments.push(item);
    }

    // Convert sets to sorted arrays and add period text
    const resultList = Object.values(pbsGroups).map(grp => {
      const monthsList = Array.from(grp.monthsSet).sort();
      const datesList = Array.from(grp.datesSet).sort();
      const earliestDate = datesList[0] || '';
      const latestDate = datesList[datesList.length - 1] || '';
      const periodText = formatPeriodText(earliestDate, latestDate, monthsList);

      return {
        pbsName: grp.pbsName,
        pbsId: grp.pbsId,
        targetBank: grp.targetBank,
        targetBranch: grp.targetBranch,
        targetAccountNo: grp.targetAccountNo,
        targetRoutingNo: grp.targetRoutingNo,
        totalAmount: grp.totalAmount,
        totalInstallmentsCount: grp.totalInstallmentsCount,
        distinctEmployeeCount: Object.keys(grp.employeeMap).length,
        monthsList,
        earliestDate,
        latestDate,
        periodText,
        employees: Object.values(grp.employeeMap),
        repayments: grp.repayments
      };
    });

    res.json({
      success: true,
      pendingList: resultList,
      totalPendingItems: pendingDeductions.length
    });
  } catch (error) {
    console.error('Pending remittances error:', error);
    res.status(500).json({ success: false, message: 'প্রেরণযোগ্য কিস্তির তালিকা আনা যায়নি।' });
  }
});

// List Generated Bank Advices
router.get('/advices', authenticateToken, (req, res) => {
  try {
    const advices = db.prepare(`
      SELECT b.*,
             COUNT(r.id) as actual_item_count
      FROM bank_advices b
      LEFT JOIN repayments r ON r.bank_advice_id = b.id AND r.is_deleted = 0
      WHERE b.is_deleted = 0
      GROUP BY b.id
      ORDER BY b.advice_date DESC, b.id DESC
    `).all();

    res.json({ success: true, advices });
  } catch (error) {
    console.error('Fetch advices error:', error);
    res.status(500).json({ success: false, message: 'ব্যাংক অ্যাডভাইস তালিকা আনা সম্ভব হয়নি।' });
  }
});

// Single Bank Advice & Official PBS Letter Full View (Multiple months & Date Range supported)
router.get('/advices/:id', authenticateToken, (req, res) => {
  try {
    const adviceId = req.params.id;
    const advice = db.prepare(`SELECT * FROM bank_advices WHERE id = ? AND is_deleted = 0`).get(adviceId);

    if (!advice) {
      return res.status(404).json({ success: false, message: 'ব্যাংক অ্যাডভাইস খুঁজে পাওয়া যায়নি।' });
    }

    // Get current PBS settings for letterhead and signatories
    const ownPbs = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get();

    // Get included employee repayments with their 4-digit Pay IDs
    const items = db.prepare(`
      SELECT r.id as repayment_id, r.deduction_month, r.deduction_date, r.total_amount,
             l.loan_no, l.sanction_no, l.loan_lot_name, l.origin_pbs_name, l.disbursed_amount, l.disbursement_date, l.loan_source_type,
             e.emp_code, e.name as emp_name, e.designation, e.department,
             p.bank_name as origin_bank_name, p.bank_branch as origin_bank_branch,
             p.account_no as origin_account_no, p.routing_no as origin_routing_no
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      JOIN employees e ON r.employee_id = e.id
      LEFT JOIN other_pbs p ON (l.origin_pbs_id = p.id OR l.origin_pbs_name = p.pbs_name)
      WHERE r.bank_advice_id = ? AND r.is_deleted = 0
      ORDER BY l.origin_pbs_name ASC, e.emp_code ASC, r.deduction_date ASC
    `).all(adviceId);

    // Group items by Employee for summary reporting
    const employeeSummary = {};
    for (const it of items) {
      if (!employeeSummary[it.emp_code]) {
        employeeSummary[it.emp_code] = {
          empCode: it.emp_code,
          empName: it.emp_name,
          designation: it.designation,
          department: it.department,
          loanNo: it.loan_no,
          months: [],
          totalAmount: 0,
          count: 0
        };
      }
      employeeSummary[it.emp_code].months.push(it.deduction_month);
      employeeSummary[it.emp_code].totalAmount += it.total_amount;
      employeeSummary[it.emp_code].count += 1;
    }

    // Group by PBS (with unique employees under each PBS)
    const pbsMap = {};
    for (const it of items) {
      const pbs = it.origin_pbs_name || advice.target_pbs_name || 'অন্যান্য পবিস';
      if (!pbsMap[pbs]) {
        pbsMap[pbs] = {
          pbsName: pbs,
          bankName: it.origin_bank_name || advice.target_bank_name || 'ব্যাংক তথ্য নেই',
          bankBranch: it.origin_bank_branch || advice.target_bank_branch || '',
          accountNo: it.origin_account_no || advice.target_account_no || 'হিসাব নং নেই',
          routingNo: it.origin_routing_no || advice.target_routing_no || '',
          employeeMap: {},
          pbsTotal: 0
        };
      }
      if (!pbsMap[pbs].employeeMap[it.emp_code]) {
        pbsMap[pbs].employeeMap[it.emp_code] = {
          empCode: it.emp_code,
          empName: it.emp_name,
          designation: it.designation,
          department: it.department,
          loanNo: it.loan_no,
          months: [],
          totalAmount: 0
        };
      }
      pbsMap[pbs].employeeMap[it.emp_code].months.push(it.deduction_month);
      pbsMap[pbs].employeeMap[it.emp_code].totalAmount += it.total_amount;
      pbsMap[pbs].pbsTotal += it.total_amount;
    }

    const groupedByPbs = Object.values(pbsMap).map(g => ({
      pbsName: g.pbsName,
      bankName: g.bankName,
      bankBranch: g.bankBranch,
      accountNo: g.accountNo,
      routingNo: g.routingNo,
      pbsTotal: g.pbsTotal,
      employees: Object.values(g.employeeMap)
    }));

    res.json({
      success: true,
      advice,
      ownPbs,
      items,
      employeeSummary: Object.values(employeeSummary),
      groupedByPbs
    });
  } catch (error) {
    console.error('Advice detail error:', error);
    res.status(500).json({ success: false, message: 'অ্যাডভাইস তথ্য লোড করা যায়নি।' });
  }
});

// Generate Bank Advice & Official Notification Letter (PBS-based, Multiple Months & Date Range)
router.post('/generate', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  const transaction = db.transaction(() => {
    const {
      target_pbs_id,
      target_pbs_name,
      from_date,
      to_date,
      advice_date,
      memo_no,
      remarks,
      repayment_ids
    } = req.body;

    if (!target_pbs_name || !advice_date) {
      throw new Error('সংশ্লিষ্ট পবিসের নাম এবং ব্যাংক অ্যাডভাইসের তারিখ নির্বাচন করুন।');
    }

    // Fetch repayments to include
    let query = `
      SELECT r.*, l.origin_pbs_id, l.origin_pbs_name, e.emp_code
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      JOIN employees e ON r.employee_id = e.id
      WHERE l.loan_source_type = 'OTHER_PBS'
        AND l.origin_pbs_name = ?
        AND r.remittance_status = 'PENDING'
        AND r.is_deleted = 0
        AND l.is_deleted = 0
    `;
    const params = [target_pbs_name];

    if (repayment_ids && Array.isArray(repayment_ids) && repayment_ids.length > 0) {
      query += ` AND r.id IN (${repayment_ids.map(() => '?').join(',')})`;
      params.push(...repayment_ids);
    } else {
      if (from_date) {
        query += ` AND r.deduction_date >= ?`;
        params.push(from_date);
      }
      if (to_date) {
        query += ` AND r.deduction_date <= ?`;
        params.push(to_date);
      }
    }

    query += ` ORDER BY e.emp_code ASC, r.deduction_date ASC`;

    const items = db.prepare(query).all(...params);

    if (items.length === 0) {
      throw new Error('নির্বাচিত পবিস ও ডেট রেঞ্জের জন্য কোনো অনিষ্পন্ন কিস্তি কর্তন পাওয়া যায়নি।');
    }

    // Determine months and date period
    const monthsList = Array.from(new Set(items.map(i => i.deduction_month))).sort();
    const datesList = Array.from(new Set(items.map(i => i.deduction_date))).sort();
    const minDate = from_date || datesList[0] || '';
    const maxDate = to_date || datesList[datesList.length - 1] || '';
    const periodText = formatPeriodText(minDate, maxDate, monthsList);

    // Calculate total amount
    const totalAmount = items.reduce((acc, curr) => acc + curr.total_amount, 0);
    const inWords = amountInBengaliWords(totalAmount);

    // Distinct employees count
    const distinctEmpCount = new Set(items.map(i => i.emp_code)).size;

    // Fetch Target PBS Bank Info
    let targetPbs = null;
    if (target_pbs_id) {
      targetPbs = db.prepare('SELECT * FROM other_pbs WHERE id = ?').get(target_pbs_id);
    } else {
      targetPbs = db.prepare('SELECT * FROM other_pbs WHERE pbs_name = ?').get(target_pbs_name);
    }

    // Fetch Own PBS Bank Info
    const ownPbs = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get();

    // Auto-generate Advice No
    const count = db.prepare('SELECT COUNT(*) as count FROM bank_advices').get().count + 1;
    const yearStr = new Date(advice_date).getFullYear().toString();
    const adviceNo = `BA/${ownPbs.pbs_code || 'PBS'}/${yearStr}/${String(count).padStart(3, '0')}`;
    const memoPrefix = (ownPbs.memo_no_prefix || '২৭.১২.৬১০০.৫৪২.০১.০২৪').replace(/[.\-]+$/, '');
    const finalMemoNo = memo_no || `${memoPrefix}.${toBengaliDigits(yearStr.slice(-2))}-${toBengaliDigits(count + 120)}`;

    const insertAdvice = db.prepare(`
      INSERT INTO bank_advices (
        advice_no, memo_no, advice_date, target_pbs_id, target_pbs_name,
        target_bank_name, target_bank_branch, target_account_no, target_routing_no,
        from_bank_name, from_account_no, deduction_month, from_date, to_date, period_text,
        total_amount, amount_in_words, employee_count, remarks, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED')
    `);

    const result = insertAdvice.run(
      adviceNo,
      finalMemoNo,
      advice_date,
      targetPbs ? targetPbs.id : null,
      target_pbs_name,
      targetPbs ? (targetPbs.bank_name || 'ব্যাংক নির্ধারিত নয়') : 'ব্যাংক নির্ধারিত নয়',
      targetPbs ? (targetPbs.bank_branch || '') : '',
      targetPbs ? (targetPbs.account_no || 'হিসাব নং নেই') : 'হিসাব নং নেই',
      targetPbs ? targetPbs.routing_no : null,
      ownPbs.bank_name + ', ' + ownPbs.bank_branch,
      ownPbs.account_no,
      monthsList.join(', '),
      minDate || null,
      maxDate || null,
      periodText,
      totalAmount,
      inWords,
      distinctEmpCount,
      remarks || `${periodText} বেতন হতে কর্তনকৃত গৃহ নির্মাণ ঋণ কিস্তি স্থানান্তর`
    );

    const adviceId = result.lastInsertRowid;

    // Update repayments to REMITTED
    const updateRepayment = db.prepare(`
      UPDATE repayments
      SET remittance_status = 'REMITTED',
          bank_advice_id = ?
      WHERE id = ?
    `);

    for (const item of items) {
      updateRepayment.run(adviceId, item.id);
    }

    return {
      adviceId,
      adviceNo,
      memoNo: finalMemoNo,
      periodText,
      totalAmount,
      inWords,
      itemCount: items.length,
      distinctEmpCount
    };
  });

  try {
    const data = transaction();
    logAudit(
      req,
      'CREATE',
      'BANK_ADVICE',
      data.adviceId,
      `পবিস ভিত্তিক ব্যাংক অ্যাডভাইস ও চিঠি: ${data.adviceNo}, পবিস: ${req.body.target_pbs_name}, সময়কাল: ${data.periodText}, সর্বমোট ${data.totalAmount} টাকা (${data.distinctEmpCount} জন কর্মকর্তা/কর্মচারী, ${data.itemCount} টি কিস্তি)`
    );

    res.json({
      success: true,
      message: 'পবিস ভিত্তিক ব্যাংক অ্যাডভাইস এবং সরকারি অবহিতকরণ চিঠি সফলভাবে প্রস্তুত হয়েছে।',
      adviceId: data.adviceId,
      adviceNo: data.adviceNo,
      memoNo: data.memoNo,
      periodText: data.periodText,
      totalAmount: data.totalAmount,
      inWords: data.inWords
    });
  } catch (err) {
    console.error('Generate remittance error:', err);
    res.status(400).json({ success: false, message: err.message || 'ব্যাংক অ্যাডভাইস প্রস্তুতকরণ ব্যর্থ হয়েছে।' });
  }
});

// Generate Combined Bank Advice for ALL PBS at once
router.post('/generate-all', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  const transaction = db.transaction(() => {
    const { advice_date, memo_no, remarks, from_date, to_date } = req.body;

    if (!advice_date) {
      throw new Error('ব্যাংক অ্যাডভাইসের তারিখ নির্বাচন করুন।');
    }

    // Fetch ALL pending OTHER_PBS repayments
    let query = `
      SELECT r.*, l.origin_pbs_id, l.origin_pbs_name, e.emp_code, e.name as emp_name, e.designation,
             p.bank_name as target_bank_name, p.bank_branch as target_bank_branch,
             p.account_no as target_account_no, p.routing_no as target_routing_no
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      JOIN employees e ON r.employee_id = e.id
      LEFT JOIN other_pbs p ON (l.origin_pbs_id = p.id OR l.origin_pbs_name = p.pbs_name)
      WHERE l.loan_source_type = 'OTHER_PBS'
        AND r.remittance_status = 'PENDING'
        AND r.is_deleted = 0
        AND l.is_deleted = 0
        AND e.is_deleted = 0
    `;
    const params = [];
    if (from_date) { query += ` AND r.deduction_date >= ?`; params.push(from_date); }
    if (to_date)   { query += ` AND r.deduction_date <= ?`; params.push(to_date); }
    query += ` ORDER BY l.origin_pbs_name ASC, e.emp_code ASC, r.deduction_date ASC`;

    const items = db.prepare(query).all(...params);

    if (items.length === 0) {
      throw new Error('কোনো অনিষ্পন্ন রেমিট্যান্স কিস্তি পাওয়া যায়নি।');
    }

    const grandTotal = items.reduce((acc, i) => acc + i.total_amount, 0);
    const inWords = amountInBengaliWords(grandTotal);
    const monthsList = Array.from(new Set(items.map(i => i.deduction_month))).sort();
    const datesList = Array.from(new Set(items.map(i => i.deduction_date))).sort();
    const minDate = from_date || datesList[0] || '';
    const maxDate = to_date   || datesList[datesList.length - 1] || '';
    const periodText = formatPeriodText(minDate, maxDate, monthsList);
    const distinctEmpCount = new Set(items.map(i => i.emp_code)).size;

    const ownPbs = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get();
    const count = db.prepare('SELECT COUNT(*) as count FROM bank_advices').get().count + 1;
    const yearStr = new Date(advice_date).getFullYear().toString();
    const adviceNo = `BA/${ownPbs.pbs_code || 'PBS'}/${yearStr}/${String(count).padStart(3, '0')}`;
    const memoPrefix = (ownPbs.memo_no_prefix || '২৭.১২.৬১০০.৫৪২.০১.০২৪').replace(/[.\-]+$/, '');
    const finalMemoNo = memo_no || `${memoPrefix}.${toBengaliDigits(yearStr.slice(-2))}-${toBengaliDigits(count + 120)}`;

    const insertAdvice = db.prepare(`
      INSERT INTO bank_advices (
        advice_no, memo_no, advice_date, target_pbs_id, target_pbs_name,
        target_bank_name, target_bank_branch, target_account_no, target_routing_no,
        from_bank_name, from_account_no, deduction_month, from_date, to_date, period_text,
        total_amount, amount_in_words, employee_count, remarks, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED')
    `);

    const result = insertAdvice.run(
      adviceNo, finalMemoNo, advice_date,
      null, 'সকল পবিস',
      'একাধিক ব্যাংক', '', '', '',
      ownPbs.bank_name + ', ' + ownPbs.bank_branch,
      ownPbs.account_no,
      monthsList.join(', '),
      minDate || null, maxDate || null, periodText,
      grandTotal, inWords, distinctEmpCount,
      remarks || `${periodText} বেতন হতে কর্তনকৃত সকল পবিসের গৃহ নির্মাণ ঋণ কিস্তি স্থানান্তর`
    );

    const adviceId = result.lastInsertRowid;

    const updateRepayment = db.prepare(`
      UPDATE repayments SET remittance_status = 'REMITTED', bank_advice_id = ? WHERE id = ?
    `);
    for (const item of items) { updateRepayment.run(adviceId, item.id); }

    return { adviceId, adviceNo, memoNo: finalMemoNo, periodText, grandTotal, inWords, itemCount: items.length, distinctEmpCount };
  });

  try {
    const data = transaction();
    logAudit(req, 'CREATE', 'BANK_ADVICE', data.adviceId,
      `সকল পবিস একত্রিত ব্যাংক অ্যাডভাইস: ${data.adviceNo}, সময়কাল: ${data.periodText}, মোট ${data.grandTotal} টাকা (${data.distinctEmpCount} জন)`);
    res.json({
      success: true,
      message: 'সকল পবিসের একত্রিত ব্যাংক অ্যাডভাইস সফলভাবে প্রস্তুত হয়েছে।',
      adviceId: data.adviceId, adviceNo: data.adviceNo, memoNo: data.memoNo,
      periodText: data.periodText, totalAmount: data.grandTotal, inWords: data.inWords
    });
  } catch (err) {
    console.error('Generate-all remittance error:', err);
    res.status(400).json({ success: false, message: err.message || 'একত্রিত ব্যাংক অ্যাডভাইস প্রস্তুতকরণ ব্যর্থ হয়েছে।' });
  }
});

// Soft Delete Bank Advice
router.delete('/advices/:id', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  const transaction = db.transaction(() => {
    const adviceId = req.params.id;
    const advice = db.prepare('SELECT * FROM bank_advices WHERE id = ? AND is_deleted = 0').get(adviceId);
    if (!advice) {
      throw new Error('ব্যাংক অ্যাডভাইস খুঁজে পাওয়া যায়নি।');
    }

    const now = new Date().toISOString();
    const deletedBy = req.user.username;

    // Mark advice deleted
    db.prepare(`
      UPDATE bank_advices
      SET is_deleted = 1, deleted_at = ?, deleted_by = ?
      WHERE id = ?
    `).run(now, deletedBy, adviceId);

    // Revert associated repayments back to PENDING
    db.prepare(`
      UPDATE repayments
      SET remittance_status = 'PENDING', bank_advice_id = NULL
      WHERE bank_advice_id = ?
    `).run(adviceId);

    return advice;
  });

  try {
    const advice = transaction();
    logAudit(req, 'DELETE', 'BANK_ADVICE', advice.id, `ব্যাংক অ্যাডভাইস বাতিল (কিস্তিসমূহ অনিষ্পন্ন তালিকায় ফেরত): ${advice.advice_no}`);
    res.json({ success: true, message: 'ব্যাংক অ্যাডভাইস বাতিল করা হয়েছে এবং কিস্তিসমূহ পুনরায় অনিষ্পন্ন তালিকায় যুক্ত হয়েছে।' });
  } catch (err) {
    console.error('Delete advice error:', err);
    res.status(400).json({ success: false, message: err.message || 'অ্যাডভাইস বাতিল করা যায়নি।' });
  }
});

module.exports = router;
