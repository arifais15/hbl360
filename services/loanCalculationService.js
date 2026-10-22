/**
 * PBS House Loan Calculation Service
 * Includes interest rate determination, monthly interest provisioning,
 * principal-first repayment deduction logic, and Bengali currency/number converters.
 */

const CUTOFF_DATE = '2020-01-01';
const PRE_2020_RATE = 8.0;  // 8% simple interest per annum
const POST_2020_RATE = 7.0; // 7% simple interest per annum

/**
 * Determine default interest rate based on calculation period/month (NOT loan disbursement date)
 * Rule:
 * - Up to December 2019 (pre-2020): 8.0% simple interest per annum on unpaid balance
 * - From January 2020 onwards: 7.0% simple interest per annum on unpaid balance of the same loan
 */
function getApplicableInterestRate(periodMonthOrDate) {
  if (!periodMonthOrDate) return POST_2020_RATE;
  const str = String(periodMonthOrDate).trim();
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
 * Calculate simple monthly interest provision on current principal balance
 * Formula: (Principal Balance * Annual Interest Rate) / (100 * 12)
 */
function calculateMonthlyInterestProvision(principalBalance, annualRate) {
  if (principalBalance <= 0 || annualRate <= 0) return 0;
  const rawInterest = (principalBalance * (annualRate / 100)) / 12;
  return Math.round(rawInterest); // Standard BREB accounting rounds to whole Taka
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

  const units = ['', 'এক', 'দুই', 'তিন', 'চার', 'পাঁচ', 'ছয়', 'সাত', 'আট', 'নয়'];
  const teens = ['দশ', 'এগারো', 'বারো', 'তেরো', 'চৌদ্দ', 'পনেরো', 'ষোল', 'সতেরো', 'আঠারো', 'উনিশ'];
  const tens = ['', '', 'বিশ', 'ত্রিশ', 'চল্লিশ', 'পঞ্চাশ', 'ষাট', 'সত্তর', 'আশি', 'নব্বই'];

  function convertTwoDigits(num) {
    if (num === 0) return '';
    if (num < 10) return units[num];
    if (num < 20) return teens[num - 10];
    const t = Math.floor(num / 10);
    const u = num % 10;
    return (tens[t] + (u !== 0 ? ' ' + units[u] : '')).trim();
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
    words += units[hundred] + ' শত ';
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

module.exports = {
  CUTOFF_DATE,
  PRE_2020_RATE,
  POST_2020_RATE,
  getApplicableInterestRate,
  getMonthEndDate,
  getPreviousMonth,
  isInterestProvisionApplicable,
  calculateMonthlyInterestProvision,
  distributeRepayment,
  toBengaliDigits,
  formatBDT,
  amountInBengaliWords,
  formatBengaliMonth,
  formatPeriodText
};
