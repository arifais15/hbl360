const express = require('express');
const { authenticateToken, requireRole } = require('../lib/auth');
const { listRecords } = require('../lib/records');

const router = express.Router();

async function loadReportData() {
  const [employees, loans, repayments, provisions, advices, auditLogs] = await Promise.all([
    listRecords('employees'),
    listRecords('loans'),
    listRecords('repayments'),
    listRecords('interest_provisions'),
    listRecords('bank_advices', { includeDeleted: true }),
    listRecords('audit_logs')
  ]);
  return { employees, loans, repayments, provisions, advices, auditLogs };
}

function dateInRange(value, fromDate, toDate) {
  return (!fromDate || value >= fromDate) && (!toDate || value <= toDate);
}

function repaymentVoucher(repayment) {
  if (repayment.voucher_no) return repayment.voucher_no;
  const month = repayment.deduction_month || '';
  if (repayment.repayment_method === 'BANK_DEPOSIT') return `BD-${month}`;
  if (repayment.repayment_method === 'CASH') return `CR-${month}`;
  if (repayment.repayment_method === 'LUMPSUM_SETTLEMENT') return `SETTLE-${month}`;
  return `SALARY-${month}`;
}

function makeLoanLedger(loan, data) {
  const entries = [{
    date: loan.disbursement_date || loan.opening_balance_as_of || '',
    type: 'DISBURSEMENT',
    description: `ঋণ বিতরণ (আসল) - ${loan.loan_lot_name || ''}`,
    voucher: loan.loan_no,
    debitPrincipal: Number(loan.disbursed_amount || 0),
    creditPrincipal: 0,
    debitInterest: 0,
    creditInterest: 0
  }];
  const loanProvisions = loan.loan_source_type === 'OWN_PBS'
    ? data.provisions.filter(provision => provision.loan_id === loan.id)
    : [];
  const loanRepayments = data.repayments.filter(repayment => repayment.loan_id === loan.id);
  loanProvisions.forEach(provision => entries.push({
    date: provision.provision_date || '',
    type: 'INTEREST_PROVISION',
    description: `${provision.provision_month} মাসের সরল সুদ প্রভিশন (${provision.applied_rate}%)`,
    voucher: `PROV-${provision.provision_month}`,
    debitPrincipal: 0,
    creditPrincipal: 0,
    debitInterest: Number(provision.interest_amount || 0),
    creditInterest: 0
  }));
  loanRepayments.forEach(repayment => entries.push({
    date: repayment.deduction_date || '',
    type: 'REPAYMENT',
    repaymentMethod: repayment.repayment_method || 'SALARY_DEDUCTION',
    description: repayment.remarks || `${repayment.deduction_month || ''} কিস্তি আদায়`,
    voucher: repaymentVoucher(repayment),
    debitPrincipal: 0,
    creditPrincipal: Number(repayment.principal_paid || 0),
    debitInterest: 0,
    creditInterest: Number(repayment.interest_paid || 0)
  }));
  const eventOrder = { DISBURSEMENT: 1, INTEREST_PROVISION: 2, REPAYMENT: 3 };
  entries.sort((left, right) => String(left.date).localeCompare(String(right.date))
    || (eventOrder[left.type] || 0) - (eventOrder[right.type] || 0));
  let principal = 0;
  let interest = 0;
  entries.forEach(entry => {
    principal += entry.debitPrincipal - entry.creditPrincipal;
    interest += entry.debitInterest - entry.creditInterest;
    entry.principalBalance = principal;
    entry.interestBalance = interest;
    entry.netBalance = principal + interest;
  });
  const subtotal = {
    totalDisbursed: entries.reduce((sum, entry) => sum + entry.debitPrincipal, 0),
    totalPrincipalPaid: entries.reduce((sum, entry) => sum + entry.creditPrincipal, 0),
    totalInterestProvisioned: entries.reduce((sum, entry) => sum + entry.debitInterest, 0),
    totalInterestPaid: entries.reduce((sum, entry) => sum + entry.creditInterest, 0)
  };
  subtotal.principalBalance = subtotal.totalDisbursed - subtotal.totalPrincipalPaid;
  subtotal.interestBalance = subtotal.totalInterestProvisioned - subtotal.totalInterestPaid;
  subtotal.netBalance = subtotal.principalBalance + subtotal.interestBalance;
  return { loan, entries, subtotal };
}

function employeeSummaries(data) {
  const loansByEmployee = new Map();
  for (const loan of data.loans) {
    if (!loansByEmployee.has(loan.employee_id)) loansByEmployee.set(loan.employee_id, []);
    loansByEmployee.get(loan.employee_id).push(loan);
  }
  return data.employees.filter(employee => loansByEmployee.has(employee.id)).map(employee => {
    const loans = loansByEmployee.get(employee.id);
    return {
      id: employee.id,
      emp_code: employee.emp_code,
      name: employee.name,
      designation: employee.designation,
      department: employee.department,
      loan_count: loans.length,
      own_loan_count: loans.filter(loan => loan.loan_source_type === 'OWN_PBS').length,
      other_loan_count: loans.filter(loan => loan.loan_source_type === 'OTHER_PBS').length,
      total_disbursed: loans.reduce((sum, loan) => sum + Number(loan.disbursed_amount || 0), 0),
      total_principal_paid: loans.reduce((sum, loan) => sum + Number(loan.total_principal_paid || 0), 0),
      principal_balance: loans.reduce((sum, loan) => sum + Number(loan.principal_balance || 0), 0),
      interest_balance: loans.reduce((sum, loan) => sum + Number(loan.interest_balance || 0), 0),
      net_balance: loans.reduce((sum, loan) => sum + Number(loan.principal_balance || 0) + Number(loan.interest_balance || 0), 0)
    };
  }).sort((left, right) => String(left.emp_code).localeCompare(String(right.emp_code)));
}

router.get('/employee-loan-ledger', authenticateToken, async (req, res, next) => {
  try {
    const data = await loadReportData();
    const employees = employeeSummaries(data);
    const targetId = req.user.role === 'employee' ? req.user.employeeId : String(req.query.employeeId || '');
    if (!targetId) return res.json({ success: true, employees, ledger: null });
    const employee = data.employees.find(item => item.id === targetId);
    if (!employee) return res.status(404).json({ success: false, message: 'কর্মচারী পাওয়া যায়নি।' });
    const loanLedgers = data.loans.filter(loan => loan.employee_id === employee.id)
      .map(loan => makeLoanLedger(loan, data));
    const pbsMap = new Map();
    for (const ledger of loanLedgers) {
      const key = ledger.loan.origin_pbs_name || '';
      if (!pbsMap.has(key)) pbsMap.set(key, {
        pbsName: key,
        loanSourceType: ledger.loan.loan_source_type,
        totalDisbursed: 0,
        totalPrincipalPaid: 0,
        totalInterestProvisioned: 0,
        totalInterestPaid: 0,
        principalBalance: 0,
        interestBalance: 0,
        netBalance: 0,
        loanCount: 0
      });
      const summary = pbsMap.get(key);
      Object.keys(summary).filter(field => field !== 'pbsName' && field !== 'loanSourceType')
        .forEach(field => { summary[field] += ledger.subtotal[field] || 0; });
      summary.loanCount++;
    }
    const grandTotal = {
      totalDisbursed: loanLedgers.reduce((sum, ledger) => sum + ledger.subtotal.totalDisbursed, 0),
      totalPrincipalPaid: loanLedgers.reduce((sum, ledger) => sum + ledger.subtotal.totalPrincipalPaid, 0),
      totalInterestProvisioned: loanLedgers.reduce((sum, ledger) => sum + ledger.subtotal.totalInterestProvisioned, 0),
      totalInterestPaid: loanLedgers.reduce((sum, ledger) => sum + ledger.subtotal.totalInterestPaid, 0),
      principalBalance: loanLedgers.reduce((sum, ledger) => sum + ledger.subtotal.principalBalance, 0),
      interestBalance: loanLedgers.reduce((sum, ledger) => sum + ledger.subtotal.interestBalance, 0),
      netBalance: loanLedgers.reduce((sum, ledger) => sum + ledger.subtotal.netBalance, 0),
      loanCount: loanLedgers.length
    };
    res.json({ success: true, employees, employee, loans: loanLedgers.map(item => item.loan), loanLedgers, pbsSummary: [...pbsMap.values()], grandTotal });
  } catch (error) {
    next(error);
  }
});

router.get('/own-pbs-ledger', authenticateToken, async (req, res, next) => {
  try {
    const data = await loadReportData();
    let loans = data.loans.filter(loan => loan.loan_source_type === 'OWN_PBS');
    if (req.user.role === 'employee') loans = loans.filter(loan => loan.employee_id === req.user.employeeId);
    if (req.query.loanId) loans = loans.filter(loan => loan.id === String(req.query.loanId));
    const employeeById = new Map(data.employees.map(employee => [employee.id, employee]));
    const ledger = loans.map(loan => ({
      ...loan,
      emp_code: employeeById.get(loan.employee_id)?.emp_code,
      emp_name: employeeById.get(loan.employee_id)?.name,
      designation: employeeById.get(loan.employee_id)?.designation,
      department: employeeById.get(loan.employee_id)?.department
    }));
    if (req.query.loanId) {
      return res.json({
        success: true,
        loan: ledger[0],
        ledgerEntries: makeLoanLedger(loans[0], data).entries
      });
    }
    res.json({
      success: true,
      loans: ledger,
      ledgerEntries: []
    });
  } catch (error) {
    next(error);
  }
});

router.get('/other-pbs-ledger', authenticateToken, async (req, res, next) => {
  try {
    const data = await loadReportData();
    const loansById = new Map(data.loans.map(loan => [loan.id, loan]));
    const employeesById = new Map(data.employees.map(employee => [employee.id, employee]));
    const advicesById = new Map(data.advices.map(advice => [advice.id, advice]));
    const records = data.repayments.filter(repayment => {
      const loan = loansById.get(repayment.loan_id);
      return loan?.loan_source_type === 'OTHER_PBS'
        && (!loan.is_deleted)
        && (!req.user.employeeId || req.user.role !== 'employee' || repayment.employee_id === req.user.employeeId)
        && (!req.query.originPbsName || loan.origin_pbs_name === req.query.originPbsName)
        && (!req.query.month || repayment.deduction_month === req.query.month);
    }).map(repayment => {
      const loan = loansById.get(repayment.loan_id);
      const employee = employeesById.get(repayment.employee_id);
      const advice = advicesById.get(repayment.bank_advice_id);
      return {
        repayment_id: repayment.id,
        deduction_month: repayment.deduction_month,
        deduction_date: repayment.deduction_date,
        credit_deduction: Number(repayment.total_amount || 0),
        remittance_status: repayment.remittance_status,
        voucher_no: repayment.voucher_no,
        loan_no: loan.loan_no,
        sanction_no: loan.sanction_no,
        origin_pbs_name: loan.origin_pbs_name,
        emp_code: employee?.emp_code,
        emp_name: employee?.name,
        designation: employee?.designation,
        advice_no: advice?.advice_no,
        memo_no: advice?.memo_no,
        debit_remittance_date: advice?.advice_date,
        debit_remittance: repayment.remittance_status === 'REMITTED' ? Number(repayment.total_amount || 0) : 0
      };
    }).sort((left, right) => String(right.deduction_month).localeCompare(String(left.deduction_month))
      || String(right.repayment_id).localeCompare(String(left.repayment_id)));
    const groups = new Map();
    records.forEach(record => {
      if (!groups.has(record.origin_pbs_name)) groups.set(record.origin_pbs_name, {
        pbsName: record.origin_pbs_name,
        totalDeducted: 0,
        totalRemitted: 0,
        pendingRemittance: 0,
        itemsCount: 0
      });
      const group = groups.get(record.origin_pbs_name);
      group.totalDeducted += record.credit_deduction;
      group.totalRemitted += record.debit_remittance;
      group.itemsCount++;
      group.pendingRemittance = group.totalDeducted - group.totalRemitted;
    });
    res.json({ success: true, records, pbsSummary: [...groups.values()] });
  } catch (error) {
    next(error);
  }
});

router.get('/audit-logs', authenticateToken, requireRole(['admin', 'accounts']), async (req, res, next) => {
  try {
    const { action, entityType, username, fromDate, toDate, search } = req.query;
    const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit, 10) || 100));
    const searchText = String(search || '').toLocaleLowerCase();
    const logs = (await listRecords('audit_logs'))
      .filter(log => (!action || log.action === action)
        && (!entityType || log.entity === entityType || log.entity_type === entityType)
        && (!username || log.username === username)
        && dateInRange(String(log.created_at || '').slice(0, 10), fromDate, toDate)
        && (!searchText || `${log.details || ''} ${log.username || ''}`.toLocaleLowerCase().includes(searchText)))
      .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')))
      .slice(0, limit);
    res.json({ success: true, logs });
  } catch (error) {
    next(error);
  }
});

router.get('/comparative-statement', authenticateToken, async (req, res, next) => {
  try {
    const data = await loadReportData();
    const today = new Date().toISOString().slice(0, 10);
    const fiscalYear = date => {
      const [year, month] = date.split('-').map(Number);
      return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
    };
    const years = new Set([fiscalYear(today)]);
    [...data.loans.map(loan => loan.disbursement_date), ...data.repayments.map(repayment => repayment.deduction_date)]
      .filter(Boolean).forEach(date => years.add(fiscalYear(date)));
    const availableYears = [...years].sort().reverse();
    const selectedYears = req.query.years
      ? String(req.query.years).split(',').filter(year => /^\d{4}-\d{4}$/.test(year))
      : availableYears.slice(0, 4);
    const ownPbsStats = [];
    const otherPbsStats = [];
    selectedYears.forEach(year => {
      const [startYear, endYear] = year.split('-').map(Number);
      const start = `${startYear}-07-01`;
      const end = `${endYear}-06-30`;
      const inRange = value => value >= start && value <= end;
      const ownLoans = data.loans.filter(loan => loan.loan_source_type === 'OWN_PBS' && !loan.is_deleted);
      const ownRepayments = data.repayments.filter(repayment => {
        const loan = data.loans.find(item => item.id === repayment.loan_id);
        return loan?.loan_source_type === 'OWN_PBS' && !loan.is_deleted && !repayment.is_deleted && inRange(repayment.deduction_date || '');
      });
      const ownProvisions = data.provisions.filter(provision => {
        const loan = data.loans.find(item => item.id === provision.loan_id);
        return loan?.loan_source_type === 'OWN_PBS' && !provision.is_deleted && !loan?.is_deleted && inRange(provision.provision_date || '');
      });
      const otherRepayments = data.repayments.filter(repayment => {
        const loan = data.loans.find(item => item.id === repayment.loan_id);
        return loan?.loan_source_type === 'OTHER_PBS' && !loan.is_deleted && !repayment.is_deleted && inRange(repayment.deduction_date || '');
      });
      const advices = data.advices.filter(advice => !advice.is_deleted && advice.status === 'COMPLETED' && inRange(advice.advice_date || ''));
      const openingPrincipal = ownLoans.filter(loan => loan.disbursement_date < start)
        .reduce((sum, loan) => sum + Number(loan.disbursed_amount || 0), 0)
        - data.repayments.filter(repayment => {
          const loan = data.loans.find(item => item.id === repayment.loan_id);
          return loan?.loan_source_type === 'OWN_PBS' && !repayment.is_deleted && (repayment.deduction_date || '') < start;
        }).reduce((sum, repayment) => sum + Number(repayment.principal_paid || 0), 0);
      const openingInterest = data.provisions.filter(provision => {
        const loan = data.loans.find(item => item.id === provision.loan_id);
        return loan?.loan_source_type === 'OWN_PBS' && !provision.is_deleted && (provision.provision_date || '') < start;
      }).reduce((sum, provision) => sum + Number(provision.interest_amount || 0), 0)
        - data.repayments.filter(repayment => {
          const loan = data.loans.find(item => item.id === repayment.loan_id);
          return loan?.loan_source_type === 'OWN_PBS' && !repayment.is_deleted && (repayment.deduction_date || '') < start;
        }).reduce((sum, repayment) => sum + Number(repayment.interest_paid || 0), 0);
      const disbursed = ownLoans.filter(loan => inRange(loan.disbursement_date || ''));
      const principalRecovered = ownRepayments.reduce((sum, repayment) => sum + Number(repayment.principal_paid || 0), 0);
      const interestRecovered = ownRepayments.reduce((sum, repayment) => sum + Number(repayment.interest_paid || 0), 0);
      const interestProvisioned = ownProvisions.reduce((sum, provision) => sum + Number(provision.interest_amount || 0), 0);
      const closingPrincipal = Math.max(0, openingPrincipal + disbursed.reduce((sum, loan) => sum + Number(loan.disbursed_amount || 0), 0) - principalRecovered);
      const closingInterest = Math.max(0, openingInterest + interestProvisioned - interestRecovered);
      const otherDeducted = otherRepayments.reduce((sum, repayment) => sum + Number(repayment.total_amount || 0), 0);
      const otherRemitted = advices.reduce((sum, advice) => sum + Number(advice.total_amount || 0), 0);
      const priorOtherDeducted = data.repayments.filter(repayment => {
        const loan = data.loans.find(item => item.id === repayment.loan_id);
        return loan?.loan_source_type === 'OTHER_PBS' && !repayment.is_deleted && (repayment.deduction_date || '') < start;
      }).reduce((sum, repayment) => sum + Number(repayment.total_amount || 0), 0);
      const priorOtherRemitted = data.advices.filter(advice => !advice.is_deleted && (advice.advice_date || '') < start)
        .reduce((sum, advice) => sum + Number(advice.total_amount || 0), 0);
      ownPbsStats.push({
        fiscalYear: year,
        openingPrincipal: Math.max(0, openingPrincipal),
        openingInterest: Math.max(0, openingInterest),
        disbursed: disbursed.reduce((sum, loan) => sum + Number(loan.disbursed_amount || 0), 0),
        loanCount: disbursed.length,
        principalRecovered,
        interestProvisioned,
        interestRecovered,
        closingPrincipal,
        closingInterest,
        totalClosingBalance: closingPrincipal + closingInterest
      });
      otherPbsStats.push({
        fiscalYear: year,
        openingPayable: Math.max(0, priorOtherDeducted - priorOtherRemitted),
        deductedFromSalary: otherDeducted,
        deductionCount: otherRepayments.length,
        remittedToPBS: otherRemitted,
        adviceCount: advices.length,
        closingPayable: Math.max(0, priorOtherDeducted - priorOtherRemitted + otherDeducted - otherRemitted)
      });
    });
    res.json({ success: true, availableYears, statement: { fiscalYears: selectedYears, ownPbsStats, otherPbsStats, combinedStats: [] } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
