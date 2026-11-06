/**
 * PBS House Loan Calculation Service
 * Includes interest rate determination, monthly interest provisioning,
 * principal-first repayment deduction logic, and Bengali currency/number converters.
 */

const db = require('../database/db');

const CUTOFF_DATE = '2020-01-01';
const PRE_2020_RATE = 8.0;  // 8% simple interest per annum
const POST_2020_RATE = 7.0; // 7% simple interest per annum

/**
 * Determine interest rate based on date/month by checking configured interest_rules in database.
 * Rule:
 * - Up to December 2019 (pre-2020): 8.0% simple interest per annum
 * - From January 2020 onwards: 7.0% simple interest per annum (or user configured new rates & dates)
 */
function getApplicableInterestRate(periodMonthOrDate) {
  if (!periodMonthOrDate) return POST_2020_RATE;
  const str = String(periodMonthOrDate).trim();
  const dateStr = str.length === 7 ? `${str}-15` : str.slice(0, 10);

  try {
    const rule = db.prepare(`
      SELECT rate FROM interest_rules
      WHERE is_active = 1
        AND effective_from_date <= ?
        AND (effective_to_date IS NULL OR effective_to_date >= ?)
      ORDER BY effective_from_date DESC, id DESC
      LIMIT 1
    `).get(dateStr, dateStr);

    if (rule && rule.rate !== null && rule.rate !== undefined) {
      return parseFloat(rule.rate);
    }
  } catch (err) {
    // If DB is initializing or query fails, fall back to default government rule
  }

  if (str.length === 7) {
    return str < '2020-01' ? PRE_2020_RATE : POST_2020_RATE;
  }
  return str.slice(0, 10) < CUTOFF_DATE ? PRE_2020_RATE : POST_2020_RATE;
}

/**
 * Check if interest provisioning is required for this loan
 * Rule: Other PBS loans do NOT require interest provision in current PBS
 */
function isInterestProvisionApplicable(loanSourceType) {
  return loanSourceType === 'OWN_PBS';
}

/**
 * Calculate simple monthly interest provision on current principal balance.
 * If activeDays and daysInMonth are provided (for fraction months like disbursement or cutoff month),
 * it calculates the exact day-fraction interest:
 * Formula: ((Principal Balance * Annual Interest Rate) / (100 * 12)) * (activeDays / daysInMonth)
 */
function calculateMonthlyInterestProvision(principalBalance, annualRate, activeDays = null, daysInMonth = null) {
  if (principalBalance <= 0 || annualRate <= 0) return 0;
  const fullMonthInterest = (principalBalance * (annualRate / 100)) / 12;

  if (activeDays !== null && daysInMonth !== null && daysInMonth > 0 && activeDays < daysInMonth) {
    if (activeDays <= 0) return 0;
    const fractionInterest = fullMonthInterest * (activeDays / daysInMonth);
    return Math.round(fractionInterest);
  }

  return Math.round(fullMonthInterest); // Standard BREB accounting rounds to whole Taka
}

/**
 * Distribute monthly installment payment:
 * Rule: "আসল টাকা পরিশোধ হয়ে গেলে সুদের টাকা আদায় করা হয়।"
 * Repayment is first applied to Principal balance until it reaches 0.
 * Then interest is paid; any amount beyond both balances remains unapplied.
 */
function distributeRepayment(totalAmount, currentPrincipalBalance, currentInterestBalance) {
  const requestedAmount = Math.max(0, Number(totalAmount) || 0);
  const principalBalance = Math.max(0, Number(currentPrincipalBalance) || 0);
  const interestBalance = Math.max(0, Number(currentInterestBalance) || 0);
  const appliedAmount = Math.min(requestedAmount, principalBalance + interestBalance);
  const principalPaid = Math.min(appliedAmount, principalBalance);
  const interestPaid = Math.min(appliedAmount - principalPaid, interestBalance);
  const newPrincipalBalance = principalBalance - principalPaid;
  const newInterestBalance = interestBalance - interestPaid;

  return {
    principalPaid: Math.round(principalPaid),
    interestPaid: Math.round(interestPaid),
    newPrincipalBalance: Math.round(newPrincipalBalance),
    newInterestBalance: Math.round(newInterestBalance),
    appliedAmount: Math.round(appliedAmount),
    unappliedAmount: Math.round(requestedAmount - appliedAmount)
  };
}

/**
 * Convert English digits to Bengali digits
 */
function toBengaliDigits(num) {
  if (num === null || num === undefined) return '';
  const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return num.toString().replace(/\d/g, (d) => bnDigits[d]);
}

/**
 * Format currency in Bangladeshi style with commas (e.g. 12,34,567.00)
 */
function formatBDT(amount, showBengali = false) {
  if (amount === null || amount === undefined || isNaN(amount)) return showBengali ? '০' : '0';
  const val = Math.round(Number(amount));
  const str = val.toLocaleString('en-IN');
  return showBengali ? toBengaliDigits(str) : str;
}

/**
 * Convert number to Bengali words (টাকা কথায়)
 */
function amountInBengaliWords(number) {
  const n = Math.floor(number);
  if (n === 0) return 'শূন্য টাকা মাত্র';

  const bnNumbers1to99 = [
    '', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়',
    'দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোল', 'সতেরো', 'আঠারো', 'উনিশ',
    'বিশ', 'একুশ', 'বাইশ', 'তেইশ', 'চব্বিশ', 'পঁচিশ', 'ছাব্বিশ', 'সাতাশ', 'আঠাশ', 'উনত্রিশ',
    'ত্রিশ', 'একত্রিশ', 'বত্রিশ', 'তেত্রিশ', 'চৌত্রিশ', 'পঁয়ত্রিশ', 'ছত্রিশ', 'সাঁয়ত্রিশ', 'আটত্রিশ', 'উনচল্লিশ',
    'চল্লিশ', 'একচল্লিশ', 'বিয়াল্লিশ', 'তেতাল্লিশ', 'চুয়াল্লিশ', 'পঁয়তাল্লিশ', 'ছেচল্লিশ', 'সাতচল্লিশ', 'আটচল্লিশ', 'উনপঞ্চাশ',
    'পঞ্চাশ', 'একান্ন', 'বায়ান্ন', 'তিপ্পান্ন', 'চুয়ান্ন', 'পঞ্চান্ন', 'ছাপ্পান্ন', 'সাতান্ন', 'আটান্ন', 'উনষাট',
    'ষাট', 'একষট্টি', 'বাষট্টি', 'তেষট্টি', 'চৌষট্টি', 'পঁয়ষট্টি', 'ছেষট্টি', 'সাতষট্টি', 'আটষট্টি', 'উনসত্তর',
    'সত্তর', 'একাত্তর', 'বাহাত্তর', 'তিয়াত্তর', 'চুয়াত্তর', 'পঁচাত্তর', 'ছিয়াত্তর', 'সাতাত্তর', 'আটাত্তর', 'উনাশি',
    'আশি', 'একাশি', 'বিরাশি', 'তিরাশি', 'চুরাশি', 'পঁচাশি', 'ছিয়াশি', 'সাতাশি', 'আটাশি', 'ঊননব্বই',
    'নব্বই', 'একানব্বই', 'বানব্বই', 'তিরানব্বই', 'চুরানব্বই', 'পঁচানব্বই', 'ছিয়ানব্বই', 'সাতানব্বই', 'আটানব্বই', 'নিরানব্বই'
  ];

  function convertTwoDigits(num) {
    if (num <= 0) return '';
    if (num < 100) return bnNumbers1to99[num] || '';
    return '';
  }

  let words = '';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const hundred = Math.floor((n % 1000) / 100);
  const rest = n % 100;

  if (crore > 0) {
    words += convertTwoDigits(crore) + ' কোটি ';
  }
  if (lakh > 0) {
    words += convertTwoDigits(lakh) + ' লক্ষ ';
  }
  if (thousand > 0) {
    words += convertTwoDigits(thousand) + ' হাজার ';
  }
  if (hundred > 0) {
    words += bnNumbers1to99[hundred] + ' শত ';
  }
  if (rest > 0) {
    words += convertTwoDigits(rest);
  }

  return (words.trim() + ' টাকা মাত্র');
}

const BN_MONTHS = {
  '01': 'জানুয়ারি',
  '02': 'ফেব্রুয়ারি',
  '03': 'মার্চ',
  '04': 'এপ্রিল',
  '05': 'মে',
  '06': 'জুন',
  '07': 'জুলাই',
  '08': 'আগস্ট',
  '09': 'সেপ্টেম্বর',
  '10': 'অক্টোবর',
  '11': 'নভেম্বর',
  '12': 'ডিসেম্বর'
};

function formatBengaliMonth(yyyyMm) {
  if (!yyyyMm) return '';
  const parts = yyyyMm.split('-');
  const y = parts[0];
  const m = parts[1];
  const mName = BN_MONTHS[m] || m;
  return `${mName}/${toBengaliDigits(y)}`;
}

function formatPeriodText(fromDate, toDate, monthsList = []) {
  if (monthsList && monthsList.length > 0) {
    const sorted = [...new Set(monthsList)].sort();
    if (sorted.length === 1) {
      return `${formatBengaliMonth(sorted[0])} মাস`;
    }
    const startM = formatBengaliMonth(sorted[0]);
    const endM = formatBengaliMonth(sorted[sorted.length - 1]);
    return `${startM} হতে ${endM} পর্যন্ত (${toBengaliDigits(sorted.length)} মাস)`;
  }

  if (fromDate && toDate) {
    if (fromDate === toDate) {
      return `${toBengaliDigits(fromDate)} খ্রি:`;
    }
    return `${toBengaliDigits(fromDate)} হতে ${toBengaliDigits(toDate)} খ্রি: পর্যন্ত`;
  }

  return 'নির্ধারিত সময়কাল';
}

/**
 * Helper to get the last calendar date of a given month (e.g. '2024-05' -> '2024-05-31')
 */
function getMonthEndDate(yyyyMm) {
  if (!yyyyMm) return '';
  const parts = yyyyMm.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const lastDay = new Date(y, m, 0).getDate();
  return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Get the previous month string (e.g. '2024-05' -> '2024-04')
 */
function getPreviousMonth(yyyyMm) {
  if (!yyyyMm) return '';
  const parts = yyyyMm.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const prevDate = new Date(y, m - 2, 1);
  const py = prevDate.getFullYear();
  const pm = String(prevDate.getMonth() + 1).padStart(2, '0');
  return `${py}-${pm}`;
}

/**
 * Calculate month-by-month interest simulation schedule for a loan from disbursement/sanction date
 * to a user-specified cutoff date.
 * Rules:
 * - 12-month grace period from disbursement: No principal installment deduction during grace months,
 *   only monthly simple interest is calculated on full principal.
 * - From Month 13 onwards: Monthly principal deduction (default 120 installments, or user-editable installment),
 *   and monthly interest calculated on the reducing principal balance.
 * - Rate: 8% simple interest per annum up to 2019-12 (pre-2020), 7% from 2020-01 onwards.
 * - Formula: (Principal Balance * Rate / 100) / 12 rounded to nearest Taka.
 */
function calculateLoanInterestSchedule(options) {
  const {
    loanId,
    disbursedAmount = 0,
    disbursementDate,
    sanctionDate,
    fromDate,
    toDate,
    graceMonths = 12,
    installmentCount = 120,
    customInstallment = null,
    actualRepayments = null
  } = options;

  const startDateStr = fromDate || disbursementDate || sanctionDate;
  if (!startDateStr) {
    return { success: false, message: 'প্রারম্ভিক তারিখ বা ঋণ মঞ্জুরি/বিতরণের তারিখ পাওয়া যায়নি।' };
  }

  const startYear = parseInt(startDateStr.slice(0, 4), 10);
  const startMonth = parseInt(startDateStr.slice(5, 7), 10);
  const startDay = parseInt(startDateStr.slice(8, 10), 10) || 1;

  const endStr = toDate || new Date().toISOString().slice(0, 10);
  const endYear = parseInt(endStr.slice(0, 4), 10);
  const endMonth = parseInt(endStr.slice(5, 7), 10);
  const endDay = parseInt(endStr.slice(8, 10), 10) || 28;

  const totalPrincipal = Math.max(0, Math.round(Number(disbursedAmount) || 0));
  let runningPrincipal = totalPrincipal;
  let cumulativeInterest = 0;
  let cumulativePrincipalPaid = 0;

  // Default installment if not custom
  const defaultInstallment = (installmentCount > 0 && totalPrincipal > 0)
    ? Math.round(totalPrincipal / installmentCount)
    : 0;
  const monthlyDeduction = (customInstallment !== null && customInstallment !== undefined && customInstallment !== '')
    ? Math.max(0, Math.round(Number(customInstallment)))
    : defaultInstallment;

  const schedule = [];
  let monthIndex = 0;
  let curY = startYear;
  let curM = startMonth;

  while (curY < endYear || (curY === endYear && curM <= endMonth)) {
    monthIndex++;
    const monthKey = `${curY}-${String(curM).padStart(2, '0')}`;
    const rate = getApplicableInterestRate(monthKey);
    const openingPrincipal = runningPrincipal;

    // Total days in this current calendar month
    const daysInMonth = new Date(curY, curM, 0).getDate();

    // Determine start day and end day within this month
    const isFirstMonth = (curY === startYear && curM === startMonth);
    const isLastMonth = (curY === endYear && curM === endMonth);

    let activeStartDay = 1;
    let activeEndDay = daysInMonth;

    if (isFirstMonth) {
      activeStartDay = Math.min(Math.max(1, startDay), daysInMonth);
    }
    if (isLastMonth) {
      activeEndDay = Math.min(Math.max(1, endDay), daysInMonth);
    }

    // Number of active days for interest calculation
    // e.g. from 10th to 31st = (31 - 10 + 1) = 22 days
    const activeDays = Math.max(0, activeEndDay - activeStartDay + 1);
    const isFractionalMonth = (activeDays < daysInMonth);

    // Determine installment deduction for this month
    let principalDeduction = 0;
    if (actualRepayments && Array.isArray(actualRepayments)) {
      const match = actualRepayments.find(r => r.month === monthKey);
      if (match) {
        principalDeduction = Math.min(openingPrincipal, Math.max(0, Math.round(Number(match.principalPaid || 0))));
      }
    } else {
      if (monthIndex > graceMonths && openingPrincipal > 0) {
        principalDeduction = Math.min(openingPrincipal, monthlyDeduction);
      }
    }

    // Monthly interest calculation:
    // If full month: (Principal * Rate / 100) / 12
    // If fraction month: ((Principal * Rate / 100) / 12) * (activeDays / daysInMonth)
    let monthlyInterest = 0;
    if (openingPrincipal > 0 && activeDays > 0) {
      const fullMonthInterest = (openingPrincipal * (rate / 100)) / 12;
      const exactInterest = isFractionalMonth
        ? (fullMonthInterest * (activeDays / daysInMonth))
        : fullMonthInterest;
      monthlyInterest = Math.round(exactInterest);
    }

    const closingPrincipal = Math.max(0, openingPrincipal - principalDeduction);
    runningPrincipal = closingPrincipal;
    cumulativeInterest += monthlyInterest;
    cumulativePrincipalPaid += principalDeduction;

    let periodRemarks = 'পূর্ণ মাস';
    if (isFractionalMonth) {
      periodRemarks = `${activeStartDay} হতে ${activeEndDay} তারিখ (${activeDays}/${daysInMonth} দিন)`;
    }

    schedule.push({
      monthIndex,
      monthKey,
      monthNameBn: formatBengaliMonth(monthKey),
      isGracePeriod: monthIndex <= graceMonths,
      rate,
      daysInMonth,
      activeDays,
      activeStartDay,
      activeEndDay,
      isFractionalMonth,
      periodRemarks,
      openingPrincipal,
      principalDeduction,
      closingPrincipal,
      monthlyInterest,
      cumulativeInterest,
      cumulativePrincipalPaid
    });

    curM++;
    if (curM > 12) {
      curM = 1;
      curY++;
    }
  }

  // Generate dynamic rate breakdown: count months and total interest for each rate applied
  const rateBreakdownMap = {};
  for (const s of schedule) {
    const rKey = `${s.rate}%`;
    if (!rateBreakdownMap[rKey]) {
      rateBreakdownMap[rKey] = { rate: s.rate, months: 0, interest: 0 };
    }
    rateBreakdownMap[rKey].months += 1;
    rateBreakdownMap[rKey].interest += s.monthlyInterest;
  }
  const rateBreakdown = Object.values(rateBreakdownMap).sort((a, b) => a.rate - b.rate);

  return {
    success: true,
    totalPrincipal,
    startDate: startDateStr,
    endDate: endStr,
    graceMonths,
    monthlyDeduction,
    totalMonths: schedule.length,
    cumulativeInterest,
    cumulativePrincipalPaid,
    remainingPrincipal: runningPrincipal,
    rateBreakdown,
    schedule
  };
}

module.exports = {
  CUTOFF_DATE,
  PRE_2020_RATE,
  POST_2020_RATE,
  getApplicableInterestRate,
  getMonthEndDate,
  getPreviousMonth,
  isInterestProvisionApplicable,
  calculateMonthlyInterestProvision,
  calculateLoanInterestSchedule,
  distributeRepayment,
  toBengaliDigits,
  formatBDT,
  amountInBengaliWords,
  formatBengaliMonth,
  formatPeriodText
};

