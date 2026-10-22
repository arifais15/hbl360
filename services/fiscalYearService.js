const db = require('../database/db');

/**
 * Bangladesh Financial Year Helper
 * Fiscal year runs from July 1 of Year Y to June 30 of Year Y+1
 * e.g., 2023-2024 = 2023-07-01 to 2024-06-30
 */

/**
 * Determine Financial Year string for any given date (YYYY-MM-DD)
 */
function getFiscalYearForDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12
  if (month >= 7) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
}

/**
 * Get Start and End dates for a Fiscal Year string (e.g. '2023-2024')
 */
function getFiscalYearDateRange(fyString) {
  const parts = fyString.split('-');
  const startYear = parseInt(parts[0], 10);
  const endYear = parseInt(parts[1], 10);
  return {
    startDate: `${startYear}-07-01`,
    endDate: `${endYear}-06-30`
  };
}

/**
 * Get list of available financial years based on loan records
 */
function getAvailableFiscalYears() {
  const years = new Set();
  
  // From loans disbursement
  const loanDates = db.prepare(`SELECT disbursement_date FROM loans WHERE is_deleted = 0`).all();
  loanDates.forEach(r => {
    if (r.disbursement_date) years.add(getFiscalYearForDate(r.disbursement_date));
  });

  // From repayments
  const repDates = db.prepare(`SELECT deduction_date FROM repayments WHERE is_deleted = 0`).all();
  repDates.forEach(r => {
    if (r.deduction_date) years.add(getFiscalYearForDate(r.deduction_date));
  });

  // Always ensure current and previous 2 fiscal years are available
  const today = new Date().toISOString().slice(0, 10);
  const currentFY = getFiscalYearForDate(today);
  years.add(currentFY);
  const parts = currentFY.split('-');
  const prevFY = `${parseInt(parts[0]) - 1}-${parseInt(parts[0])}`;
  const prevPrevFY = `${parseInt(parts[0]) - 2}-${parseInt(parts[0]) - 1}`;
  years.add(prevFY);
  years.add(prevPrevFY);

  return Array.from(years).sort().reverse();
}

/**
 * Generate Comparative Statement across multiple Fiscal Years
 * Separate metrics for:
 * 1. Own PBS Loans (নিজস্ব পবিসের ঋণ)
 * 2. Other PBS Loans (অন্য পবিসের ঋণ কর্তন ও প্রেরণ)
 * 3. Total Combined
 */
function getFiscalYearComparativeStatement(fiscalYears) {
  if (!fiscalYears || fiscalYears.length === 0) {
    fiscalYears = getAvailableFiscalYears().slice(0, 4); // default last 4 FYs
  }

  const statement = {
    fiscalYears,
    ownPbsStats: [],
    otherPbsStats: [],
    combinedStats: []
  };

  for (const fy of fiscalYears) {
    const { startDate, endDate } = getFiscalYearDateRange(fy);

    // --- OWN PBS STATS ---
    // 1. Loans disbursed before this FY
    const ownOpeningDisbursed = db.prepare(`
      SELECT COALESCE(SUM(disbursed_amount), 0) as total
      FROM loans
      WHERE loan_source_type = 'OWN_PBS' AND disbursement_date < ? AND is_deleted = 0
    `).get(startDate).total;

    const ownOpeningPrincipalRepaid = db.prepare(`
      SELECT COALESCE(SUM(r.principal_paid), 0) as total
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      WHERE l.loan_source_type = 'OWN_PBS' AND r.deduction_date < ? AND r.is_deleted = 0 AND l.is_deleted = 0
    `).get(startDate).total;

    const ownOpeningPrincipal = Math.max(0, ownOpeningDisbursed - ownOpeningPrincipalRepaid);

    // Opening Interest
    const ownOpeningInterestProvisioned = db.prepare(`
      SELECT COALESCE(SUM(p.interest_amount), 0) as total
      FROM interest_provisions p
      JOIN loans l ON p.loan_id = l.id
      WHERE l.loan_source_type = 'OWN_PBS' AND p.provision_date < ? AND p.is_deleted = 0 AND l.is_deleted = 0
    `).get(startDate).total;

    const ownOpeningInterestRepaid = db.prepare(`
      SELECT COALESCE(SUM(r.interest_paid), 0) as total
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      WHERE l.loan_source_type = 'OWN_PBS' AND r.deduction_date < ? AND r.is_deleted = 0 AND l.is_deleted = 0
    `).get(startDate).total;

    const ownOpeningInterest = Math.max(0, ownOpeningInterestProvisioned - ownOpeningInterestRepaid);

    // Transactions DURING this FY
    const ownDisbursedInFY = db.prepare(`
      SELECT COALESCE(SUM(disbursed_amount), 0) as total, COUNT(*) as count
      FROM loans
      WHERE loan_source_type = 'OWN_PBS' AND disbursement_date BETWEEN ? AND ? AND is_deleted = 0
    `).get(startDate, endDate);

    const ownPrincipalRepaidInFY = db.prepare(`
      SELECT COALESCE(SUM(r.principal_paid), 0) as total
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      WHERE l.loan_source_type = 'OWN_PBS' AND r.deduction_date BETWEEN ? AND ? AND r.is_deleted = 0 AND l.is_deleted = 0
    `).get(startDate, endDate).total;

    const ownInterestProvisionedInFY = db.prepare(`
      SELECT COALESCE(SUM(p.interest_amount), 0) as total
      FROM interest_provisions p
      JOIN loans l ON p.loan_id = l.id
      WHERE l.loan_source_type = 'OWN_PBS' AND p.provision_date BETWEEN ? AND ? AND p.is_deleted = 0 AND l.is_deleted = 0
    `).get(startDate, endDate).total;

    const ownInterestRepaidInFY = db.prepare(`
      SELECT COALESCE(SUM(r.interest_paid), 0) as total
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      WHERE l.loan_source_type = 'OWN_PBS' AND r.deduction_date BETWEEN ? AND ? AND r.is_deleted = 0 AND l.is_deleted = 0
    `).get(startDate, endDate).total;

    const ownClosingPrincipal = Math.max(0, ownOpeningPrincipal + ownDisbursedInFY.total - ownPrincipalRepaidInFY);
    const ownClosingInterest = Math.max(0, ownOpeningInterest + ownInterestProvisionedInFY - ownInterestRepaidInFY);

    statement.ownPbsStats.push({
      fiscalYear: fy,
      openingPrincipal: ownOpeningPrincipal,
      openingInterest: ownOpeningInterest,
      disbursed: ownDisbursedInFY.total,
      loanCount: ownDisbursedInFY.count,
      principalRecovered: ownPrincipalRepaidInFY,
      interestProvisioned: ownInterestProvisionedInFY,
      interestRecovered: ownInterestRepaidInFY,
      closingPrincipal: ownClosingPrincipal,
      closingInterest: ownClosingInterest,
      totalClosingBalance: ownClosingPrincipal + ownClosingInterest
    });

    // --- OTHER PBS STATS (Inter-PBS Loan Recovery & Remittances) ---
    // Total Deductions in FY
    const otherDeductedInFY = db.prepare(`
      SELECT COALESCE(SUM(r.total_amount), 0) as total, COUNT(*) as count
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      WHERE l.loan_source_type = 'OTHER_PBS' AND r.deduction_date BETWEEN ? AND ? AND r.is_deleted = 0 AND l.is_deleted = 0
    `).get(startDate, endDate);

    // Total Remitted to Other PBS via Bank Advice in FY
    const otherRemittedInFY = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(*) as count
      FROM bank_advices
      WHERE advice_date BETWEEN ? AND ? AND is_deleted = 0 AND status = 'COMPLETED'
    `).get(startDate, endDate);

    // Cumulative opening deducted minus remitted
    const otherPriorDeducted = db.prepare(`
      SELECT COALESCE(SUM(r.total_amount), 0) as total
      FROM repayments r
      JOIN loans l ON r.loan_id = l.id
      WHERE l.loan_source_type = 'OTHER_PBS' AND r.deduction_date < ? AND r.is_deleted = 0 AND l.is_deleted = 0
    `).get(startDate).total;

    const otherPriorRemitted = db.prepare(`
      SELECT COALESCE(SUM(total_amount), 0) as total
      FROM bank_advices
      WHERE advice_date < ? AND is_deleted = 0 AND status = 'COMPLETED'
    `).get(startDate).total;

    const otherOpeningPayable = Math.max(0, otherPriorDeducted - otherPriorRemitted);
    const otherClosingPayable = Math.max(0, otherOpeningPayable + otherDeductedInFY.total - otherRemittedInFY.total);

    statement.otherPbsStats.push({
      fiscalYear: fy,
      openingPayable: otherOpeningPayable,
      deductedFromSalary: otherDeductedInFY.total,
      deductionCount: otherDeductedInFY.count,
      remittedToPBS: otherRemittedInFY.total,
      adviceCount: otherRemittedInFY.count,
      closingPayable: otherClosingPayable
    });
  }

  return statement;
}

module.exports = {
  getFiscalYearForDate,
  getFiscalYearDateRange,
  getAvailableFiscalYears,
  getFiscalYearComparativeStatement
};
