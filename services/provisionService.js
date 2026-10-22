const db = require('../database/db');
const { calculateMonthlyInterestProvision, getApplicableInterestRate, getMonthEndDate } = require('./loanCalculationService');

/**
 * Calculate the principal balance as of the end of the previous month (monthly rest balance).
 * Rule:
 * "it should calculate just previous month ending balance and posted month ending date"
 *
 * Balance at end of (targetMonth - 1) =
 * current loan.principal_balance + sum of principal repaid in repayments with deduction_month >= targetMonth
 */
function getPreviousMonthEndingPrincipalBalance(loan, targetMonth) {
  if (!loan) return 0;
  const disbMonth = (loan.disbursement_date || '').slice(0, 7);
  if (disbMonth && disbMonth > targetMonth) return 0;
  if (disbMonth && disbMonth === targetMonth) return loan.disbursed_amount;

  const futureRepayments = db.prepare(`
    SELECT COALESCE(SUM(principal_paid), 0) as totalFutureRepayments
    FROM repayments
    WHERE loan_id = ?
      AND deduction_month >= ?
      AND is_deleted = 0
  `).get(loan.id, targetMonth);

  return Math.max(0, Math.round(loan.principal_balance + (futureRepayments ? futureRepayments.totalFutureRepayments : 0)));
}

/**
 * Auto-run monthly interest provision for a specific month (e.g. '2026-10') or current month.
 * Government Rules:
 * 1. Pre-2020 (Up to Dec-2019 / month <= '2019-12'): 8% simple interest per annum on unpaid principal balance
 * 2. Post-2020 (From Jan-2020 onwards / month >= '2020-01'): 7% simple interest per annum on unpaid principal balance of the same loan
 * 3. Monthly rest balance: Calculates interest strictly on the just previous month's ending balance
 * 4. Posted month ending date: Posting date is the last day of the target month (e.g. 2024-05-31)
 * 5. Other PBS loans: No interest provision in current PBS (0%)
 * 6. Formula: (principal_balance * rate / 100) / 12 rounded to nearest Taka
 * 7. Automatically added to loans.interest_balance (সুদ কলামে যোগ হবে)
 */
function autoProvisionMonth(targetMonth = null, targetDate = null) {
  const month = targetMonth || new Date().toISOString().slice(0, 7);
  const date = targetDate || getMonthEndDate(month);

  // Select eligible loans: OWN_PBS, active, principal > 0, not yet provisioned for this month
  const eligibleLoans = db.prepare(`
    SELECT l.*, e.name as emp_name, e.emp_code
    FROM loans l
    JOIN employees e ON l.employee_id = e.id
    WHERE l.loan_source_type = 'OWN_PBS'
      AND l.is_interest_applicable = 1
      AND l.status = 'ACTIVE'
      AND l.principal_balance > 0
      AND l.is_deleted = 0
      AND (l.opening_balance_as_of IS NULL OR substr(l.opening_balance_as_of, 1, 7) < ?)
      AND e.is_deleted = 0
      AND l.id NOT IN (
        SELECT loan_id FROM interest_provisions
        WHERE provision_month = ?
      )
    ORDER BY l.id ASC
  `).all(month, month);

  if (eligibleLoans.length === 0) {
    return { count: 0, totalInterest: 0, month };
  }

  const insertProvision = db.prepare(`
    INSERT INTO interest_provisions (
      loan_id, employee_id, provision_month, provision_date, applied_rate,
      principal_amount_on_date, interest_amount, previous_interest_balance, new_interest_balance
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateLoanInterest = db.prepare(`
    UPDATE loans
    SET interest_balance = interest_balance + ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  let count = 0;
  let totalInterest = 0;

  const runTx = db.transaction(() => {
    for (const loan of eligibleLoans) {
      // Determine applicable rate:
      // Up to 2019-12 (pre-2020): 8% simple interest per annum on unpaid balance
      // From 2020-01 onwards: 7% simple interest per annum on unpaid balance of the same loan
      let rate = getApplicableInterestRate(month);
      if (loan.custom_interest_rate !== null && loan.custom_interest_rate !== undefined && loan.custom_interest_rate !== '') {
        rate = parseFloat(loan.custom_interest_rate);
      }

      // Monthly rest balance: interest is calculated on the just previous month ending balance
      const principalOnDate = getPreviousMonthEndingPrincipalBalance(loan, month);
      const interestAmt = calculateMonthlyInterestProvision(principalOnDate, rate);

      if (interestAmt > 0) {
        insertProvision.run(
          loan.id,
          loan.employee_id,
          month,
          date,
          rate,
          principalOnDate,
          interestAmt,
          loan.interest_balance,
          loan.interest_balance + interestAmt
        );

        updateLoanInterest.run(interestAmt, loan.id);

        count++;
        totalInterest += interestAmt;
      }
    }
  });

  runTx();

  return { count, totalInterest, month };
}

/**
 * Auto-sync all unprovisioned months that have repayments or active balances up to current month
 */
function autoSyncAllPendingProvisions() {
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Collect distinct deduction months and current month
  const deductionMonths = db.prepare(`
    SELECT DISTINCT deduction_month as m
    FROM repayments
    WHERE is_deleted = 0
    ORDER BY deduction_month ASC
  `).all().map(r => r.m);

  if (!deductionMonths.includes(currentMonth)) {
    deductionMonths.push(currentMonth);
  }

  let totalProcessed = 0;
  let totalInterestAdded = 0;
  const processedMonths = [];

  for (const m of deductionMonths) {
    const res = autoProvisionMonth(m, getMonthEndDate(m));
    if (res.count > 0) {
      totalProcessed += res.count;
      totalInterestAdded += res.totalInterest;
      processedMonths.push(m);
    }
  }

  return {
    totalProcessed,
    totalInterestAdded,
    processedMonths
  };
}

module.exports = {
  autoProvisionMonth,
  autoSyncAllPendingProvisions,
  getPreviousMonthEndingPrincipalBalance
};
