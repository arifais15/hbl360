/**
 * PBS House Loan Management System - Main Controller
 * Handles SPA state, UI renderers, calculators, forms, and official printable documents.
 */

// Application State
const state = {
  user: null,
  activeTab: 'dashboard',
  pbsSettings: null,
  otherPbsList: [],
  employees: [],
  loans: [],
  activeLoanFilter: '',
  selectedDocumentAdvice: null,
  currentDocView: 'letter' // 'letter' or 'advice'
};

async function confirmWithSweetAlert(text, options = {}) {
  const result = await Swal.fire({
    icon: 'warning',
    text,
    showCancelButton: true,
    confirmButtonText: 'হ্যাঁ, নিশ্চিত',
    cancelButtonText: 'না, বাতিল করুন',
    confirmButtonColor: '#e11d48',
    cancelButtonColor: '#6b7280',
    reverseButtons: true,
    focusCancel: true,
    ...options
  });
  return result.isConfirmed;
}

// Bengali Digits and Currency Formatters
function toBn(num) {
  if (num === null || num === undefined) return '';
  const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  return num.toString().replace(/\d/g, (d) => bnDigits[d]);
}

function formatBDT(amount, showBn = true) {
  if (amount === null || amount === undefined || isNaN(amount)) return showBn ? '০' : '0';
  const val = Math.round(Number(amount));
  const formatted = val.toLocaleString('en-IN');
  return showBn ? toBn(formatted) : formatted;
}

function formatIpcAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return toBn('0.00');
  return toBn(value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function renderPbsLetterhead(settings = {}) {
  const pbsName = escapeHtml(settings.pbs_name || '');
  const englishName = escapeHtml(settings.pbs_english_name || '');
  const subtitle = escapeHtml(settings.letterhead_subtitle || '');
  const rightTitle = escapeHtml(settings.letterhead_right_title || '');
  const address = escapeHtml(settings.address || '');
  const phone = escapeHtml(settings.phone || '');
  const email = escapeHtml(settings.email || '');
  const website = escapeHtml(settings.website || '');
  const badgeText = escapeHtml(settings.letterhead_badge_text || '');
  const logoUrl = typeof settings.logo_url === 'string' && settings.logo_url.startsWith('/uploads/letterhead/')
    ? escapeHtml(settings.logo_url)
    : '/logo.jpg';

  return `
    <div style="display:flex;align-items:center;width:100%;border-bottom:2px solid #111;margin:0 0 10px;padding:0 0 8px;color:#111;font-family:inherit">
        <div style="width:19%;text-align:center;padding:4px">
          <img src="${logoUrl}" alt="সমিতির লোগো" style="width:78px;height:70px;object-fit:contain;display:block;margin:0 auto" onerror="this.onerror=null;this.src='/logo.jpg'">
          ${badgeText ? `<div style="font-size:9px;font-weight:600;margin-top:2px">${badgeText}</div>` : ''}
        </div>
        <div style="width:53%;text-align:center;padding:4px">
          ${subtitle ? `<div style="font-size:11px;font-weight:600">${subtitle}</div>` : ''}
          <div style="font-size:20px;font-weight:800;line-height:1.3">${pbsName}</div>
          ${englishName ? `<div style="font-size:11px;font-weight:700">${englishName}</div>` : ''}
          ${website ? `<div style="font-size:10px;font-weight:600">${website}</div>` : ''}
        </div>
        <div style="width:28%;text-align:right;padding:4px;font-size:10px;line-height:1.5">
          ${rightTitle ? `<div style="font-weight:700">${rightTitle}</div>` : ''}
          ${address ? `<div>${address}</div>` : ''}
          ${phone ? `<div>ফোন: ${phone}</div>` : ''}
          ${email ? `<div>ই-মেইল: ${email}</div>` : ''}
        </div>
    </div>
  `;
}

const PBS_AGM_FINANCE_TITLE = 'সহকারী মহাব্যবস্থাপক (অর্থ-হিসাব)';
const PBS_GENERAL_MANAGER_TITLE = 'সিনিয়র জেনারেল ম্যানেজার / জেনারেল ম্যানেজার';

const BN_MONTHS_MAP = {
  '01': 'জানুয়ারি', '02': 'ফেব্রুয়ারি', '03': 'মার্চ', '04': 'এপ্রিল',
  '05': 'মে', '06': 'জুন', '07': 'জুলাই', '08': 'আগস্ট',
  '09': 'সেপ্টেম্বর', '10': 'অক্টোবর', '11': 'নভেম্বর', '12': 'ডিসেম্বর'
};

function formatBengaliMonth(yyyyMm) {
  if (!yyyyMm) return '';
  const parts = yyyyMm.split('-');
  const y = parts[0];
  const m = parts[1];
  const mName = BN_MONTHS_MAP[m] || m;
  return `${mName}'${toBn(y ? y.slice(-2) : '')}`;
}

function formatMonthsList(months) {
  if (!months || months.length === 0) return '';
  const sorted = [...new Set(months)].sort();
  if (sorted.length === 1) return formatBengaliMonth(sorted[0]);
  if (sorted.length === 2) return `${formatBengaliMonth(sorted[0])} ও ${formatBengaliMonth(sorted[1])}`;
  const allExceptLast = sorted.slice(0, -1).map(formatBengaliMonth).join(', ');
  return `${allExceptLast} ও ${formatBengaliMonth(sorted[sorted.length - 1])}`;
}

function formatIpcMonthsRange(months) {
  const shortMonths = {
    '01': 'জানু', '02': 'ফেব্রু', '03': 'মার্চ', '04': 'এপ্রি',
    '05': 'মে', '06': 'জুন', '07': 'জুলা', '08': 'আগস্ট',
    '09': 'সেপ্টে', '10': 'অক্টো', '11': 'নভে', '12': 'ডিসে'
  };
  const sorted = [...new Set(months)].filter(month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)).sort();
  if (sorted.length === 0) return '';

  const monthIndex = month => {
    const [year, monthNumber] = month.split('-').map(Number);
    return year * 12 + monthNumber - 1;
  };
  const groups = [];
  sorted.forEach(month => {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && monthIndex(month) === monthIndex(lastGroup[lastGroup.length - 1]) + 1) {
      lastGroup.push(month);
    } else {
      groups.push([month]);
    }
  });

  return groups.map(group => {
    const first = group[0];
    const last = group[group.length - 1];
    const firstMonth = shortMonths[first.slice(5)] || first.slice(5);
    const firstYear = toBn(first.slice(2, 4));
    if (group.length === 1) return `${firstMonth}/${firstYear}`;

    const lastMonth = shortMonths[last.slice(5)] || last.slice(5);
    const lastYear = toBn(last.slice(2, 4));
    if (first.slice(0, 4) === last.slice(0, 4)) {
      return `${firstMonth}-${lastMonth}/${firstYear}`;
    }
    return `${firstMonth}/${firstYear}-${lastMonth}/${lastYear}`;
  }).join(', ');
}

function toBengaliCalendarDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  const monthDays = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, (isLeap ? 30 : 29), 30];
  const bnMonthNames = [
    'বৈশাখ', 'জ্যৈষ্ঠ', 'আষাঢ়', 'শ্রাবণ', 'ভাদ্র', 'আশ্বিন',
    'কার্তিক', 'অগ্রহায়ণ', 'পৌষ', 'মাঘ', 'ফাল্গুন', 'চৈত্র'
  ];
  const startOfBnYear = new Date(year, 3, 14);
  let bnYear, diffDays;
  if (d >= startOfBnYear) {
    bnYear = year - 593;
    diffDays = Math.floor((d - startOfBnYear) / (1000 * 60 * 60 * 24));
  } else {
    bnYear = year - 594;
    const prevStart = new Date(year - 1, 3, 14);
    diffDays = Math.floor((d - prevStart) / (1000 * 60 * 60 * 24));
  }
  let mIdx = 0;
  while (mIdx < 12 && diffDays >= monthDays[mIdx]) {
    diffDays -= monthDays[mIdx];
    mIdx++;
  }
  const bnDay = diffDays + 1;
  const bnMonth = bnMonthNames[mIdx] || '';
  return `${toBn(bnDay)} ${bnMonth} ${toBn(bnYear)} বঙ্গাব্দ`;
}


function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-800 text-white border-emerald-900',
    error: 'bg-red-800 text-white border-red-900',
    info: 'bg-blue-800 text-white border-blue-900'
  };

  toast.className = `${colors[type] || colors.info} border px-4 py-3 rounded-xl shadow-xl text-sm font-medium transition-all duration-300 flex items-center space-x-2 pointer-events-auto`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-x-4');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

async function importExcelFile(input, endpoint, label, afterImport) {
  const file = input.files?.[0];
  if (!file) return;

  try {
    const confirmed = await confirmWithSweetAlert(
      `${file.name} ফাইলের তথ্য আমদানি করবেন? একই পে আইডি/ঋণ নম্বর থাকলে সেই সারি বাদ যাবে।`,
      {
        title: `${label} Excel আমদানি`,
        confirmButtonText: 'আমদানি করুন'
      }
    );
    if (!confirmed) return;

    Swal.fire({
      title: 'আমদানি চলছে...',
      text: 'Excel ফাইল যাচাই ও সংরক্ষণ করা হচ্ছে।',
      allowOutsideClick: false,
      allowEscapeKey: false,
      didOpen: () => Swal.showLoading()
    });

    const result = await API.postFile(endpoint, file);
    Swal.close();
    await afterImport();

    const skippedRows = (result.skipped || []).slice(0, 10)
      .map(item => `সারি ${item.row}: ${item.reason}`)
      .join('\n');
    const skippedRemainder = (result.skipped?.length || 0) > 10
      ? `\nআরও ${result.skipped.length - 10}টি duplicate row বাদ দেওয়া হয়েছে।`
      : '';
    const skippedText = result.skipped?.length
      ? `\nবাদ দেওয়া হয়েছে: ${result.skipped.length}টি duplicate row\n${skippedRows}${skippedRemainder}`
      : '';
    const employeeLoginText = endpoint === '/employees/import'
      ? '\nকর্মচারী লগইন তৈরি হয়েছে; ডিফল্ট পাসওয়ার্ড: password123'
      : '';
    await Swal.fire({
      icon: 'success',
      title: 'আমদানি সম্পন্ন',
      text: `${result.message}${skippedText}${employeeLoginText}`,
      confirmButtonText: 'ঠিক আছে',
      confirmButtonColor: '#059669'
    });
  } catch (error) {
    Swal.close();
    const rowErrors = error.data?.errors || [];
    const details = rowErrors.slice(0, 15)
      .map(item => `সারি ${item.row}: ${item.message}`)
      .join('\n');
    const remaining = rowErrors.length > 15 ? `\nআরও ${rowErrors.length - 15}টি ভুল আছে।` : '';
    await Swal.fire({
      icon: 'error',
      title: 'আমদানি ব্যর্থ',
      text: [error.message, details, remaining].filter(Boolean).join('\n'),
      confirmButtonText: 'ঠিক আছে',
      confirmButtonColor: '#e11d48'
    });
  } finally {
    input.value = '';
  }
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('hidden');
  if (id === 'newEmployeeModal' && !document.getElementById('empEditId')?.value) {
    populateEmployeePostingDropdown();
  }
  if (window.lucide) lucide.createIcons();
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('hidden');
  if (id === 'batchDeductionModal') {
    if (typeof isBatchModalFullscreen !== 'undefined' && isBatchModalFullscreen) {
      toggleBatchModalFullscreen();
    }
    if (typeof clearBatchSearch === 'function') {
      clearBatchSearch();
    }
  }
  if (id === 'printDocumentModal') {
    if (typeof isDocModalFullscreen !== 'undefined' && isDocModalFullscreen) {
      toggleDocModalFullscreen();
    }
  }
}

// ----------------- AUTHENTICATION & INITIALIZATION -----------------

document.addEventListener('DOMContentLoaded', async () => {
  initSidebarState();

  const token = API.getToken();
  const user = API.getUser();

  if (token && user) {
    state.user = user;
    showAuthenticatedUI();
    await loadInitialData();
  } else {
    showLoginUI();
  }

  // Setup form submit listeners
  setupFormListeners();
});

window.addEventListener('auth-expired', () => {
  showLoginUI();
  showToast('লগইন মেয়াদ উত্তীর্ণ হয়েছে। পুনরায় লগইন করুন।', 'error');
});

function showLoginUI() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('authenticatedWorkspace').classList.add('hidden');
  document.getElementById('userHeaderSection').classList.add('hidden');
}

function showAuthenticatedUI() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('authenticatedWorkspace').classList.remove('hidden');
  document.getElementById('userHeaderSection').classList.remove('hidden');

  document.getElementById('userFullName').textContent = state.user.fullName || state.user.username;
  const roleLabels = {
    admin: 'প্রধান অ্যাডমিন',
    accounts: 'হিসাব শাখা',
    employee: 'কর্মচারী পোর্টাল'
  };
  document.getElementById('userRoleBadge').textContent = roleLabels[state.user.role] || state.user.role;

  // Toggle navigation tabs based on role
  if (state.user.role === 'employee') {
    document.getElementById('adminNavTabs').classList.add('hidden');
    document.getElementById('employeeNavTabs').classList.remove('hidden');
    switchTab('emp_portal');
  } else {
    document.getElementById('adminNavTabs').classList.remove('hidden');
    document.getElementById('employeeNavTabs').classList.add('hidden');
    switchTab('dashboard');
  }
}

function openChangePasswordModal() {
  document.getElementById('changePasswordForm')?.reset();
  openModal('changePasswordModal');
  document.getElementById('currentPasswordInput')?.focus();
}

async function submitChangePassword(event) {
  event.preventDefault();

  const currentPassword = document.getElementById('currentPasswordInput').value;
  const newPassword = document.getElementById('newPasswordInput').value;
  const confirmPassword = document.getElementById('confirmPasswordInput').value;
  const submitButton = document.getElementById('changePasswordSubmitBtn');

  if (newPassword !== confirmPassword) {
    showToast('নতুন পাসওয়ার্ড ও নিশ্চিতকরণ মিলছে না।', 'error');
    document.getElementById('confirmPasswordInput').focus();
    return;
  }

  submitButton.disabled = true;
  try {
    const result = await API.post('/auth/change-password', { currentPassword, newPassword });
    if (!result.success) {
      throw new Error(result.message || 'পাসওয়ার্ড পরিবর্তন করা যায়নি।');
    }
    closeModal('changePasswordModal');
    document.getElementById('changePasswordForm').reset();
    showToast(result.message || 'পাসওয়ার্ড পরিবর্তন হয়েছে।', 'success');
  } catch (error) {
    console.error('Change password error:', error);
    showToast(error.message || 'পাসওয়ার্ড পরিবর্তন করা যায়নি।', 'error');
  } finally {
    submitButton.disabled = false;
  }
}

// Quick demo login handler
async function quickLogin(username, password) {
  document.getElementById('loginUsername').value = username;
  document.getElementById('loginPassword').value = password;
  await handleLoginSubmit();
}

async function handleLoginSubmit() {
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;
  const errorBox = document.getElementById('loginError');
  errorBox.classList.add('hidden');

  try {
    const res = await API.post('/auth/login', { username, password });
    if (res.success) {
      API.setToken(res.token);
      API.setUser(res.user);
      state.user = res.user;
      showAuthenticatedUI();
      await loadInitialData();
      showToast(`স্বাগতম, ${res.user.fullName}!`, 'success');
    }
  } catch (err) {
    console.error('Login error:', err);
    errorBox.textContent = err.message || 'লগইন ব্যর্থ হয়েছে।';
    errorBox.classList.remove('hidden');
    showToast(err.message || 'লগইন ব্যর্থ হয়েছে।', 'error');
  }
}

// Sidebar Hide/Unhide Toggle Handler
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const isCollapsed = sidebar.classList.contains('sidebar-collapsed');
  if (isCollapsed) {
    sidebar.classList.remove('sidebar-collapsed');
    sidebar.classList.remove('hidden');
    localStorage.setItem('pbs_sidebar_state', 'open');
  } else {
    sidebar.classList.add('sidebar-collapsed');
    localStorage.setItem('pbs_sidebar_state', 'collapsed');
  }

  // Refresh lucide icons if needed
  if (window.lucide) lucide.createIcons();
}

// Fullscreen Window Toggle Handler
function toggleFullscreen() {
  const icon = document.getElementById('fullscreenIcon');
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().then(() => {
      if (icon) icon.setAttribute('data-lucide', 'minimize');
      if (window.lucide) lucide.createIcons();
    }).catch(err => {
      console.warn('Fullscreen error:', err);
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().then(() => {
        if (icon) icon.setAttribute('data-lucide', 'maximize');
        if (window.lucide) lucide.createIcons();
      }).catch(err => {
        console.warn('Exit fullscreen error:', err);
      });
    }
  }
}

// Restore saved sidebar state on load
function initSidebarState() {
  const savedState = localStorage.getItem('pbs_sidebar_state');
  const sidebar = document.getElementById('sidebar');
  if (sidebar && savedState === 'collapsed') {
    sidebar.classList.add('sidebar-collapsed');
  }
}

// Fullscreen change listener to sync icon
document.addEventListener('fullscreenchange', () => {
  const icon = document.getElementById('fullscreenIcon');
  if (!icon) return;
  if (document.fullscreenElement) {
    icon.setAttribute('data-lucide', 'minimize');
  } else {
    icon.setAttribute('data-lucide', 'maximize');
  }
  if (window.lucide) lucide.createIcons();
});

// Expose handlers to global window object
window.quickLogin = quickLogin;
window.handleLoginSubmit = handleLoginSubmit;
window.switchTab = switchTab;
window.openModal = openModal;
window.closeModal = closeModal;
window.toggleSidebar = toggleSidebar;
window.toggleFullscreen = toggleFullscreen;
window.viewLoanLedger = viewLoanLedger;
window.loadOwnPbsLedger = loadOwnPbsLedger;
window.loadEmployeeLoanLedger = loadEmployeeLoanLedger;
window.printEmployeeLoanLedger = printEmployeeLoanLedger;
window.openEmployeeModal = openEmployeeModal;
window.deleteEmployeeRecord = deleteEmployeeRecord;
window.populateEmployeePostingDropdown = populateEmployeePostingDropdown;
window.handleGlobalSpotlightSearch = handleGlobalSpotlightSearch;
window.openQuickEmployeeSummaryModal = openQuickEmployeeSummaryModal;
window.openSingleDeductionForLoan = openSingleDeductionForLoan;
window.handleBatchMonthChange = handleBatchMonthChange;
window.toggleBatchSelectAll = toggleBatchSelectAll;
window.updateBatchDeductionLiveSummary = updateBatchDeductionLiveSummary;
window.openBatchDeductionModal = openBatchDeductionModal;
window.toggleBatchModalFullscreen = toggleBatchModalFullscreen;
window.handleBatchSearch = handleBatchSearch;
window.clearBatchSearch = clearBatchSearch;
window.toggleBatchLoanSelection = toggleBatchLoanSelection;
window.openAllPbsAdviceModal = openAllPbsAdviceModal;
window.refreshAllPbsAdvicePending = refreshAllPbsAdvicePending;
window.submitAllPbsAdvice = submitAllPbsAdvice;
window.openRunProvisionModal = openRunProvisionModal;
window.previewProvisions = previewProvisions;
window.onProvMonthChange = onProvMonthChange;
window.executeProvisions = executeProvisions;
window.deleteProvisionRecord = deleteProvisionRecord;
window.openGenerateAdviceModal = openGenerateAdviceModal;
window.viewPrintableDocument = viewPrintableDocument;
window.printCurrentDocument = printCurrentDocument;
window.deleteAdviceRecord = deleteAdviceRecord;
window.switchDocumentView = switchDocumentView;
window.toggleDocModalFullscreen = toggleDocModalFullscreen;
window.loadDashboard = loadDashboard;
window.loadEmployees = loadEmployees;
window.loadLoans = loadLoans;
window.loadRepayments = loadRepayments;
window.deleteRepaymentRecord = deleteRepaymentRecord;
window.loadProvisions = loadProvisions;
window.loadRemittances = loadRemittances;
window.setLoanSourceFilter = setLoanSourceFilter;
window.resetRemittanceFilter = resetRemittanceFilter;
window.switchLedgerSubtab = switchLedgerSubtab;
window.loadHouseLoanLedger14320 = loadHouseLoanLedger14320;
window.setGl14320Preset = setGl14320Preset;
window.printGl14320Document = printGl14320Document;
window.exportGl14320Excel = exportGl14320Excel;
window.loadOwnPbsControlSheet = loadOwnPbsControlSheet;
window.setCsPreset = setCsPreset;
window.printControlSheetDocument = printControlSheetDocument;
window.exportControlSheetExcel = exportControlSheetExcel;
window.printCurrentLedgerTab = printCurrentLedgerTab;
window.exportCurrentLedgerTabExcel = exportCurrentLedgerTabExcel;
window.loadAuditLogs = loadAuditLogs;
window.loadRecycleBin = loadRecycleBin;
window.restoreRecord = restoreRecord;
window.openOtherPbsModal = openOtherPbsModal;
window.deleteOtherPbsRecord = deleteOtherPbsRecord;
window.deleteLoanRecord = deleteLoanRecord;
window.openNewLoanModal = openNewLoanModal;
window.openEditLoanModal = openEditLoanModal;
window.toggleLoanOriginPBS = toggleLoanOriginPBS;
window.triggerAutoProvisionSync = triggerAutoProvisionSync;
window.loadEmployeePortal = loadEmployeePortal;
window.printEmployeePortalLedger = printEmployeePortalLedger;
window.exportEmployeePortalLedgerExcel = exportEmployeePortalLedgerExcel;

// Global Spotlight Quick Search (Ctrl+K)
function handleGlobalSpotlightSearch(query) {
  const dropdown = document.getElementById('spotlightDropdown');
  if (!dropdown) return;

  const q = (query || '').trim().toLowerCase();
  if (!q) {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    return;
  }

  const matchedEmployees = (state.employees || []).filter(e => {
    return (e.emp_code && e.emp_code.toLowerCase().includes(q)) ||
           (e.name && e.name.toLowerCase().includes(q)) ||
           (e.designation && e.designation.toLowerCase().includes(q)) ||
           (e.mobile && e.mobile.includes(q)) ||
           (e.current_posting_pbs && e.current_posting_pbs.toLowerCase().includes(q));
  });

  const matchedLoans = (state.loans || []).filter(l => {
    return (l.loan_no && l.loan_no.toLowerCase().includes(q)) ||
           (l.origin_pbs_name && l.origin_pbs_name.toLowerCase().includes(q));
  });

  if (matchedEmployees.length === 0 && matchedLoans.length === 0) {
    dropdown.innerHTML = `
      <div class="p-4 text-center text-xs text-gray-500">
        <i data-lucide="search-x" class="w-6 h-6 mx-auto mb-1 text-gray-400"></i>
        <span>"${query}" এর সাথে মিলিয়ে কোনো কর্মকর্তা/কর্মচারী বা ঋণ পাওয়া যায়নি</span>
      </div>
    `;
    dropdown.classList.remove('hidden');
    if (window.lucide) lucide.createIcons();
    return;
  }

  let html = `<div class="p-2 space-y-1">`;
  if (matchedEmployees.length > 0) {
    html += `<div class="px-2 py-1 text-[11px] font-bold text-gray-400 uppercase tracking-wider">কর্মকর্তা-কর্মচারী (${toBn(matchedEmployees.length)})</div>`;
    matchedEmployees.slice(0, 5).forEach(emp => {
      html += `
        <div onclick="openQuickEmployeeSummaryModal(${emp.id})" class="p-2.5 rounded-lg hover:bg-emerald-50 cursor-pointer transition flex items-center justify-between border border-transparent hover:border-emerald-200">
          <div class="flex items-center space-x-2.5">
            <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-xs">
              ${(emp.emp_code || '').slice(-2)}
            </div>
            <div>
              <div class="font-bold text-xs text-gray-900">${emp.name} <span class="font-mono text-emerald-800 font-semibold">(${emp.emp_code})</span></div>
              <div class="text-[11px] text-gray-500">${emp.designation} &bull; ${emp.current_posting_pbs || 'নিজস্ব পবিস'}</div>
            </div>
          </div>
          <div class="text-right">
            <div class="text-xs font-bold font-mono text-gray-900">${formatBDT(emp.total_principal_balance)}</div>
            <div class="text-[10px] text-gray-400">অবশিষ্ট আসল</div>
          </div>
        </div>
      `;
    });
  }

  if (matchedLoans.length > 0) {
    html += `<div class="px-2 pt-2 py-1 text-[11px] font-bold text-gray-400 uppercase tracking-wider border-t mt-1">গৃহ ঋণ (${toBn(matchedLoans.length)})</div>`;
    matchedLoans.slice(0, 4).forEach(l => {
      html += `
        <div onclick="openQuickEmployeeSummaryModal(${l.employee_id})" class="p-2 rounded-lg hover:bg-blue-50 cursor-pointer transition flex items-center justify-between">
          <div>
            <div class="font-bold text-xs text-blue-950 font-mono">${l.loan_no} <span class="font-sans text-gray-700 font-normal">(${l.emp_name})</span></div>
            <div class="text-[11px] text-gray-500">${l.origin_pbs_name} &bull; আসল: ${formatBDT(l.disbursed_amount)}</div>
          </div>
          <div class="text-right">
            <span class="text-[11px] px-2 py-0.5 rounded-full font-bold ${l.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}">${l.status === 'ACTIVE' ? 'সক্রিয়' : 'পরিশোধিত'}</span>
          </div>
        </div>
      `;
    });
  }

  html += `</div>`;
  dropdown.innerHTML = html;
  dropdown.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

async function openQuickEmployeeSummaryModal(empId) {
  document.getElementById('spotlightDropdown')?.classList.add('hidden');

  try {
    const res = await API.get(`/employees/${empId}`);
    if (!res || !res.success) {
      showToast('কর্মচারীর তথ্য পাওয়া যায়নি।', 'error');
      return;
    }

    const { employee: emp, loans } = res;

    document.getElementById('quickEmpName').textContent = emp.name;
    document.getElementById('quickEmpSubtext').textContent = `${emp.designation} (${emp.department || 'সাধারণ'}) • পে আইডি: ${emp.emp_code} • পদায়ন: ${emp.current_posting_pbs || 'নিজস্ব পবিস'}`;

    const contentDiv = document.getElementById('quickEmpDetailsContent');
    contentDiv.innerHTML = '';

    if (!loans || loans.length === 0) {
      contentDiv.innerHTML = `
        <div class="p-6 text-center text-gray-500 bg-gray-50 rounded-xl border border-gray-200">
          <p class="font-semibold">এই কর্মচারীর কোনো গৃহ ঋণ রেকর্ড পাওয়া যায়নি।</p>
          <button onclick="closeModal('quickEmployeeSummaryModal'); openModal('newLoanModal');" class="mt-3 px-4 py-2 bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow">
            + নতুন গৃহ ঋণ বরাদ্দ করুন
          </button>
        </div>
      `;
      openModal('quickEmployeeSummaryModal');
      return;
    }

    let loansHtml = '';
    loans.forEach(loan => {
      const totalPaid = (loan.total_principal_paid || 0) + (loan.total_interest_paid || 0);
      const pct = loan.disbursed_amount > 0 ? Math.min(100, Math.round((loan.total_principal_paid / loan.disbursed_amount) * 100)) : 0;
      const isOwn = loan.loan_source_type === 'OWN_PBS';

      loansHtml += `
        <div class="p-4 rounded-xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white shadow-sm space-y-3">
          <div class="flex items-center justify-between border-b pb-2">
            <div>
              <span class="font-bold text-gray-900 font-mono text-sm">${loan.loan_no}</span>
              <span class="ml-2 text-xs font-semibold ${isOwn ? 'badge-own' : 'badge-other'} px-2 py-0.5 rounded">${loan.origin_pbs_name}</span>
            </div>
            <span class="px-2 py-0.5 rounded-full text-xs font-bold ${loan.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}">
              ${loan.status === 'ACTIVE' ? 'চলমান ঋণ' : 'সম্পূর্ণ পরিশোধিত'}
            </span>
          </div>

          <!-- Progress Bar -->
          <div>
            <div class="flex items-center justify-between text-xs text-gray-600 mb-1">
              <span>আসল পরিশোধের অগ্রগতি</span>
              <span class="font-bold text-emerald-800 font-mono">${toBn(pct)}% সম্পন্ন</span>
            </div>
            <div class="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
              <div class="bg-emerald-600 h-2.5 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
            </div>
          </div>

          <!-- 4 Stats Boxes -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
            <div class="p-2 bg-white rounded-lg border border-gray-100 shadow-xs">
              <div class="text-[10px] text-gray-400 uppercase">মঞ্জুরিকৃত আসল</div>
              <div class="font-bold text-gray-900 mt-0.5 font-mono">${formatBDT(loan.disbursed_amount)}</div>
            </div>
            <div class="p-2 bg-emerald-50 rounded-lg border border-emerald-100 text-emerald-900">
              <div class="text-[10px] text-emerald-600 uppercase">মোট পরিশোধিত</div>
              <div class="font-bold text-emerald-800 mt-0.5 font-mono">${formatBDT(totalPaid)}</div>
            </div>
            <div class="p-2 bg-blue-50 rounded-lg border border-blue-100 text-blue-900">
              <div class="text-[10px] text-blue-600 uppercase">অবশিষ্ট আসল</div>
              <div class="font-bold text-blue-900 mt-0.5 font-mono">${formatBDT(loan.principal_balance)}</div>
            </div>
            <div class="p-2 bg-amber-50 rounded-lg border border-amber-100 text-amber-900">
              <div class="text-[10px] text-amber-600 uppercase">ধার্যকৃত সুদ</div>
              <div class="font-bold text-amber-900 mt-0.5 font-mono">${formatBDT(loan.interest_balance)}</div>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="flex items-center justify-end space-x-2 pt-2 border-t text-xs">
            <button onclick="closeModal('quickEmployeeSummaryModal'); switchTab('ledgers'); loadOwnPbsLedger(${loan.id});" class="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-semibold transition flex items-center space-x-1">
              <i data-lucide="book-open" class="w-3.5 h-3.5"></i>
              <span>লেজার দেখুন</span>
            </button>
            <button onclick="closeModal('quickEmployeeSummaryModal'); openSingleDeductionForLoan(${loan.id});" class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-semibold transition flex items-center space-x-1 shadow">
              <i data-lucide="plus" class="w-3.5 h-3.5"></i>
              <span>কিস্তি কর্তন</span>
            </button>
          </div>
        </div>
      `;
    });

    contentDiv.innerHTML = loansHtml;
    openModal('quickEmployeeSummaryModal');
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Quick employee modal error:', err);
    showToast('কর্মচারীর বিবরণ লোড করা যায়নি।', 'error');
  }
}

function openSingleDeductionForLoan(loanId) {
  openModal('singleDeductionModal');
  const sel = document.getElementById('deductionLoanSelect');
  if (sel) {
    sel.value = loanId;
    updateDeductionPreview();
  }
}

// Close spotlight dropdown on outside click
document.addEventListener('click', (e) => {
  const container = document.getElementById('spotlightSearchWrapper');
  const dropdown = document.getElementById('spotlightDropdown');
  if (container && dropdown && !container.contains(e.target)) {
    dropdown.classList.add('hidden');
  }
});

// Keyboard shortcut Ctrl+K
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const input = document.getElementById('globalSpotlightInput');
    if (input) {
      input.focus();
      input.select();
    }
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  API.setToken(null);
  API.setUser(null);
  state.user = null;
  showLoginUI();
  showToast('লগআউট সম্পন্ন হয়েছে।', 'info');
});

// ----------------- TAB SWITCHING -----------------

function switchTab(tabId) {
  state.activeTab = tabId;

  // Update nav buttons
  document.querySelectorAll('.nav-tab').forEach(btn => {
    if (btn.dataset.tab === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update tab panes
  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.add('hidden');
  });

  const targetPane = document.getElementById(`tab-${tabId}`);
  if (targetPane) {
    targetPane.classList.remove('hidden');
  }

  // Load relevant data for tab
  switch (tabId) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'employees':
      loadEmployees();
      break;
    case 'loans':
      loadLoans();
      break;
    case 'deductions':
      loadRepayments();
      break;
    case 'provisions':
      loadProvisions();
      break;
    case 'remittances':
      loadRemittances();
      break;
    case 'bank_advices':
      loadGeneratedBankAdvices();
      break;
    case 'transferred_loans':
      loadTransferredLoans();
      break;
    case 'ledgers':
      switchLedgerSubtab(state.activeLedgerSubtab || 'general_ledger_14320');
      break;
    case 'comparative':
      loadComparativeStatement();
      break;
    case 'audit':
      loadAuditLogs();
      break;
    case 'recyclebin':
      loadRecycleBin();
      break;
    case 'settings':
      loadSettingsTab();
      break;
    case 'emp_loan_ledger':
      loadEmployeeLoanLedgerTab();
      break;
    case 'emp_portal':
    case 'emp_ledger':
      loadEmployeePortal();
      break;
  }

  if (window.lucide) lucide.createIcons();
}

// ----------------- DATA LOADERS -----------------

async function loadInitialData() {
  try {
    const res = await API.get('/settings');
    if (res.success) {
      state.pbsSettings = res.pbsSettings;
      state.otherPbsList = res.otherPbsList;
      if (res.pbsSettings && res.pbsSettings.pbs_name) {
        document.getElementById('headerPbsName').textContent = res.pbsSettings.pbs_name;
      }
    }
  } catch (err) {
    console.error('Failed to load initial settings:', err);
  }
}

// 1. DASHBOARD
let dashboardChartInstance = null;
async function loadDashboard() {
  try {
    const loansRes = await API.get('/loans');
    const remRes = await API.get('/remittances/pending');

    if (loansRes.success) {
      state.loans = loansRes.loans || [];
      const summary = loansRes.summary;
      document.getElementById('statTotalDisbursed').textContent = formatBDT(summary.totalDisbursed);
      document.getElementById('statPrincipalBalance').textContent = formatBDT(summary.totalPrincipalBalance);
      document.getElementById('statInterestBalance').textContent = formatBDT(summary.totalInterestBalance);
    }

    let pendingTotal = 0;
    if (remRes.success) {
      pendingTotal = remRes.pendingList.reduce((acc, curr) => acc + curr.totalAmount, 0);
      document.getElementById('statPendingRemittance').textContent = formatBDT(pendingTotal);
    }

    // Update Guided Monthly Workflow Hub
    await updateDashboardMonthlyWorkflow(loansRes, remRes, pendingTotal);

    // Load Comparative Chart
    const compRes = await API.get('/reports/comparative-statement');
    if (compRes.success && compRes.statement) {
      renderDashboardChart(compRes.statement);
    }
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

async function updateDashboardMonthlyWorkflow(loansRes, remRes, pendingTotal = 0) {
  try {
    const now = new Date();
    const currentMonth = now.toISOString().slice(0, 7);
    const [yyyy, mm] = currentMonth.split('-');
    const monthNamesBn = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
    const currentMonthText = `${monthNamesBn[parseInt(mm, 10) - 1]} ${toBn(yyyy)}`;

    const monthBadge = document.getElementById('hubMonthBadge');
    if (monthBadge) monthBadge.textContent = currentMonthText;

    const activeLoans = (loansRes?.loans || state.loans || []).filter(l => l.status === 'ACTIVE');

    // 1. Check Monthly Deductions
    const repRes = await API.get('/repayments', { month: currentMonth });
    const deductionBadge = document.getElementById('hubDeductionBadge');
    const deductionText = document.getElementById('hubDeductionText');

    if (deductionBadge && deductionText) {
      const deductedCount = repRes?.repayments?.length || 0;
      const totalDeductedAmount = repRes?.summary?.totalAmount || 0;

      if (activeLoans.length === 0) {
        deductionBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-gray-500/20 text-gray-300 border border-gray-500/30';
        deductionBadge.textContent = 'ঋণ নেই';
        deductionText.textContent = 'বর্তমানে কোনো সক্রিয় ঋণ নেই।';
      } else if (deductedCount >= activeLoans.length) {
        deductionBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
        deductionBadge.textContent = '🟢 সম্পন্ন';
        deductionText.textContent = `সকল ${toBn(activeLoans.length)} জন ঋণগ্রহীতার কিস্তি কর্তন সম্পন্ন (মোট আদায়: ${formatBDT(totalDeductedAmount)})`;
      } else if (deductedCount > 0) {
        deductionBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30';
        deductionBadge.textContent = '🟡 আংশিক সম্পন্ন';
        deductionText.textContent = `${toBn(deductedCount)} জনের কর্তন হয়েছে, এখনো ${toBn(activeLoans.length - deductedCount)} জনের বাকি`;
      } else {
        deductionBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-500/20 text-red-300 border border-red-500/30';
        deductionBadge.textContent = '🔴 কর্তন বাকি';
        deductionText.textContent = `চলতি মাসে ${toBn(activeLoans.length)} জন সক্রিয় ঋণের কিস্তি কর্তন এখনো বাকি আছে`;
      }
    }

    // 2. Check Inter-PBS Remittance
    const remittanceBadge = document.getElementById('hubRemittanceBadge');
    const remittanceText = document.getElementById('hubRemittanceText');
    if (remittanceBadge && remittanceText) {
      const pendingList = remRes?.pendingList || [];
      if (pendingList.length > 0) {
        remittanceBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30';
        remittanceBadge.textContent = `🟣 ${toBn(pendingList.length)}টি পবিস বাকি`;
        remittanceText.textContent = `মোট ${formatBDT(pendingTotal)} টাকা সংশ্লিষ্ট পবিসে প্রেরণযোগ্য অপেক্ষমাণ`;
      } else {
        remittanceBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
        remittanceBadge.textContent = '🟢 নিষ্পন্ন';
        remittanceText.textContent = 'অন্য পবিসে প্রেরণের মতো কোনো অনিষ্পন্ন কিস্তি অবশিষ্ট নেই';
      }
    }

    // 3. Check Interest Provisions
    const provisionBadge = document.getElementById('hubProvisionBadge');
    const provisionText = document.getElementById('hubProvisionText');
    if (provisionBadge && provisionText) {
      const provRes = await API.get('/provisions', { month: currentMonth });
      const provCount = provRes?.provisions?.length || 0;
      if (provCount > 0) {
        provisionBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
        provisionBadge.textContent = '🟢 সম্পন্ন';
        provisionText.textContent = `চলতি মাসে ${toBn(provCount)}টি নিজস্ব ঋণের সরল সুদ প্রভিশন গণনা সম্পন্ন হয়েছে`;
      } else {
        const ownActiveLoans = activeLoans.filter(l => l.loan_source_type === 'OWN_PBS');
        provisionBadge.className = 'text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30';
        provisionBadge.textContent = '⚪ অপেক্ষমাণ';
        provisionText.textContent = ownActiveLoans.length > 0
          ? `${toBn(ownActiveLoans.length)}টি নিজস্ব ঋণের সুদ প্রভিশন গণনা রান করুন`
          : 'কোনো নিজস্ব পবিস ঋণ নেই';
      }
    }
  } catch (err) {
    console.warn('Failed to update monthly workflow hub:', err);
  }
}

function renderDashboardChart(statement) {
  const ctx = document.getElementById('dashboardChart');
  if (!ctx) return;

  const labels = statement.ownPbsStats.map(s => s.fiscalYear).reverse();
  const disbursedData = statement.ownPbsStats.map(s => s.disbursed).reverse();
  const recoveredData = statement.ownPbsStats.map(s => s.principalRecovered).reverse();
  const interestData = statement.ownPbsStats.map(s => s.interestProvisioned).reverse();

  if (dashboardChartInstance) {
    dashboardChartInstance.destroy();
  }

  dashboardChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'নতুন ঋণ বিতরণ',
          data: disbursedData,
          backgroundColor: '#047857',
          borderRadius: 6
        },
        {
          label: 'আসল আদায়',
          data: recoveredData,
          backgroundColor: '#2563eb',
          borderRadius: 6
        },
        {
          label: 'ধার্যকৃত সুদ (প্রভিশন)',
          data: interestData,
          backgroundColor: '#d97706',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      },
      scales: {
        y: {
          ticks: {
            callback: (val) => toBn(val.toLocaleString('en-IN'))
          }
        }
      }
    }
  });
}

// 2. EMPLOYEES
async function loadEmployees() {
  try {
    const search = document.getElementById('employeeSearchInput')?.value || '';
    const dept = document.getElementById('employeeDeptFilter')?.value || '';

    const res = await API.get('/employees', { search, department: dept });
    if (!res.success) return;

    state.employees = res.employees;
    const tbody = document.getElementById('employeesTableBody');
    tbody.innerHTML = '';

    if (res.employees.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center p-6 text-gray-400">কোন কর্মকর্তা/কর্মচারী পাওয়া যায়নি।</td></tr>`;
      return;
    }

    res.employees.forEach(emp => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      tr.innerHTML = `
        <td class="p-3.5 font-bold font-mono text-emerald-800">${emp.emp_code}</td>
        <td class="p-3.5">
          <div class="font-bold text-gray-900">${emp.name}</div>
          <div class="text-xs text-gray-500">${emp.designation} (${emp.mobile || 'মোবাইল নেই'})</div>
        </td>
        <td class="p-3.5">
          <div class="text-xs font-semibold text-gray-700">${emp.department}</div>
          <div class="text-xs text-gray-400">${emp.current_posting_pbs || 'নিজস্ব পবিস'}</div>
        </td>
        <td class="p-3.5 text-center font-bold">
          <span class="px-2.5 py-1 rounded-full text-xs ${emp.active_loans_count > 0 ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-600'}">
            ${toBn(emp.active_loans_count)} টি
          </span>
        </td>
        <td class="p-3.5 text-right font-bold text-gray-900">${formatBDT(emp.total_principal_balance)}</td>
        <td class="p-3.5 text-right font-bold text-amber-700">${formatBDT(emp.total_interest_balance)}</td>
        <td class="p-3.5 text-right font-semibold text-emerald-800">${formatBDT(emp.total_monthly_installment)}</td>
        <td class="p-3.5 text-center">
          <div class="flex items-center justify-center space-x-1.5">
            <button onclick="viewEmployeeLoans(${emp.id})" class="text-xs text-emerald-700 hover:text-emerald-900 font-semibold px-2 py-1 bg-emerald-50 hover:bg-emerald-100 rounded transition" title="ঋণ দেখুন">ঋণ দেখুন</button>
            <button onclick="openEmployeeModal(${emp.id})" class="p-1 text-blue-600 hover:bg-blue-100 rounded transition" title="কর্মচারী তথ্য সম্পাদন">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button onclick="deleteEmployeeRecord(${emp.id})" class="p-1 text-red-500 hover:bg-red-100 rounded transition" title="মুছে ফেলুন">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons();

    // Also populate loan modal employee select
    populateEmployeeDropdowns();
  } catch (err) {
    console.error('Employees load error:', err);
  }
}

async function populateEmployeeDropdowns(selectedEmpId = null) {
  const select = document.getElementById('loanEmployeeSelect');
  if (!select) return;

  if (!state.employees || state.employees.length === 0) {
    try {
      const res = await API.get('/employees');
      if (res && res.employees) {
        state.employees = res.employees;
      }
    } catch (err) {
      console.error('Error fetching employees for dropdown:', err);
    }
  }

  select.innerHTML = '<option value="">কর্মকর্তা/কর্মচারী নির্বাচন করুন</option>';
  (state.employees || []).forEach(e => {
    const option = document.createElement('option');
    option.value = e.id;
    option.textContent = `${e.emp_code} - ${e.name} (${e.designation})`;
    option.dataset.empCode = e.emp_code || '';
    select.appendChild(option);
  });

  if (selectedEmpId !== null && selectedEmpId !== undefined && selectedEmpId !== '') {
    select.value = String(selectedEmpId);
    if (!select.value && state.loans) {
      const loan = state.loans.find(l => l.employee_id == selectedEmpId);
      if (loan) {
        const opt = document.createElement('option');
        opt.value = selectedEmpId;
        opt.textContent = `${loan.emp_code || ''} - ${loan.emp_name || 'কর্মকর্তা'} (${loan.designation || ''})`;
        opt.dataset.empCode = loan.emp_code || '';
        select.appendChild(opt);
        select.value = String(selectedEmpId);
      }
    }
  }
}

async function populateEmployeePostingDropdown(selectedPbsName = '') {
  const select = document.getElementById('empPostingPbs');
  if (!select) return;

  if (!state.otherPbsList || state.otherPbsList.length === 0) {
    try {
      const res = await API.get('/settings');
      if (res && res.success) {
        state.pbsSettings = res.pbsSettings;
        state.otherPbsList = res.otherPbsList || [];
      }
    } catch (e) {
      console.warn('Could not fetch settings for posting dropdown:', e);
    }
  }

  const ownPbsName = state.pbsSettings?.pbs_name || 'গাজীপুর পল্লী বিদ্যুৎ সমিতি-২';

  select.innerHTML = '';

  // 1. Group: নিজ পল্লী বিদ্যুৎ সমিতি
  const ownGroup = document.createElement('optgroup');
  ownGroup.label = 'নিজস্ব পবিস';
  const ownOpt = document.createElement('option');
  ownOpt.value = ownPbsName;
  ownOpt.textContent = `${ownPbsName} (অত্র সমিতি)`;
  ownGroup.appendChild(ownOpt);
  select.appendChild(ownGroup);

  // 2. Group: অন্যান্য ৮০টি পল্লী বিদ্যুৎ সমিতি
  const otherGroup = document.createElement('optgroup');
  otherGroup.label = 'অন্যান্য সকল পল্লী বিদ্যুৎ সমিতি (৮০টি)';

  const otherList = state.otherPbsList || [];
  otherList.forEach(p => {
    if (p.pbs_name && p.pbs_name !== ownPbsName) {
      const opt = document.createElement('option');
      opt.value = p.pbs_name;
      opt.textContent = `${p.pbs_name}${p.short_name ? ` (${p.short_name})` : ''}`;
      otherGroup.appendChild(opt);
    }
  });
  select.appendChild(otherGroup);

  if (selectedPbsName) {
    select.value = selectedPbsName;
    if (!select.value) {
      const customOpt = document.createElement('option');
      customOpt.value = selectedPbsName;
      customOpt.textContent = selectedPbsName;
      select.appendChild(customOpt);
      select.value = selectedPbsName;
    }
  } else {
    select.value = ownPbsName;
  }
}

async function openEmployeeModal(empId = null) {
  const form = document.getElementById('newEmployeeForm');
  if (form) form.reset();

  const titleEl = document.getElementById('employeeModalTitle');
  const submitBtn = document.getElementById('employeeSubmitBtn');
  const editIdInput = document.getElementById('empEditId');
  const codeInput = document.getElementById('empCodeInput');

  if (empId) {
    const emp = (state.employees || []).find(e => e.id === empId);
    if (!emp) return;

    if (titleEl) titleEl.textContent = `${emp.name} — তথ্য সম্পাদন`;
    if (submitBtn) submitBtn.textContent = 'আপডেট সংরক্ষণ করুন';
    if (editIdInput) editIdInput.value = emp.id;

    if (codeInput) {
      codeInput.value = emp.emp_code;
      codeInput.readOnly = true;
      codeInput.classList.add('bg-gray-100');
    }

    document.getElementById('empNameInput').value = emp.name || '';
    document.getElementById('empDesignationInput').value = emp.designation || '';
    document.getElementById('empDepartmentInput').value = emp.department || 'অর্থ ও হিসাব বিভাগ';
    document.getElementById('empMobileInput').value = emp.mobile || '';
    document.getElementById('empJoiningDate').value = emp.joining_date || '';

    await populateEmployeePostingDropdown(emp.current_posting_pbs || '');
  } else {
    if (titleEl) titleEl.textContent = 'নতুন কর্মকর্তা/কর্মচারী নিবন্ধন';
    if (submitBtn) submitBtn.textContent = 'নিবন্ধন করুন';
    if (editIdInput) editIdInput.value = '';

    if (codeInput) {
      codeInput.value = '';
      codeInput.readOnly = false;
      codeInput.classList.remove('bg-gray-100');
    }

    await populateEmployeePostingDropdown('');
  }

  openModal('newEmployeeModal');
  if (window.lucide) lucide.createIcons();
}

async function deleteEmployeeRecord(empId) {
  const emp = (state.employees || []).find(e => e.id === empId);
  const empName = emp ? `${emp.name} (${emp.emp_code})` : 'এই কর্মকর্তা/কর্মচারীর';

  if (!await confirmWithSweetAlert(`আপনি কি নিশ্চিত যে "${empName}" এর রেকর্ড মুছে ফেলতে চান?`)) {
    return;
  }

  try {
    const res = await API.delete(`/employees/${empId}`);
    if (res.success) {
      showToast(res.message, 'success');
      loadEmployees();
    } else {
      showToast(res.message || 'ডিলিট করা যায়নি।', 'error');
    }
  } catch (err) {
    showToast(err.message || 'সার্ভার সংযোগ ত্রুটি', 'error');
  }
}

function viewEmployeeLoans(empId) {
  switchTab('loans');
  const loanSearch = document.getElementById('loanSearchInput');
  const emp = state.employees.find(e => e.id == empId);
  if (emp && loanSearch) {
    loanSearch.value = emp.emp_code;
    loadLoans();
  }
}

// 3. LOANS
function setLoanSourceFilter(type) {
  state.activeLoanFilter = type;
  if (type === '') {
    const loanSearch = document.getElementById('loanSearchInput');
    if (loanSearch) loanSearch.value = '';
  }
  document.getElementById('loanFilterAll').className = type === '' ? 'px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 text-white shadow-sm' : 'px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200';
  document.getElementById('loanFilterOwn').className = type === 'OWN_PBS' ? 'px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 text-white shadow-sm' : 'px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200';
  document.getElementById('loanFilterOther').className = type === 'OTHER_PBS' ? 'px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 text-white shadow-sm' : 'px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200';
  loadLoans();
}

async function loadLoans() {
  try {
    const search = document.getElementById('loanSearchInput')?.value || '';
    const res = await API.get('/loans', { sourceType: state.activeLoanFilter, search });
    if (!res.success) return;

    state.loans = res.loans;
    const tbody = document.getElementById('loansTableBody');
    tbody.innerHTML = '';

    if (res.loans.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center p-6 text-gray-400">কোন ঋণ রেকর্ড পাওয়া যায়নি।</td></tr>`;
      return;
    }

    res.loans.forEach(loan => {
      const isPre2020 = loan.disbursement_date < '2020-01-01';
      const isOwn = loan.loan_source_type === 'OWN_PBS';

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      tr.innerHTML = `
        <td class="p-3.5">
          <div class="font-bold text-gray-900">${loan.loan_no}</div>
          <div class="text-xs text-gray-500">${loan.loan_lot_name}</div>
        </td>
        <td class="p-3.5">
          <div class="font-bold text-gray-800">${loan.emp_name}</div>
          <div class="text-xs text-gray-500">${loan.emp_code} &bull; ${loan.designation}</div>
        </td>
        <td class="p-3.5">
          <span class="inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${isOwn ? 'badge-own' : 'badge-other'}">
            ${loan.origin_pbs_name}
          </span>
          ${isOwn && loan.disbursement_date ? `<div class="text-xs text-gray-500 mt-0.5">বিতরণ: ${toBn(loan.disbursement_date)}</div>` : ''}
        </td>
        <td class="p-3.5 text-center">
          ${isOwn ? `
            <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
              ${toBn(loan.interest_rate || 7)}%
            </span>
            <div class="text-[10px] text-gray-400">ব্যালেন্স সুদ (পূর্বে ৮%)</div>
          ` : `
            <span class="px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-600 font-medium">প্রভিশন মুক্ত</span>
          `}
        </td>
        <td class="p-3.5 text-right font-bold text-gray-900">${formatBDT(loan.disbursed_amount)}</td>
        <td class="p-3.5 text-right font-bold text-blue-800">${formatBDT(loan.principal_balance)}</td>
        <td class="p-3.5 text-right font-bold text-amber-700">
          ${formatBDT(loan.interest_balance)}
          ${loan.advance_balance > 0 ? `<div class="text-[10px] font-semibold text-blue-700 mt-0.5">অগ্রিম: ${formatBDT(loan.advance_balance)}</div>` : ''}
        </td>
        <td class="p-3.5 text-center">
          <span class="px-2 py-0.5 rounded-full text-xs font-medium ${loan.status === 'ACTIVE' ? 'badge-active' : 'badge-closed'}">
            ${loan.status === 'ACTIVE' ? 'সক্রিয়' : 'পরিশোধিত'}
          </span>
          ${loan.salary_deduction_suspended ? '<div class="mt-1 text-[10px] font-bold text-rose-700">বেতন কর্তন স্থগিত</div>' : ''}
        </td>
        <td class="p-3.5 text-center">
          <div class="flex items-center justify-center space-x-1.5">
            ${loan.status === 'ACTIVE' ? `
              <button onclick="toggleLoanSalaryDeduction(${loan.id}, ${!loan.salary_deduction_suspended})" class="px-2 py-1 ${loan.salary_deduction_suspended ? 'bg-blue-700 hover:bg-blue-800' : 'bg-rose-700 hover:bg-rose-800'} text-white rounded text-[10px] font-bold whitespace-nowrap" title="${loan.salary_deduction_suspended ? 'বেতন কর্তন পুনরায় চালু করুন' : 'বেতন কর্তন স্থগিত করুন'}">
                ${loan.salary_deduction_suspended ? 'কর্তন চালু' : 'কর্তন স্থগিত'}
              </button>
            ` : ''}
            <button onclick="openEditLoanModal(${loan.id})" class="p-1 text-blue-600 hover:bg-blue-100 rounded transition" title="ঋণ তথ্য সম্পাদন (Edit)">
              <i data-lucide="edit-3" class="w-4 h-4"></i>
            </button>
            <button onclick="viewLoanLedger(${loan.id})" class="p-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded text-xs font-semibold">লেজার</button>
            <button onclick="deleteLoanRecord(${loan.id})" class="p-1 text-red-500 hover:bg-red-100 rounded transition text-xs" title="ডিলিট (রিসাইকেল বিনে পাঠান)">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons();
    populateRepaymentLoanDropdowns();
    populateEmployeeDropdowns();
  } catch (err) {
    console.error('Loans load error:', err);
  }
}

async function openNewLoanModal() {
  const form = document.getElementById('newLoanForm');
  if (form) form.reset();

  const editIdInput = document.getElementById('loanEditId');
  if (editIdInput) editIdInput.value = '';
  const loanNoInput = document.getElementById('loanNoInput');
  if (loanNoInput) {
    loanNoInput.readOnly = true;
    loanNoInput.classList.add('bg-gray-50');
  }

  const titleEl = document.getElementById('loanModalTitle');
  if (titleEl) {
    titleEl.innerHTML = `
      <i data-lucide="plus-circle" class="w-5 h-5 text-emerald-700"></i>
      <span>নতুন গৃহ নির্মাণ ঋণ অন্তর্ভুক্তি</span>
    `;
  }

  const submitBtn = document.getElementById('loanSubmitBtn');
  if (submitBtn) {
    submitBtn.innerHTML = `
      <i data-lucide="save" class="w-4 h-4"></i>
      <span>ঋণ সংরক্ষণ করুন</span>
    `;
  }

  await populateEmployeeDropdowns();

  const lotInput = document.getElementById('loanLotInput');
  if (lotInput) {
    lotInput.querySelectorAll('option[data-legacy-lot]').forEach(option => option.remove());
    lotInput.value = '১ম ঋণ';
  }
  updateLoanNumberFromEmployeeAndLot();

  const sourceType = document.getElementById('loanSourceTypeSelect');
  if (sourceType) sourceType.value = 'OWN_PBS';
  await toggleLoanOriginPBS();

  openModal('newLoanModal');
  if (window.lucide) lucide.createIcons();
}

function updateLoanNumberFromEmployeeAndLot() {
  const editId = document.getElementById('loanEditId')?.value;
  const loanNoInput = document.getElementById('loanNoInput');
  const employeeSelect = document.getElementById('loanEmployeeSelect');
  const lotSelect = document.getElementById('loanLotInput');
  if (editId || !loanNoInput || !employeeSelect || !lotSelect) return;

  const employeeCode = employeeSelect.selectedOptions[0]?.dataset.empCode?.trim();
  const lotName = lotSelect.value?.trim();
  loanNoInput.value = employeeCode && lotName
    ? `HBL-${employeeCode}-${lotName}`
    : '';
}

async function openEditLoanModal(loanId) {
  let loan = (state.loans || []).find(l => l.id == loanId);
  if (!loan) {
    try {
      const res = await API.get('/loans');
      if (res && res.loans) {
        state.loans = res.loans;
        loan = state.loans.find(l => l.id == loanId);
      }
    } catch (e) {
      console.error('Error fetching loan for edit:', e);
    }
  }

  if (!loan) {
    showToast('ঋণের তথ্য পাওয়া যায়নি।', 'error');
    return;
  }

  const form = document.getElementById('newLoanForm');
  if (form) form.reset();

  const editIdInput = document.getElementById('loanEditId');
  if (editIdInput) editIdInput.value = loan.id;
  const loanNoInput = document.getElementById('loanNoInput');
  if (loanNoInput) {
    loanNoInput.readOnly = false;
    loanNoInput.classList.remove('bg-gray-50');
  }

  const titleEl = document.getElementById('loanModalTitle');
  if (titleEl) {
    titleEl.innerHTML = `
      <i data-lucide="edit-3" class="w-5 h-5 text-blue-600"></i>
      <span>গৃহ নির্মাণ ঋণ সম্পাদন ও সংশোধন (Edit Loan)</span>
    `;
  }

  const submitBtn = document.getElementById('loanSubmitBtn');
  if (submitBtn) {
    submitBtn.innerHTML = `
      <i data-lucide="save" class="w-4 h-4"></i>
      <span>পরিবর্তন সংরক্ষণ করুন</span>
    `;
  }

  // Pre-load employees and select the loan's employee
  await populateEmployeeDropdowns(loan.employee_id);

  const empSelect = document.getElementById('loanEmployeeSelect');
  if (empSelect) empSelect.value = String(loan.employee_id);

  if (loanNoInput) loanNoInput.value = loan.loan_no || '';

  const loanLotInput = document.getElementById('loanLotInput');
  if (loanLotInput) {
    loanLotInput.querySelectorAll('option[data-legacy-lot]').forEach(option => option.remove());
    const lotName = loan.loan_lot_name || '১ম ঋণ';
    if (!Array.from(loanLotInput.options).some(option => option.value === lotName)) {
      const legacyOption = new Option(lotName, lotName);
      legacyOption.dataset.legacyLot = 'true';
      loanLotInput.add(legacyOption);
    }
    loanLotInput.value = lotName;
  }

  const sourceTypeSelect = document.getElementById('loanSourceTypeSelect');
  if (sourceTypeSelect) sourceTypeSelect.value = loan.loan_source_type || 'OWN_PBS';

  await toggleLoanOriginPBS();

  if (loan.origin_pbs_id) {
    const originSelect = document.getElementById('loanOriginPbsSelect');
    if (originSelect) originSelect.value = loan.origin_pbs_id;
  }

  const sanctionNo = document.getElementById('loanSanctionNo');
  if (sanctionNo) sanctionNo.value = loan.sanction_no || '';

  const sanctionDate = document.getElementById('loanSanctionDate');
  if (sanctionDate) sanctionDate.value = loan.sanction_date || '';

  const disbDate = document.getElementById('loanDisbursementDate');
  if (disbDate) disbDate.value = loan.disbursement_date || '';

  const disbAmount = document.getElementById('loanDisbursedAmount');
  if (disbAmount) disbAmount.value = loan.disbursed_amount ?? loan.sanction_amount ?? '';

  const installment = document.getElementById('loanMonthlyInstallment');
  if (installment) installment.value = loan.monthly_installment || '';

  autoUpdateInterestRule();

  const rate = document.getElementById('loanInterestRate');
  if (rate && loan.custom_interest_rate != null) {
    rate.value = loan.custom_interest_rate;
  } else if (rate && loan.interest_rate != null) {
    rate.value = loan.interest_rate;
  }

  const remarks = document.getElementById('loanRemarks');
  if (remarks) remarks.value = loan.remarks || '';

  openModal('newLoanModal');
  if (window.lucide) lucide.createIcons();
}

function viewLoanLedger(loanId) {
  switchTab('ledgers');
  const ownBtn = document.getElementById('subtabBtnOwn');
  if (ownBtn) switchLedgerSubtab('own');
  
  // Find employee associated with this loan
  const loan = (state.loans || []).find(l => l.id == loanId);
  const empId = loan ? loan.employee_id : loanId;
  loadOwnPbsLedger(empId);
}

async function deleteLoanRecord(loanId) {
  if (!await confirmWithSweetAlert('আপনি কি এই ঋণ রেকর্ডটি রিসাইকেল বিনে পাঠাতে চান? পরবর্তীতে তা রিকভার করা যাবে।')) return;
  try {
    const res = await API.delete(`/loans/${loanId}`);
    if (res.success) {
      showToast(res.message, 'success');
      loadLoans();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 4. SALARY DEDUCTIONS (REPAYMENTS)
let selectedRepaymentIds = new Set();
let currentLoadedRepaymentIds = [];
let loadedRepaymentRecords = [];

function updateRepaymentSelectionUI() {
  const selectAllCb = document.getElementById('selectAllRepaymentsCb');
  const batchDeleteBtn = document.getElementById('batchDeleteRepaymentsBtn');
  const batchDeleteText = document.getElementById('batchDeleteRepaymentsBtnText');

  if (selectAllCb) {
    if (currentLoadedRepaymentIds.length > 0 && currentLoadedRepaymentIds.every(id => selectedRepaymentIds.has(id))) {
      selectAllCb.checked = true;
      selectAllCb.indeterminate = false;
    } else if (currentLoadedRepaymentIds.some(id => selectedRepaymentIds.has(id))) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = true;
    } else {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
    }
  }

  if (batchDeleteBtn) {
    if (selectedRepaymentIds.size > 0) {
      batchDeleteBtn.classList.remove('hidden');
      if (batchDeleteText) {
        batchDeleteText.textContent = `নির্বাচিত কিস্তি মুছুন (${toBn(selectedRepaymentIds.size)}টি)`;
      }
    } else {
      batchDeleteBtn.classList.add('hidden');
    }
  }

  // Update row checkbox checked state and highlight
  currentLoadedRepaymentIds.forEach(id => {
    const cb = document.querySelector(`.repayment-row-cb[data-id="${id}"]`);
    const tr = document.getElementById(`repayment-row-${id}`);
    if (cb) cb.checked = selectedRepaymentIds.has(id);
    if (tr) {
      if (selectedRepaymentIds.has(id)) {
        tr.classList.add('bg-rose-50/70');
      } else {
        tr.classList.remove('bg-rose-50/70');
      }
    }
  });
}

function toggleRepaymentSelection(id, isChecked) {
  if (isChecked) {
    selectedRepaymentIds.add(id);
  } else {
    selectedRepaymentIds.delete(id);
  }
  updateRepaymentSelectionUI();
}

function toggleAllRepaymentsSelection(isChecked) {
  if (isChecked) {
    currentLoadedRepaymentIds.forEach(id => selectedRepaymentIds.add(id));
  } else {
    currentLoadedRepaymentIds.forEach(id => selectedRepaymentIds.delete(id));
  }
  updateRepaymentSelectionUI();
}

async function deleteSelectedRepayments() {
  const count = selectedRepaymentIds.size;
  if (count === 0) {
    Swal.fire({
      icon: 'info',
      title: 'কিছু নির্বাচন করুন',
      text: 'মুছে ফেলার জন্য অন্তত একটি কিস্তি নির্বাচন করুন।',
      confirmButtonText: 'ঠিক আছে',
      confirmButtonColor: '#059669'
    });
    return;
  }

  const result = await Swal.fire({
    icon: 'warning',
    title: 'নির্বাচিত ' + toBn(count) + ' টি কিস্তি মুছে ফেলবেন?',
    html: '<div style="text-align:left; font-size:0.92rem; line-height:1.7; color:#374151;">' +
      '<p>নিচের সকল নির্বাচিত কিস্তি কর্তন <strong>রিসাইকেল বিনে</strong> চলে যাবে।</p>' +
      '<p style="margin-top:8px;">✅ সংশ্লিষ্ট সকল ঋণের <strong>আসল ও সুদের ব্যালেন্স</strong> স্বয়ংক্রিয়ভাবে পূর্বের অবস্থায় ফিরে যাবে।</p>' +
      '<p style="margin-top:8px; color:#e11d48; font-weight:600;">⚠️ মুছে ফেলার আগে ভালোভাবে নিশ্চিত হোন।</p>' +
      '</div>',
    showCancelButton: true,
    confirmButtonText: '🗑️ হ্যাঁ, ' + toBn(count) + ' টি কিস্তি মুছুন',
    cancelButtonText: '❌ না, বাতিল করুন',
    confirmButtonColor: '#e11d48',
    cancelButtonColor: '#6b7280',
    reverseButtons: true,
    focusCancel: true
  });

  if (!result.isConfirmed) return;

  Swal.fire({
    title: 'প্রক্রিয়াকরণ চলছে...',
    html: '<b>' + toBn(count) + ' টি</b> কিস্তি মুছে ফেলা হচ্ছে এবং ঋণের ব্যালেন্স পুনঃস্থাপন করা হচ্ছে...',
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const ids = Array.from(selectedRepaymentIds);
    const res = await API.post('/repayments/batch-delete', { ids });
    if (res.success) {
      selectedRepaymentIds.clear();
      await loadRepayments();
      loadLoans();
      if (typeof loadDashboard === 'function') loadDashboard();

      Swal.fire({
        icon: 'success',
        title: 'সফলভাবে সম্পন্ন!',
        html: '<div style="text-align:left; font-size:0.92rem; line-height:1.8; color:#374151;">' +
          '<p>✅ <strong>' + toBn(res.deletedCount || count) + ' টি কিস্তি</strong> সফলভাবে রিসাইকেল বিনে পাঠানো হয়েছে।</p>' +
          '<p>🔄 সকল সংশ্লিষ্ট ঋণের ব্যালেন্স <strong>পূর্বাবস্থায় পুনঃস্থাপিত</strong> হয়েছে।</p>' +
          '</div>',
        confirmButtonText: 'ঠিক আছে',
        confirmButtonColor: '#059669',
        timer: 4000,
        timerProgressBar: true
      });
    } else {
      Swal.fire({
        icon: 'error',
        title: 'ব্যর্থ হয়েছে!',
        text: res.message || 'ব্যাচ কিস্তি ডিলিট ব্যর্থ হয়েছে।',
        confirmButtonText: 'ঠিক আছে',
        confirmButtonColor: '#e11d48'
      });
    }
  } catch (err) {
    Swal.fire({
      icon: 'error',
      title: 'সার্ভার ত্রুটি!',
      text: err.message || 'সার্ভার সংযোগে সমস্যা হয়েছে।',
      confirmButtonText: 'ঠিক আছে',
      confirmButtonColor: '#e11d48'
    });
  }
}

async function loadRepayments() {
  try {
    const month = document.getElementById('deductionMonthFilter')?.value || '';
    const res = await API.get('/repayments', { month });
    if (!res.success) return;

    if (res.summary) {
      document.getElementById('deductionsTotalSummary').textContent =
        `সর্বমোট কিস্তি আদায়: ${formatBDT(res.summary.totalAmount)} (আসল: ${formatBDT(res.summary.totalPrincipal)}, সুদ: ${formatBDT(res.summary.totalInterest)})`;
    }

    loadedRepaymentRecords = res.repayments || [];
    filterRepayments();
  } catch (err) {
    console.error('Repayments load error:', err);
  }
}

function filterRepayments() {
  const query = (document.getElementById('repaymentSearchInput')?.value || '').trim().toLocaleLowerCase();
  const filteredRepayments = loadedRepaymentRecords.filter(rep => {
    const searchable = [
      rep.deduction_month,
      rep.deduction_date,
      rep.emp_name,
      rep.emp_code,
      rep.designation,
      rep.loan_no,
      rep.origin_pbs_name,
      rep.voucher_no
    ].join(' ').toLocaleLowerCase();
    return searchable.includes(query);
  });

  currentLoadedRepaymentIds = filteredRepayments.map(rep => rep.id);
  selectedRepaymentIds = new Set(
    Array.from(selectedRepaymentIds).filter(id => currentLoadedRepaymentIds.includes(id))
  );

  const count = document.getElementById('repaymentSearchCount');
  if (count) count.textContent = query
    ? `${toBn(filteredRepayments.length)} / ${toBn(loadedRepaymentRecords.length)} টি কিস্তি`
    : `${toBn(loadedRepaymentRecords.length)} টি কিস্তি`;

  renderRepaymentRows(filteredRepayments);
}

function renderRepaymentRows(repayments) {
  const tbody = document.getElementById('repaymentsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (repayments.length === 0) {
    const hasSearch = Boolean((document.getElementById('repaymentSearchInput')?.value || '').trim());
    tbody.innerHTML = `<tr><td colspan="9" class="text-center p-6 text-gray-400">${hasSearch ? 'অনুসন্ধানের সাথে মেলে এমন কোনো কিস্তি পাওয়া যায়নি।' : 'কোন কিস্তি কর্তন পাওয়া যায়নি।'}</td></tr>`;
    updateRepaymentSelectionUI();
    return;
  }

  repayments.forEach(rep => {
    const isOther = rep.loan_source_type === 'OTHER_PBS';
    const isSelected = selectedRepaymentIds.has(rep.id);

    const tr = document.createElement('tr');
    tr.id = `repayment-row-${rep.id}`;
    tr.className = `hover:bg-gray-50 transition ${isSelected ? 'bg-rose-50/70' : ''}`;
    tr.innerHTML = `
        <td class="p-3.5 text-center">
          <input type="checkbox" data-id="${rep.id}" class="repayment-row-cb rounded text-rose-600 focus:ring-rose-500 cursor-pointer w-4 h-4" ${isSelected ? 'checked' : ''} onchange="toggleRepaymentSelection(${rep.id}, this.checked)">
        </td>
        <td class="p-3.5">
          <div class="font-bold text-gray-900">${toBn(rep.deduction_month)}</div>
          <div class="text-xs text-gray-500">${toBn(rep.deduction_date)}</div>
        </td>
        <td class="p-3.5">
          <div class="font-bold text-gray-800">${rep.emp_name}</div>
          <div class="text-xs text-gray-500">${rep.emp_code} &bull; ${rep.designation}</div>
        </td>
        <td class="p-3.5">
          <div class="font-medium text-xs text-gray-800">${rep.loan_no}</div>
          <span class="inline-block px-1.5 py-0.5 rounded text-[10px] ${isOther ? 'badge-other' : 'badge-own'}">
            ${rep.origin_pbs_name}
          </span>
        </td>
        <td class="p-3.5 text-right font-bold text-gray-900">${formatBDT(rep.total_amount)}</td>
        <td class="p-3.5 text-right font-bold text-emerald-700">${formatBDT(rep.principal_paid)}</td>
        <td class="p-3.5 text-right font-bold text-amber-700">${formatBDT(rep.interest_paid)}</td>
        <td class="p-3.5 text-center">
          ${isOther ? `
            <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold ${rep.remittance_status === 'REMITTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-purple-100 text-purple-800'}">
              ${rep.remittance_status === 'REMITTED' ? 'প্রেরিত (Remitted)' : 'অনিষ্পন্ন (Pending)'}
            </span>
          ` : `
            <span class="text-xs text-gray-400">নিজস্ব পবিস জমা</span>
          `}
        </td>
        <td class="p-3.5 text-center">
          <button onclick="deleteRepaymentRecord(${rep.id})" class="text-red-500 hover:text-red-700 p-1" title="ডিলিট ও ব্যালেন্স রিভার্স">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </td>
    `;
    tbody.appendChild(tr);
  });

  updateRepaymentSelectionUI();
  if (window.lucide) lucide.createIcons();
}

function populateRepaymentLoanDropdowns() {
  const select = document.getElementById('deductionLoanSelect');
  if (!select) return;
  select.innerHTML = '<option value="">ঋণ হিসাব নম্বর নির্বাচন করুন</option>';
  state.loans.filter(l => l.status === 'ACTIVE').forEach(l => {
    select.innerHTML += `<option value="${l.id}">${l.loan_no} - ${l.emp_name} (আসল স্থিতি: ${formatBDT(l.principal_balance)}, সুদ: ${formatBDT(l.interest_balance)})</option>`;
  });
}

function updateDeductionPreview() {
  const loanId = document.getElementById('deductionLoanSelect')?.value;
  const amount = parseFloat(document.getElementById('deductionAmountInput')?.value || 0);
  const previewDiv = document.getElementById('deductionPreviewText');

  if (!loanId || amount <= 0) {
    previewDiv.textContent = 'টাকার পরিমাণ প্রদান করুন...';
    return;
  }

  const loan = state.loans.find(l => l.id == loanId);
  if (!loan) return;

  let prinPaid = 0;
  let intPaid = 0;
  let rem = amount;

  if (loan.principal_balance > 0) {
    if (rem <= loan.principal_balance) {
      prinPaid = rem;
      rem = 0;
    } else {
      prinPaid = loan.principal_balance;
      rem -= loan.principal_balance;
    }
  }

  if (rem > 0) {
    intPaid = Math.min(rem, loan.interest_balance);
  }

  const newPrin = Math.max(0, loan.principal_balance - prinPaid);
  const newInt = Math.max(0, loan.interest_balance - intPaid);

  previewDiv.innerHTML = `
    <div>&bull; আসল থেকে কর্তন: <strong>${formatBDT(prinPaid)}</strong> (নতুন আসল স্থিতি: ${formatBDT(newPrin)})</div>
    <div>&bull; সুদ থেকে কর্তন: <strong>${formatBDT(intPaid)}</strong> (নতুন সুদ স্থিতি: ${formatBDT(newInt)})</div>
    <div class="text-[11px] text-emerald-700 mt-1 font-semibold">※ সরকারি নিয়ম মোতাবেক আসল সম্পূর্ণ শূন্য না হওয়া পর্যন্ত সুদ কর্তন শুরু হবে না।</div>
  `;
}

let currentBatchEligibleLoans = [];
let batchSelectedLoanIds = new Set();
let batchSearchQuery = '';
let isBatchModalFullscreen = false;

function toggleBatchModalFullscreen() {
  const dialog = document.getElementById('batchDeductionDialog');
  const scrollContainer = document.getElementById('batchTableScrollContainer');
  const icon = document.getElementById('batchModalFullscreenIcon');
  const btn = document.getElementById('batchModalFullscreenBtn');
  const form = document.getElementById('batchDeductionForm');
  const previewSection = document.getElementById('batchPreviewSection');
  
  if (!dialog || !scrollContainer) return;
  isBatchModalFullscreen = !isBatchModalFullscreen;

  if (isBatchModalFullscreen) {
    dialog.classList.remove('max-w-2xl', 'my-auto', 'rounded-2xl');
    dialog.classList.add('fixed', 'inset-2', 'md:inset-4', 'max-w-none', 'w-auto', 'h-[calc(100vh-1rem)]', 'md:h-[calc(100vh-2rem)]', 'm-0', 'rounded-2xl', 'flex', 'flex-col', 'overflow-hidden');
    
    if (form) form.classList.add('flex-1', 'overflow-hidden');
    if (previewSection) previewSection.classList.add('flex-1', 'overflow-hidden');
    scrollContainer.classList.remove('max-h-60');
    scrollContainer.classList.add('flex-1', 'max-h-none');
    
    if (icon) icon.setAttribute('data-lucide', 'minimize-2');
    if (btn) btn.title = 'স্বাভাবিক আকার (Exit Fullscreen)';
  } else {
    dialog.classList.add('max-w-2xl', 'my-auto', 'rounded-2xl');
    dialog.classList.remove('fixed', 'inset-2', 'md:inset-4', 'max-w-none', 'w-auto', 'h-[calc(100vh-1rem)]', 'md:h-[calc(100vh-2rem)]', 'm-0', 'flex', 'flex-col', 'overflow-hidden');
    
    if (form) form.classList.remove('flex-1', 'overflow-hidden');
    if (previewSection) previewSection.classList.remove('flex-1', 'overflow-hidden');
    scrollContainer.classList.add('max-h-60');
    scrollContainer.classList.remove('flex-1', 'max-h-none');
    
    if (icon) icon.setAttribute('data-lucide', 'maximize-2');
    if (btn) btn.title = 'ফুলস্ক্রিন মুড (Fullscreen)';
  }

  if (window.lucide) lucide.createIcons();
}

function handleBatchSearch(val) {
  batchSearchQuery = (val || '').trim();
  const clearBtn = document.getElementById('batchClearSearchBtn');
  if (clearBtn) {
    if (batchSearchQuery.length > 0) {
      clearBtn.classList.remove('hidden');
    } else {
      clearBtn.classList.add('hidden');
    }
  }
  renderBatchDeductionRows();
}

function clearBatchSearch() {
  batchSearchQuery = '';
  const searchInput = document.getElementById('batchSearchInput');
  if (searchInput) searchInput.value = '';
  const clearBtn = document.getElementById('batchClearSearchBtn');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderBatchDeductionRows();
}

function openBatchDeductionModal() {
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const monthInput = document.getElementById('batchMonthInput');
  if (monthInput) monthInput.value = currentMonth;
  clearBatchSearch();
  openModal('batchDeductionModal');
  handleBatchMonthChange();
}

async function handleBatchMonthChange() {
  const month = document.getElementById('batchMonthInput')?.value;
  if (!month) return;

  // Automatically set deduction date to the last day of the selected month, and update voucher reference
  if (month.includes('-')) {
    const [year, m] = month.split('-').map(Number);
    const lastDay = new Date(year, m, 0).getDate();
    const formattedLastDate = `${year}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const dateInput = document.getElementById('batchDateInput');
    const voucherInput = document.getElementById('batchVoucherInput');
    if (dateInput) dateInput.value = formattedLastDate;
    if (voucherInput) voucherInput.value = `SALARY-${month}`;
  }

  const tbody = document.getElementById('batchDeductionPreviewTbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="p-6 text-center text-gray-400">তথ্য যাচাই করা হচ্ছে...</td></tr>';

  try {
    // 1. Fetch repayments already done for this month
    const repRes = await API.get('/repayments', { month });
    const existingDeductedLoanIds = new Set((repRes.repayments || []).map(r => r.loan_id));

    // 2. Active loans not yet deducted for this month
    const activeLoans = (state.loans || []).filter(l => l.status === 'ACTIVE');
    currentBatchEligibleLoans = activeLoans.filter(l =>
      !l.salary_deduction_suspended && !existingDeductedLoanIds.has(l.id)
    );

    // Select all eligible loans by default
    batchSelectedLoanIds = new Set(currentBatchEligibleLoans.map(l => l.id));

    renderBatchDeductionRows();
  } catch (err) {
    console.error('Batch preview error:', err);
    tbody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-red-500">প্রিভিউ লোড করতে ব্যর্থ হয়েছে।</td></tr>';
  }
}

function renderBatchDeductionRows() {
  const tbody = document.getElementById('batchDeductionPreviewTbody');
  const countBadge = document.getElementById('batchListCountBadge');
  const filteredNote = document.getElementById('batchSearchFilteredNote');
  const submitBtn = document.getElementById('batchSubmitBtn');
  const selectAllCb = document.getElementById('batchSelectAllCheckbox');
  if (!tbody) return;

  tbody.innerHTML = '';

  if (currentBatchEligibleLoans.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="p-6 text-center text-emerald-800 bg-emerald-50">
          <i data-lucide="check-circle" class="w-8 h-8 mx-auto mb-2 text-emerald-600"></i>
          <span class="font-bold text-sm">এই মাসে কর্তনযোগ্য কোনো সক্রিয় ঋণ নেই!</span>
          <p class="text-xs text-emerald-600 mt-1">কিস্তি কর্তন ইতিমধ্যে সম্পন্ন, অথবা বেতন কর্তন স্থগিত রয়েছে।</p>
        </td>
      </tr>
    `;
    if (countBadge) countBadge.textContent = '০ টি';
    if (filteredNote) filteredNote.classList.add('hidden');
    if (submitBtn) submitBtn.disabled = true;
    if (selectAllCb) selectAllCb.checked = false;
    updateBatchDeductionLiveSummary();
    if (window.lucide) lucide.createIcons();
    return;
  }

  const query = (batchSearchQuery || '').toLowerCase();
  const visibleLoans = currentBatchEligibleLoans.filter(loan => {
    if (!query) return true;
    const text = `${loan.emp_name || ''} ${loan.emp_code || ''} ${loan.designation || ''} ${loan.loan_no || ''} ${loan.origin_pbs_name || ''}`.toLowerCase();
    return text.includes(query);
  });

  if (countBadge) countBadge.textContent = `${toBn(visibleLoans.length)} টি`;

  if (query) {
    if (filteredNote) {
      filteredNote.classList.remove('hidden');
      filteredNote.textContent = `(মোট ${toBn(currentBatchEligibleLoans.length)} টির মধ্যে ${toBn(visibleLoans.length)} টি ফিল্টারকৃত)`;
    }
  } else {
    if (filteredNote) filteredNote.classList.add('hidden');
  }

  if (visibleLoans.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="p-6 text-center text-gray-500 bg-gray-50">
          <i data-lucide="search-x" class="w-7 h-7 mx-auto mb-1.5 text-gray-400"></i>
          <p class="font-medium text-xs">"${batchSearchQuery}" দিয়ে কোনো কর্মী বা ঋণ খুঁজে পাওয়া যায়নি।</p>
          <button type="button" onclick="clearBatchSearch()" class="mt-2 text-xs text-blue-600 hover:underline font-semibold">সার্চ মুছুন</button>
        </td>
      </tr>
    `;
    if (selectAllCb) selectAllCb.checked = false;
    updateBatchDeductionLiveSummary();
    if (window.lucide) lucide.createIcons();
    return;
  }

  visibleLoans.forEach((loan) => {
    const isOther = loan.loan_source_type === 'OTHER_PBS';
    const isChecked = batchSelectedLoanIds.has(loan.id);

    // Calculate Principal & Interest portion for this loan deduction
    const inst = loan.monthly_installment || 0;
    const prinBal = loan.principal_balance || 0;
    const intBal = loan.interest_balance || 0;
    let prinPart = 0;
    let intPart = 0;
    if (prinBal > 0) {
      if (inst <= prinBal) {
        prinPart = inst;
      } else {
        prinPart = prinBal;
        intPart = Math.min(inst - prinBal, intBal);
      }
    } else {
      intPart = Math.min(inst, intBal);
    }

    const tr = document.createElement('tr');
    tr.className = `hover:bg-blue-50/60 transition ${isChecked ? 'bg-white' : 'bg-gray-50/50 opacity-60'}`;
    tr.innerHTML = `
      <td class="p-2.5 text-center">
        <input type="checkbox" name="batchLoanCheckbox" value="${loan.id}" ${isChecked ? 'checked' : ''} onchange="toggleBatchLoanSelection(${loan.id}, this.checked)" class="rounded text-blue-600 focus:ring-blue-500 cursor-pointer w-4 h-4">
      </td>
      <td class="p-2.5">
        <div class="font-bold text-gray-900">${loan.emp_name}</div>
        <div class="text-[11px] text-gray-500 font-mono">${loan.emp_code} &bull; ${loan.designation}</div>
      </td>
      <td class="p-2.5">
        <div class="font-mono text-gray-800 font-semibold">${loan.loan_no}</div>
        <span class="text-[10px] px-1.5 py-0.2 rounded font-medium ${isOther ? 'badge-other' : 'badge-own'}">${loan.origin_pbs_name}</span>
      </td>
      <td class="p-2.5 text-right font-mono font-bold text-gray-800">${formatBDT(loan.principal_balance)}</td>
      <td class="p-2.5 text-right font-mono font-bold text-blue-900">${formatBDT(loan.monthly_installment)}</td>
      <td class="p-2.5 text-right font-mono font-bold text-emerald-700 bg-emerald-50/50">${formatBDT(prinPart)}</td>
      <td class="p-2.5 text-right font-mono font-bold text-amber-700 bg-amber-50/50">${formatBDT(intPart)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Update select all checkbox state based on visible loans
  if (selectAllCb) {
    const allVisibleChecked = visibleLoans.length > 0 && visibleLoans.every(l => batchSelectedLoanIds.has(l.id));
    selectAllCb.checked = allVisibleChecked;
  }

  updateBatchDeductionLiveSummary();
  if (window.lucide) lucide.createIcons();
}

function toggleBatchLoanSelection(loanId, isChecked) {
  if (isChecked) {
    batchSelectedLoanIds.add(loanId);
  } else {
    batchSelectedLoanIds.delete(loanId);
  }

  // Update Select All Checkbox state
  const query = (batchSearchQuery || '').toLowerCase();
  const visibleLoans = currentBatchEligibleLoans.filter(loan => {
    if (!query) return true;
    const text = `${loan.emp_name || ''} ${loan.emp_code || ''} ${loan.designation || ''} ${loan.loan_no || ''} ${loan.origin_pbs_name || ''}`.toLowerCase();
    return text.includes(query);
  });
  const selectAllCb = document.getElementById('batchSelectAllCheckbox');
  if (selectAllCb) {
    selectAllCb.checked = visibleLoans.length > 0 && visibleLoans.every(l => batchSelectedLoanIds.has(l.id));
  }

  // Also toggle row visual style
  const cb = document.querySelector(`input[name="batchLoanCheckbox"][value="${loanId}"]`);
  if (cb) {
    const tr = cb.closest('tr');
    if (tr) {
      if (isChecked) {
        tr.classList.remove('bg-gray-50/50', 'opacity-60');
        tr.classList.add('bg-white');
      } else {
        tr.classList.add('bg-gray-50/50', 'opacity-60');
        tr.classList.remove('bg-white');
      }
    }
  }

  updateBatchDeductionLiveSummary();
}

function toggleBatchSelectAll(isChecked) {
  const query = (batchSearchQuery || '').toLowerCase();
  const visibleLoans = currentBatchEligibleLoans.filter(loan => {
    if (!query) return true;
    const text = `${loan.emp_name || ''} ${loan.emp_code || ''} ${loan.designation || ''} ${loan.loan_no || ''} ${loan.origin_pbs_name || ''}`.toLowerCase();
    return text.includes(query);
  });

  visibleLoans.forEach(loan => {
    if (isChecked) {
      batchSelectedLoanIds.add(loan.id);
    } else {
      batchSelectedLoanIds.delete(loan.id);
    }
  });

  // Re-render rows to reflect checked state and styling
  renderBatchDeductionRows();
}

function updateBatchDeductionLiveSummary() {
  const selectedCount = batchSelectedLoanIds.size;
  let totalAmount = 0;
  let totalPrincipal = 0;
  let totalInterest = 0;

  currentBatchEligibleLoans.forEach(loan => {
    if (batchSelectedLoanIds.has(loan.id)) {
      const inst = loan.monthly_installment || 0;
      totalAmount += inst;
      const prinBal = loan.principal_balance || 0;
      const intBal = loan.interest_balance || 0;
      if (prinBal > 0) {
        if (inst <= prinBal) {
          totalPrincipal += inst;
        } else {
          totalPrincipal += prinBal;
          totalInterest += Math.min(inst - prinBal, intBal);
        }
      } else {
        totalInterest += Math.min(inst, intBal);
      }
    }
  });

  const countEl = document.getElementById('batchSelectedLoansCount');
  const totalEl = document.getElementById('batchSelectedTotalAmount');
  const prinTotalEl = document.getElementById('batchSelectedPrincipalTotal');
  const intTotalEl = document.getElementById('batchSelectedInterestTotal');
  const submitBtn = document.getElementById('batchSubmitBtn');

  if (countEl) countEl.textContent = toBn(selectedCount);
  if (totalEl) totalEl.textContent = formatBDT(totalAmount);
  if (prinTotalEl) prinTotalEl.textContent = formatBDT(totalPrincipal);
  if (intTotalEl) intTotalEl.textContent = formatBDT(totalInterest);
  if (submitBtn) submitBtn.disabled = selectedCount === 0;
}

async function deleteRepaymentRecord(repId) {
  const result = await Swal.fire({
    icon: 'warning',
    title: 'এই কিস্তি কর্তন বাতিল করবেন?',
    html: '<div style="text-align:left; font-size:0.92rem; line-height:1.7; color:#374151;">' +
      '<p>এই কিস্তি কর্তনটি <strong>রিসাইকেল বিনে</strong> চলে যাবে।</p>' +
      '<p style="margin-top:8px;">✅ সংশ্লিষ্ট ঋণের <strong>আসল ও সুদের ব্যালেন্স</strong> স্বয়ংক্রিয়ভাবে পূর্বের অবস্থায় ফিরে যাবে।</p>' +
      '</div>',
    showCancelButton: true,
    confirmButtonText: '🗑️ হ্যাঁ, মুছে ফেলুন',
    cancelButtonText: '❌ না, বাতিল করুন',
    confirmButtonColor: '#e11d48',
    cancelButtonColor: '#6b7280',
    reverseButtons: true,
    focusCancel: true
  });

  if (!result.isConfirmed) return;

  try {
    const res = await API.delete('/repayments/' + repId);
    if (res.success) {
      showToast(res.message, 'success');
      loadRepayments();
      loadLoans();
      if (typeof loadDashboard === 'function') loadDashboard();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 5. INTEREST PROVISIONS
async function loadProvisions() {
  try {
    const res = await API.get('/provisions');
    if (!res.success) return;

    const tbody = document.getElementById('provisionsTableBody');
    tbody.innerHTML = '';

    if (res.provisions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center p-6 text-gray-400">কোন সুদ প্রভিশন রেকর্ড পাওয়া যায়নি।</td></tr>`;
      return;
    }

    res.provisions.forEach(p => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      tr.innerHTML = `
        <td class="p-3.5">
          <div class="font-bold text-gray-900">${toBn(p.provision_month)}</div>
          <div class="text-xs text-gray-500">${toBn(p.provision_date)}</div>
        </td>
        <td class="p-3.5">
          <div class="font-bold text-gray-800">${p.emp_name}</div>
          <div class="text-xs text-gray-500">${p.emp_code} &bull; ${p.designation}</div>
        </td>
        <td class="p-3.5">
          <div class="font-medium text-xs text-gray-800">${p.loan_no}</div>
          <div class="text-xs text-gray-400">বিতরণ: ${toBn(p.disbursement_date)}</div>
        </td>
        <td class="p-3.5 text-center">
          <span class="px-2 py-0.5 rounded-full text-xs font-bold ${p.applied_rate >= 8 ? 'bg-orange-100 text-orange-800' : 'bg-emerald-100 text-emerald-800'}">
            ${toBn(p.applied_rate)}%
          </span>
        </td>
        <td class="p-3.5 text-right font-medium text-gray-700">${formatBDT(p.principal_amount_on_date)}</td>
        <td class="p-3.5 text-right font-bold text-amber-800">${formatBDT(p.interest_amount)}</td>
        <td class="p-3.5 text-right font-bold text-gray-900">${formatBDT(p.new_interest_balance)}</td>
        <td class="p-3.5 text-center">
          <button onclick="deleteProvisionRecord(${p.id})" class="text-red-500 hover:text-red-700 p-1" title="প্রভিশন ডিলিট ও রিভার্স">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Provisions load error:', err);
  }
}

function getMonthEndDate(yyyyMm) {
  if (!yyyyMm) return '';
  const parts = yyyyMm.split('-');
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const lastDay = new Date(y, m, 0).getDate();
  return `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function onProvMonthChange() {
  const month = document.getElementById('provMonthInput')?.value;
  if (month) {
    const dateInput = document.getElementById('provDateInput');
    if (dateInput) dateInput.value = getMonthEndDate(month);
  }
  previewProvisions();
}

function openRunProvisionModal() {
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  document.getElementById('provMonthInput').value = currentMonth;
  document.getElementById('provDateInput').value = getMonthEndDate(currentMonth);
  previewProvisions();
  openModal('runProvisionModal');
}

async function previewProvisions() {
  const month = document.getElementById('provMonthInput')?.value;
  const container = document.getElementById('provPreviewStats');
  if (!month) return;

  try {
    const res = await API.get('/provisions/preview', { month });
    if (res.success) {
      if (res.eligibleCount === 0) {
        container.innerHTML = `<span class="text-red-600 font-semibold">${month} মাসের জন্য কোনো অপরিশোধিত নিজস্ব ঋণ অবশিষ্ট নেই অথবা ইতিমধ্যে প্রভিশন সম্পন্ন হয়েছে।</span>`;
      } else {
        container.innerHTML = `
          <div class="text-emerald-800 font-bold text-sm">যোগ্য ঋণ সংখ্যা: ${toBn(res.eligibleCount)} টি</div>
          <div>পূর্ববর্তী মাসের শেষ স্থিতির ওপর মোট ধার্যযোগ্য সরল সুদ: <strong>${formatBDT(res.totalCalculatedInterest)}</strong></div>
          <div class="text-[11px] text-gray-600 mt-1">※ বিধি: পূর্ববর্তী মাসের শেষ অপরিশোধিত আসলের (Monthly Rest Balance) উপর হিসাবকৃত এবং মাসের শেষ তারিখে পোস্টিং। ২০২০ পূর্ববর্তী অপরিশোধিত ব্যালেন্সে ৮% ও ২০২০ পরবর্তী ব্যালেন্সে ৭% সরল সুদ।</div>
        `;
      }
    }
  } catch (err) {
    container.textContent = 'প্রিভিউ লোড করা যায়নি: ' + err.message;
  }
}

async function executeProvisions() {
  const provision_month = document.getElementById('provMonthInput').value;
  const provision_date = document.getElementById('provDateInput').value;

  if (!provision_month || !provision_date) {
    showToast('মাস ও তারিখ নির্বাচন করুন', 'error');
    return;
  }

  try {
    const res = await API.post('/provisions/run-monthly', { provision_month, provision_date });
    if (res.success) {
      closeModal('runProvisionModal');
      showToast(res.message, 'success');
      loadProvisions();
      loadLoans();
      if (typeof loadDashboard === 'function') loadDashboard();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function triggerAutoProvisionSync() {
  try {
    showToast('অটো প্রভিশন সিঙ্ক করা হচ্ছে...', 'info');
    const res = await API.post('/provisions/auto-sync', {});
    if (res && res.success) {
      showToast(res.message, 'success');
      loadProvisions();
      loadLoans();
      if (typeof loadDashboard === 'function') loadDashboard();
    } else {
      showToast(res?.message || 'সিঙ্ক সম্পন্ন হয়েছে।', 'info');
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteProvisionRecord(provId) {
  if (!await confirmWithSweetAlert('আপনি কি এই সুদ প্রভিশন বাতিল করতে চান? ঋণের সুদ ব্যালেন্স সমন্বয় করা হবে।')) return;
  try {
    const res = await API.delete(`/provisions/${provId}`);
    if (res.success) {
      showToast(res.message, 'success');
      loadProvisions();
      loadLoans();
      if (typeof loadDashboard === 'function') loadDashboard();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 6. INTER-PBS REMITTANCES & LETTERS (PBS & Date Range based)
let currentAdviceRepayments = [];

async function loadRemittances() {
  try {
    const targetPbsName = document.getElementById('remittancePbsFilter')?.value || '';
    const fromDate = document.getElementById('remittanceFromDate')?.value || '';
    const toDate = document.getElementById('remittanceToDate')?.value || '';

    // Populate PBS dropdown filter if empty
    const pbsSelect = document.getElementById('remittancePbsFilter');
    if (pbsSelect && pbsSelect.options.length <= 1 && state.otherPbsList) {
      state.otherPbsList.forEach(p => {
        pbsSelect.innerHTML += `<option value="${p.pbs_name}">${p.pbs_name}</option>`;
      });
      if (targetPbsName) pbsSelect.value = targetPbsName;
    }

    // 1. Pending Remittances Grouped by PBS
    const pendingRes = await API.get('/remittances/pending', { targetPbsName, fromDate, toDate });
    const pendingContainer = document.getElementById('pendingRemittancesContainer');
    pendingContainer.innerHTML = '';

    if (pendingRes.success && pendingRes.pendingList.length > 0) {
      const table = document.createElement('table');
      table.className = 'w-full min-w-[900px] border-collapse text-xs text-left';
      table.innerHTML = `
        <thead class="sticky top-0 z-10 bg-slate-100 text-gray-700">
          <tr>
            <th class="border border-slate-300 px-3 py-2 text-center w-12">ক্র.</th>
            <th class="border border-slate-300 px-3 py-2">কর্মচারী / পে-আইডি</th>
            <th class="border border-slate-300 px-3 py-2">ঋণ নং</th>
            <th class="border border-slate-300 px-3 py-2">কিস্তির মাসসমূহ</th>
            <th class="border border-slate-300 px-3 py-2 text-center">কিস্তি সংখ্যা</th>
            <th class="border border-slate-300 px-3 py-2 text-right">প্রেরণযোগ্য টাকা</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector('tbody');

      pendingRes.pendingList.forEach((item, groupIndex) => {
        const pbsRow = document.createElement('tr');
        pbsRow.className = 'bg-purple-50';
        pbsRow.innerHTML = `
          <td colspan="4" class="border border-purple-200 px-3 py-3 align-top">
            <div class="font-bold text-purple-950 text-sm">${escapeHtml(item.pbsName)}</div>
            <div class="mt-1 text-[11px] text-purple-900">
              ব্যাংক: <strong>${escapeHtml(item.targetBank)}</strong> (${escapeHtml(item.targetBranch || '-')}) |
              হিসাব: <strong class="font-mono">${escapeHtml(item.targetAccountNo)}</strong> |
              রাউটিং: <strong class="font-mono">${escapeHtml(item.targetRoutingNo || '-')}</strong>
            </div>
            <div class="mt-1 text-[11px] text-purple-800">${escapeHtml(item.periodText)}</div>
          </td>
          <td class="border border-purple-200 px-3 py-3 text-center font-semibold text-purple-900">
            ${toBn(item.totalInstallmentsCount)} কিস্তি<br>${toBn(item.distinctEmployeeCount)} জন
          </td>
          <td class="border border-purple-200 px-3 py-3 text-right align-middle">
            <div class="font-bold text-emerald-800 text-sm">${formatBDT(item.totalAmount)}</div>
          </td>
        `;
        tbody.appendChild(pbsRow);

        (item.employees || []).forEach((emp, employeeIndex) => {
          const row = document.createElement('tr');
          row.className = employeeIndex % 2 === 0 ? 'bg-white hover:bg-blue-50/50' : 'bg-slate-50 hover:bg-blue-50/50';
          row.innerHTML = `
            <td class="border border-slate-200 px-3 py-2 text-center text-gray-500">${toBn(groupIndex + 1)}.${toBn(employeeIndex + 1)}</td>
            <td class="border border-slate-200 px-3 py-2">
              <span class="font-mono font-bold text-blue-900">${escapeHtml(emp.empCode)}</span>
              <span class="ml-1 text-gray-800">${escapeHtml(emp.empName)}</span>
              <div class="text-[10px] text-gray-500">${escapeHtml(emp.designation || '')}</div>
            </td>
            <td class="border border-slate-200 px-3 py-2 font-mono">${escapeHtml(emp.loanNo || '-')}</td>
            <td class="border border-slate-200 px-3 py-2">${(emp.months || []).map(month => escapeHtml(formatBengaliMonth(month))).join(', ')}</td>
            <td class="border border-slate-200 px-3 py-2 text-center">${toBn(emp.installmentsCount)}</td>
            <td class="border border-slate-200 px-3 py-2 text-right font-mono font-semibold">${formatBDT(emp.totalAmount)}</td>
          `;
          tbody.appendChild(row);
        });
      });

      pendingContainer.appendChild(table);
      if (window.lucide) lucide.createIcons();
    } else {
      pendingContainer.innerHTML = `<div class="text-center p-8 text-gray-400 text-sm bg-gray-50 rounded-xl">নির্বাচিত ফিল্টারে কোনো অনিষ্পন্ন রেমিট্যান্স কিস্তি পাওয়া যায়নি।</div>`;
    }

  } catch (err) {
    console.error('Remittances load error:', err);
  }
}

let generatedBankAdvices = [];
let generatedAdvicesPage = 1;
let generatedAdvicesPageSize = 4;

async function loadGeneratedBankAdvices() {
  const tbody = document.getElementById('advicesTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="8" class="text-center p-8 text-gray-400">অ্যাডভাইস লোড হচ্ছে...</td></tr>';

  try {
    const advicesRes = await API.get('/remittances/advices');
    if (!advicesRes.success) {
      throw new Error(advicesRes.message || 'প্রস্তুতকৃত অ্যাডভাইস লোড করা যায়নি।');
    }

    generatedBankAdvices = advicesRes.advices || [];
    renderGeneratedBankAdvices();
  } catch (error) {
    console.error('Generated bank advices load error:', error);
    tbody.innerHTML = '<tr><td colspan="8" class="text-center p-8 text-red-600">প্রস্তুতকৃত অ্যাডভাইস লোড করা যায়নি।</td></tr>';
    showToast(error.message || 'প্রস্তুতকৃত অ্যাডভাইস লোড করা যায়নি।', 'error');
  }
}

function renderGeneratedBankAdvices() {
  const tbody = document.getElementById('advicesTableBody');
  if (!tbody) return;

  const total = generatedBankAdvices.length;
  const pageSizeSelect = document.getElementById('advicesPageSize');
  if (pageSizeSelect) pageSizeSelect.value = String(generatedAdvicesPageSize);

  const pageCount = generatedAdvicesPageSize === 'all'
    ? (total > 0 ? 1 : 0)
    : Math.ceil(total / generatedAdvicesPageSize);
  generatedAdvicesPage = pageCount === 0 ? 1 : Math.min(generatedAdvicesPage, pageCount);

  const startIndex = generatedAdvicesPageSize === 'all'
    ? 0
    : (generatedAdvicesPage - 1) * generatedAdvicesPageSize;
  const endIndex = generatedAdvicesPageSize === 'all'
    ? total
    : Math.min(startIndex + generatedAdvicesPageSize, total);
  const visibleAdvices = generatedBankAdvices.slice(startIndex, endIndex);

  tbody.innerHTML = '';
  if (visibleAdvices.length > 0) {
    visibleAdvices.forEach(adv => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      tr.innerHTML = `
          <td class="p-3.5">
            <div class="font-bold font-mono text-purple-900">${escapeHtml(adv.advice_no || '')}</div>
            <div class="text-xs text-gray-500">${toBn(adv.advice_date || '')}</div>
          </td>
          <td class="p-3.5 text-xs text-gray-700 font-mono">${escapeHtml(adv.memo_no || '')}</td>
          <td class="p-3.5 font-bold text-gray-800">${escapeHtml(adv.target_pbs_name || '')}</td>
          <td class="p-3.5 text-xs font-semibold text-gray-700">${escapeHtml(adv.period_text || toBn(adv.deduction_month || ''))}</td>
          <td class="p-3.5 text-center font-bold">${toBn(adv.employee_count)} জন</td>
          <td class="p-3.5 text-right font-bold text-emerald-800">${formatBDT(adv.total_amount)}</td>
          <td class="p-3.5 text-center">
            <button onclick="viewPrintableDocument(${adv.id})" class="px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold flex items-center space-x-1 mx-auto shadow-sm">
              <i data-lucide="printer" class="w-3.5 h-3.5"></i>
              <span>পত্র / অ্যাডভাইস</span>
            </button>
          </td>
          <td class="p-3.5 text-center">
            <button onclick="deleteAdviceRecord(${adv.id})" class="text-red-500 hover:text-red-700 p-1" title="ডিলিট ও কিস্তি অনিষ্পন্ন করা">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </td>
        `;
      tbody.appendChild(tr);
    });
  } else {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center p-8 text-gray-400">কোন প্রস্তুতকৃত ব্যাংক অ্যাডভাইস পাওয়া যায়নি।</td></tr>';
  }

  const rangeText = total === 0
    ? '০টি অ্যাডভাইস'
    : `${toBn(startIndex + 1)}–${toBn(endIndex)} / ${toBn(total)} টি অ্যাডভাইস`;
  const pageInfo = document.getElementById('advicesPageInfo');
  const pageNumber = document.getElementById('advicesPageNumber');
  const prevButton = document.getElementById('advicesPrevPage');
  const nextButton = document.getElementById('advicesNextPage');
  if (pageInfo) pageInfo.textContent = rangeText;
  if (pageNumber) pageNumber.textContent = `পৃষ্ঠা ${toBn(pageCount ? generatedAdvicesPage : 0)} / ${toBn(pageCount)}`;
  if (prevButton) prevButton.disabled = generatedAdvicesPage <= 1 || pageCount <= 1 || generatedAdvicesPageSize === 'all';
  if (nextButton) nextButton.disabled = generatedAdvicesPage >= pageCount || pageCount <= 1 || generatedAdvicesPageSize === 'all';

  if (window.lucide) lucide.createIcons();
}

function changeAdvicesPageSize(value) {
  generatedAdvicesPageSize = value === 'all' ? 'all' : Number(value);
  generatedAdvicesPage = 1;
  renderGeneratedBankAdvices();
}

function changeAdvicesPage(direction) {
  if (generatedAdvicesPageSize === 'all') return;
  const pageCount = Math.ceil(generatedBankAdvices.length / generatedAdvicesPageSize);
  generatedAdvicesPage = Math.max(1, Math.min(generatedAdvicesPage + direction, pageCount));
  renderGeneratedBankAdvices();
}

function resetRemittanceFilter() {
  document.getElementById('remittancePbsFilter').value = '';
  document.getElementById('remittanceFromDate').value = '';
  document.getElementById('remittanceToDate').value = '';
  loadRemittances();
}

async function openAllPbsAdviceModal() {
  document.getElementById('allPbsAdviceDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('allPbsFromDate').value = '';
  document.getElementById('allPbsToDate').value = '';
  document.getElementById('allPbsMemoNo').value = '';

  openModal('allPbsAdviceModal');
  await refreshAllPbsAdvicePending();
}

async function refreshAllPbsAdvicePending() {
  const fromDate = document.getElementById('allPbsFromDate')?.value || '';
  const toDate = document.getElementById('allPbsToDate')?.value || '';
  const countBadge = document.getElementById('allPbsPendingCountBadge');
  const totalEl = document.getElementById('allPbsPendingTotalAmount');
  const previewContainer = document.getElementById('allPbsPendingListPreview');
  const submitBtn = document.getElementById('allPbsSubmitBtn');

  if (countBadge) countBadge.textContent = 'হিসাব করা হচ্ছে...';
  if (totalEl) totalEl.textContent = '...';
  if (previewContainer) {
    previewContainer.innerHTML = '<div class="text-xs text-gray-500 py-3 flex items-center justify-center space-x-2"><i data-lucide="loader-2" class="w-4 h-4 animate-spin text-purple-600"></i><span>অনিষ্পন্ন রেমিট্যান্স কিস্তিসমূহ যাচাই করা হচ্ছে...</span></div>';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const params = {};
    if (fromDate) params.fromDate = fromDate;
    if (toDate) params.toDate = toDate;

    const res = await API.get('/remittances/pending', params);
    if (res.success) {
      const list = res.pendingList || [];
      state.currentAllPbsPendingList = list;
      const totalAmt = list.reduce((sum, item) => sum + (Number(item.totalAmount) || 0), 0);

      if (countBadge) countBadge.textContent = `${toBn(list.length)} টি পবিস`;
      if (totalEl) totalEl.textContent = formatBDT(totalAmt);

      // Keep button clickable so click gives clear feedback!
      if (submitBtn) {
        submitBtn.disabled = false;
        if (list.length === 0) {
          submitBtn.className = 'px-5 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-sm font-semibold shadow flex items-center space-x-2';
        } else {
          submitBtn.className = 'px-5 py-2 bg-gradient-to-r from-emerald-700 to-emerald-600 hover:from-emerald-800 hover:to-emerald-700 text-white rounded-lg text-sm font-semibold shadow-md flex items-center space-x-2';
        }
      }

      if (list.length === 0) {
        if (previewContainer) {
          previewContainer.innerHTML = `
            <div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-2">
              <div class="flex items-center space-x-1.5 font-bold text-amber-800">
                <i data-lucide="info" class="w-4 h-4 text-amber-600"></i>
                <span>বর্তমানে কোনো অনিষ্পন্ন রেমিট্যান্স কিস্তি নেই</span>
              </div>
              <p class="leading-relaxed text-[11px] text-amber-800">
                অন্য পবিসে প্রেরণের মতো কোনো কিস্তি কর্তন অপেক্ষমাণ নেই। নতুন ব্যাংক অ্যাডভাইস তৈরি করতে প্রথমে সংশ্লিষ্ট কর্মচারীদের মাসিক বেতন হতে কিস্তি কর্তন সম্পন্ন করতে হবে।
              </p>
              <div class="flex items-center space-x-2 pt-1">
                <button type="button" onclick="closeModal('allPbsAdviceModal'); openBatchDeductionModal();" class="px-3 py-1.5 bg-purple-700 hover:bg-purple-800 text-white rounded-lg font-bold text-xs shadow flex items-center space-x-1.5 transition">
                  <i data-lucide="calculator" class="w-3.5 h-3.5"></i>
                  <span>বেতন কিস্তি কর্তন চালান</span>
                </button>
                <button type="button" onclick="closeModal('allPbsAdviceModal'); switchTab('remittances');" class="px-3 py-1.5 bg-white hover:bg-gray-100 text-purple-900 border border-purple-200 rounded-lg font-medium text-xs shadow-sm flex items-center space-x-1 transition">
                  <i data-lucide="history" class="w-3.5 h-3.5"></i>
                  <span>পূর্বের অ্যাডভাইস তালিকা</span>
                </button>
              </div>
            </div>
          `;
        }
      } else {
        if (previewContainer) {
          previewContainer.innerHTML = list.map(item => `
            <div class="flex items-center justify-between p-2.5 bg-white rounded-lg border border-purple-100 text-xs shadow-sm hover:border-purple-300 transition">
              <div>
                <div class="font-bold text-purple-950">${item.pbsName}</div>
                <div class="text-[11px] text-gray-500">${item.targetBank} (${item.targetBranch || ''}) • হিসাব নং: <span class="font-mono text-gray-700">${item.targetAccountNo}</span></div>
              </div>
              <div class="text-right">
                <div class="font-bold text-emerald-800 font-mono">${formatBDT(item.totalAmount)}</div>
                <div class="text-[10px] text-gray-400">${toBn(item.distinctEmployeeCount)} জন কর্মচারী</div>
              </div>
            </div>
          `).join('');
        }
      }
      if (window.lucide) lucide.createIcons();
    }
  } catch (err) {
    console.warn('Error loading pending remittances for advice modal:', err);
    if (previewContainer) {
      previewContainer.innerHTML = `<div class="text-xs text-red-600 bg-red-50 p-2 rounded">তথ্য লোড করতে সমস্যা হয়েছে: ${err.message}</div>`;
    }
  }
}

async function submitAllPbsAdvice(e) {
  e.preventDefault();

  const pendingList = state.currentAllPbsPendingList || [];
  if (pendingList.length === 0) {
    showToast('বর্তমানে অন্য পবিসে প্রেরণের মতো কোনো অনিষ্পন্ন কিস্তি নেই। দয়া করে প্রথমে "বেতন কিস্তি কর্তন" থেকে কিস্তি কর্তন সম্পন্ন করুন।', 'warning');
    return;
  }

  const adviceDate = document.getElementById('allPbsAdviceDate').value;
  const fromDate = document.getElementById('allPbsFromDate').value;
  const toDate = document.getElementById('allPbsToDate').value;
  const memoNo = document.getElementById('allPbsMemoNo').value;

  const submitBtn = document.getElementById('allPbsSubmitBtn') || e.target.querySelector('[type="submit"]');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'প্রস্তুত করা হচ্ছে...';
  }

  try {
    const res = await API.post('/remittances/generate-all', {
      advice_date: adviceDate,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
      memo_no: memoNo || undefined
    });

    if (res.success) {
      showToast(res.message, 'success');
      closeModal('allPbsAdviceModal');
      loadRemittances();
      loadGeneratedBankAdvices();
      if (typeof loadDashboard === 'function') {
        loadDashboard();
      }
      // Immediately open print view
      await viewPrintableDocument(res.adviceId);
    } else {
      showToast(res.message || 'অ্যাডভাইস প্রস্তুত করা যায়নি।', 'error');
    }
  } catch (err) {
    showToast(err.message || 'সার্ভার ত্রুটি।', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i data-lucide="file-check" class="w-4 h-4"></i><span>একত্রিত অ্যাডভাইস প্রস্তুত করুন</span>';
      if (window.lucide) lucide.createIcons();
    }
  }
}


function openGenerateAdviceModal(encodedData) {
  const item = JSON.parse(unescape(encodedData));
  document.getElementById('adviceTargetPbsName').value = item.pbsName;
  document.getElementById('adviceTargetPbsId').value = item.pbsId || '';
  document.getElementById('advicePbsTitle').textContent = `${item.pbsName} (রেমিট্যান্স)`;
  document.getElementById('adviceBankInfoText').innerHTML = `
    প্রাপক ব্যাংক: <strong>${item.targetBank}</strong> (${item.targetBranch || ''}) &bull; হিসাব নং: <strong class="font-mono text-blue-900">${item.targetAccountNo}</strong> &bull; রাউটিং: <strong class="font-mono">${item.targetRoutingNo || 'নেই'}</strong>
  `;

  // Pre-fill Date Range
  document.getElementById('adviceFromDateInput').value = item.earliestDate || '';
  document.getElementById('adviceToDateInput').value = item.latestDate || '';
  document.getElementById('adviceDateInput').value = new Date().toISOString().slice(0, 10);
  document.getElementById('adviceMemoInput').value = '';

  // Store repayments in memory and render
  currentAdviceRepayments = item.repayments || [];
  renderAdviceInstallmentsTable();

  openModal('generateAdviceModal');
}

function renderAdviceInstallmentsTable() {
  const tbody = document.getElementById('adviceInstallmentsTableBody');
  const fromDate = document.getElementById('adviceFromDateInput')?.value || '';
  const toDate = document.getElementById('adviceToDateInput')?.value || '';

  tbody.innerHTML = '';

  const filtered = currentAdviceRepayments.filter(r => {
    if (fromDate && r.deduction_date < fromDate) return false;
    if (toDate && r.deduction_date > toDate) return false;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-gray-400 font-sans">নির্বাচিত ডেট রেঞ্জে কোনো কিস্তি নেই।</td></tr>`;
    updateAdviceLiveTotal();
    return;
  }

  filtered.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-purple-50/50';
    tr.innerHTML = `
      <td class="p-2 text-center">
        <input type="checkbox" name="adviceRepaymentCheck" value="${r.repayment_id}" data-amount="${r.total_amount}" onchange="updateAdviceLiveTotal()" checked class="rounded text-purple-600">
      </td>
      <td class="p-2 font-bold font-mono text-purple-900">${r.emp_code}</td>
      <td class="p-2 font-sans font-medium text-gray-800">${r.emp_name} <span class="text-[11px] text-gray-500 font-normal">(${r.designation})</span></td>
      <td class="p-2 text-gray-600">${r.loan_no}</td>
      <td class="p-2 text-center text-gray-700">${toBn(r.deduction_month)}</td>
      <td class="p-2 text-right font-bold text-gray-900">${formatBDT(r.total_amount)}</td>
    `;
    tbody.appendChild(tr);
  });

  updateAdviceLiveTotal();
}

function filterAdviceInstallmentsByDate() {
  renderAdviceInstallmentsTable();
}

function toggleSelectAllAdviceItems(checked) {
  const checkboxes = document.querySelectorAll('input[name="adviceRepaymentCheck"]');
  checkboxes.forEach(cb => {
    cb.checked = checked;
  });
  updateAdviceLiveTotal();
}

function updateAdviceLiveTotal() {
  const checkboxes = document.querySelectorAll('input[name="adviceRepaymentCheck"]:checked');
  let total = 0;
  checkboxes.forEach(cb => {
    total += parseFloat(cb.dataset.amount || 0);
  });

  document.getElementById('adviceLiveTotalAmount').textContent = formatBDT(total);
  document.getElementById('adviceSelectedSummary').textContent = `${toBn(checkboxes.length)} টি কিস্তি নির্বাচিত (মোট: ${formatBDT(total)})`;
}

async function deleteAdviceRecord(adviceId) {
  if (!await confirmWithSweetAlert('আপনি কি এই ব্যাংক অ্যাডভাইস বাতিল করতে চান? এতে অন্তর্ভুক্ত কিস্তিসমূহ পুনরায় অনিষ্পন্ন তালিকায় যুক্ত হবে।')) return;
  try {
    const res = await API.delete(`/remittances/advices/${adviceId}`);
    if (res.success) {
      showToast(res.message, 'success');
      loadRemittances();
      loadGeneratedBankAdvices();
      loadRepayments();
      if (typeof loadDashboard === 'function') loadDashboard();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 7. PRINTABLE DOCUMENT VIEWER (Bank Advice & PBS Forwarding Letter)
async function viewPrintableDocument(adviceId) {
  try {
    const res = await API.get(`/remittances/advices/${adviceId}`);
    if (!res.success) return;

    state.selectedDocumentAdvice = res;
    state.currentDocView = 'advice'; // default to Bank Advice format
    switchDocumentView('advice');
    openModal('printDocumentModal');

    // Always scroll to top so letterhead is immediately and completely visible
    const scrollBody = document.getElementById('printDocumentScrollBody');
    if (scrollBody) scrollBody.scrollTop = 0;
  } catch (err) {
    showToast('ডকুমেন্ট লোড করা যায়নি', 'error');
  }
}

let isDocModalFullscreen = false;

function toggleDocModalFullscreen() {
  const dialog = document.getElementById('printDocumentDialog');
  const icon = document.getElementById('docModalFullscreenIcon');
  const btn = document.getElementById('docModalFullscreenBtn');
  const sheet = document.getElementById('printableDocumentContent');
  if (!dialog) return;

  isDocModalFullscreen = !isDocModalFullscreen;

  if (isDocModalFullscreen) {
    dialog.classList.remove('w-full', 'max-w-[96vw]', 'xl:max-w-7xl', 'h-[94vh]', 'rounded-2xl');
    dialog.classList.add('fixed', 'inset-0', 'w-screen', 'h-screen', 'max-w-none', 'm-0', 'rounded-none', 'z-50');
    if (sheet) {
      sheet.classList.remove('max-w-[1250px]', 'rounded-xl', 'shadow-lg');
      sheet.classList.add('max-w-none', 'w-full', 'rounded-none', 'shadow-none');
    }
    if (icon) icon.setAttribute('data-lucide', 'minimize-2');
    if (btn) btn.title = 'স্বাভাবিক আকার (Exit Fullscreen)';
  } else {
    dialog.classList.add('w-full', 'max-w-[96vw]', 'xl:max-w-7xl', 'h-[94vh]', 'rounded-2xl');
    dialog.classList.remove('fixed', 'inset-0', 'w-screen', 'h-screen', 'max-w-none', 'm-0', 'rounded-none', 'z-50');
    if (sheet) {
      sheet.classList.add('max-w-[1250px]', 'rounded-xl', 'shadow-lg');
      sheet.classList.remove('max-w-none', 'rounded-none', 'shadow-none');
    }
    if (icon) icon.setAttribute('data-lucide', 'maximize-2');
    if (btn) btn.title = 'ফুলস্ক্রিন মুড (Fullscreen)';
  }

  if (window.lucide) lucide.createIcons();
}

function switchDocumentView(viewType) {
  state.currentDocView = viewType;
  const letterBtn = document.getElementById('docViewLetterBtn');
  const adviceBtn = document.getElementById('docViewAdviceBtn');
  const officeNoteBtn = document.getElementById('docViewOfficeNoteBtn');
  const activeClass = 'px-3.5 py-1.5 bg-emerald-800 text-white rounded-md text-xs font-bold shadow-sm transition';
  const inactiveClass = 'px-3.5 py-1.5 text-gray-700 hover:text-gray-900 hover:bg-gray-300/50 rounded-md text-xs font-bold transition';

  if (letterBtn) letterBtn.className = viewType === 'letter' ? activeClass : inactiveClass;
  if (adviceBtn) adviceBtn.className = viewType === 'advice' ? activeClass : inactiveClass;
  if (officeNoteBtn) officeNoteBtn.className = viewType === 'office_note' ? activeClass : inactiveClass;

  renderPrintableDocument();

  // Reset scroll to top
  const scrollBody = document.getElementById('printDocumentScrollBody');
  if (scrollBody) scrollBody.scrollTop = 0;
}

function printCurrentDocument() {
  const content = document.getElementById('printableDocumentContent');
  if (!content) return;

  const isAdvice = state.currentDocView === 'advice';
  const orientation = isAdvice ? 'landscape' : 'portrait';
  const printTitle = state.currentDocView === 'office_note'
    ? 'Official Office Note'
    : isAdvice ? 'Bank Advice' : 'Forwarding Letter';

  // Use an invisible iframe to isolate and directly print the document
  let printFrame = document.getElementById('documentPrintFrame');
  if (printFrame) {
    printFrame.remove();
  }

  printFrame = document.createElement('iframe');
  printFrame.id = 'documentPrintFrame';
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  printFrame.style.border = '0';
  printFrame.style.visibility = 'hidden';
  document.body.appendChild(printFrame);

  const doc = printFrame.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <title>${printTitle}</title>
      <script src="/js/vendor/tailwindcss.js"></script>
      <style>
        @page {
          size: A4 ${orientation};
          margin: 10mm 12mm 10mm 12mm;
        }
        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        html, body {
          margin: 0;
          padding: 0;
          background: #ffffff !important;
          color: #000000 !important;
          font-family: system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        .bank-advice-sheet, .printable-document {
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 4px !important;
          overflow: visible !important;
        }
        table {
          width: 100% !important;
          border-collapse: collapse !important;
        }
        table, th, td {
          border: 1px solid #000000 !important;
          color: #000000 !important;
        }
        th {
          background-color: #f3f4f6 !important;
        }
        .signature-box {
          page-break-inside: avoid;
        }
      </style>
    </head>
    <body class="p-2">
      ${content.innerHTML}
    </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    try {
      printFrame.contentWindow.focus();
      printFrame.contentWindow.print();
    } catch (e) {
      console.warn('Iframe print failed, falling back to window.print():', e);
      window.print();
    }
  }, 400);
}

window.printCurrentDocument = printCurrentDocument;

function renderPrintableDocument() {
  const container = document.getElementById('printableDocumentContent');
  if (!state.selectedDocumentAdvice) return;

  const { advice, ownPbs, items, groupedByPbs } = state.selectedDocumentAdvice;
  const periodDisplay = advice.period_text || toBn(advice.deduction_month);
  const isCombined = advice.target_pbs_name === 'সকল পবিস';

  if (state.currentDocView === 'office_note') {
    const bankAdviceGroups = groupedByPbs?.length ? groupedByPbs : [{
      pbsName: advice.target_pbs_name,
      bankName: advice.target_bank_name,
      bankBranch: advice.target_bank_branch,
      accountNo: advice.target_account_no,
      pbsTotal: advice.total_amount
    }];
    const noteRows = bankAdviceGroups.map((group, index) => `
      <tr>
        <td style="border:1px solid #444;padding:6px;text-align:center">${toBn(index + 1)}</td>
        <td style="border:1px solid #444;padding:6px">${escapeHtml(group.pbsName || '')}</td>
        <td style="border:1px solid #444;padding:6px">${escapeHtml(group.bankName || '')}${group.bankBranch ? `, ${escapeHtml(group.bankBranch)}` : ''}</td>
        <td style="border:1px solid #444;padding:6px;font-family:monospace">${escapeHtml(group.accountNo || '')}</td>
        <td style="border:1px solid #444;padding:6px;text-align:right;font-family:monospace">${formatBDT(group.pbsTotal || 0)}</td>
      </tr>
    `).join('');
    const preparedBy = escapeHtml(ownPbs.bank_advice_prepared_by_name || '');
    const verifiedBy = escapeHtml(ownPbs.bank_advice_verified_by_name || '');

    container.innerHTML = `
      <div style="width:100%;color:#111;font-family:inherit;font-size:12px;line-height:1.55">
        ${renderPbsLetterhead(ownPbs)}
        <h2 style="margin:14px 0;text-align:center;font-size:18px;font-weight:700;text-decoration:underline">অফিস নোট</h2>
        <div style="display:flex;justify-content:space-between;gap:24px;margin-bottom:12px">
          <div><strong>নোট নং:</strong> ${escapeHtml(advice.advice_no || '')}</div>
          <div><strong>তারিখ:</strong> ${toBengaliCalendarDate(advice.advice_date)}</div>
        </div>
        <p style="margin:8px 0"><strong>বিষয়:</strong> ${isCombined ? 'সকল পল্লী বিদ্যুৎ সমিতিতে কিস্তির অর্থ প্রেরণের ব্যাংক অ্যাডভাইস অনুমোদন প্রসঙ্গে।' : `${escapeHtml(advice.target_pbs_name || '')}-এ কিস্তির অর্থ প্রেরণের ব্যাংক অ্যাডভাইস অনুমোদন প্রসঙ্গে।`}</p>
        <p style="margin:8px 0;text-align:justify">
          বেতন হতে কর্তনকৃত কিস্তির অর্থ সংশ্লিষ্ট পল্লী বিদ্যুৎ সমিতির ব্যাংক হিসাবে প্রেরণের জন্য ব্যাংক অ্যাডভাইস প্রস্তুত করা হয়েছে। যাচাই ও অনুমোদনের জন্য নোটটি উপস্থাপন করা হলো।
        </p>
        <p style="margin:8px 0"><strong>ব্যাংক অ্যাডভাইস নং:</strong> ${escapeHtml(advice.advice_no || '')}
          &nbsp; <strong>সময়কাল:</strong> ${escapeHtml(periodDisplay)}
          &nbsp; <strong>সর্বমোট:</strong> ${formatBDT(advice.total_amount || 0)} টাকা
        </p>
        <table style="width:100%;border-collapse:collapse;margin:12px 0;font-size:11px">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="border:1px solid #444;padding:6px">ক্রম</th>
              <th style="border:1px solid #444;padding:6px">পবিস</th>
              <th style="border:1px solid #444;padding:6px">ব্যাংক ও শাখা</th>
              <th style="border:1px solid #444;padding:6px">হিসাব নম্বর</th>
              <th style="border:1px solid #444;padding:6px;text-align:right">টাকা</th>
            </tr>
          </thead>
          <tbody>${noteRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="4" style="border:1px solid #444;padding:6px;text-align:right;font-weight:700">সর্বমোট</td>
              <td style="border:1px solid #444;padding:6px;text-align:right;font-weight:700">${formatBDT(advice.total_amount || 0)}</td>
            </tr>
          </tfoot>
        </table>
        <p style="margin:10px 0">অতএব, উল্লিখিত ব্যাংক অ্যাডভাইস অনুযায়ী অর্থ প্রেরণের প্রয়োজনীয় অনুমোদন প্রদানের জন্য উপস্থাপন করা হলো।</p>
        <div style="display:flex;justify-content:space-between;gap:48px;margin-top:72px;page-break-inside:avoid">
          <div style="width:42%;text-align:center">
            <div style="border-top:1px solid #111;padding-top:5px;font-weight:700">${preparedBy || '&nbsp;'}</div>
            <div>জুনিয়র অফিসার (হিসাব)</div>
            <div>প্রস্তুতকারী</div>
          </div>
          <div style="width:42%;text-align:center">
            <div style="border-top:1px solid #111;padding-top:5px;font-weight:700">${verifiedBy || '&nbsp;'}</div>
            <div>অফিসার (হিসাব)</div>
            <div>যাচাইকারী</div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  if (state.currentDocView === 'letter') {
    // Official Forwarding Letter
    const recipientTitle = isCombined ? 'জেনারেল ম্যানেজার / সিনিয়র জেনারেল ম্যানেজারবৃন্দ' : 'জেনারেল ম্যানেজার / সিনিয়র জেনারেল ম্যানেজার';
    const recipientPbs = isCombined ? 'সংশ্লিষ্ট সকল পল্লী বিদ্যুৎ সমিতি' : advice.target_pbs_name;
    const bodyTransferText = isCombined
      ? `অত্র সমিতির ব্যাংক হিসাব হতে ব্যাংক অ্যাডভাইস নং- <strong>${advice.advice_no}</strong> মূলে সংশ্লিষ্ট সমিতিসমূহের ব্যাংক হিসাবে <strong>বিইএফটিএন (BEFTN)</strong> যোগে স্থানান্তর/প্রেরণ করা হলো।`
      : `আপনার সমিতির <strong>${advice.target_bank_name} (${advice.target_bank_branch || ''})</strong> এর হিসাব নং- <strong>${advice.target_account_no}</strong> (রাউটিং নং: <strong>${advice.target_routing_no || '-'}</strong>) তে অত্র সমিতির ব্যাংক হিসাব হতে ব্যাংক অ্যাডভাইস নং- <strong>${advice.advice_no}</strong> মূলে <strong>বিইএফটিএন (BEFTN)</strong> যোগে স্থানান্তর/প্রেরণ করা হলো।`;

    let letterRowsHtml = '';
    if (isCombined && groupedByPbs && groupedByPbs.length > 0) {
      let lSerial = 1;
      groupedByPbs.forEach(grp => {
        (grp.employees || []).forEach(emp => {
          const mText = formatMonthsList(emp.months);
          letterRowsHtml += `
            <tr class="border-b border-gray-300">
              <td class="p-2 border border-gray-400 text-center font-mono">${toBn(lSerial++)}</td>
              <td class="p-2 border border-gray-400 text-center font-mono font-bold text-purple-900">${emp.empCode}</td>
              <td class="p-2 border border-gray-400 font-bold">${emp.empName}</td>
              <td class="p-2 border border-gray-400">${emp.designation}</td>
              <td class="p-2 border border-gray-400 font-semibold text-emerald-900">${grp.pbsName}</td>
              <td class="p-2 border border-gray-400 text-center">${mText}</td>
              <td class="p-2 border border-gray-400 text-right font-bold font-mono">${formatBDT(emp.totalAmount)}</td>
            </tr>
          `;
        });
      });
    } else {
      (items || []).forEach((it, idx) => {
        const mFormatted = formatBengaliMonth ? formatBengaliMonth(it.deduction_month) : toBn(it.deduction_month);
        letterRowsHtml += `
          <tr class="border-b border-gray-300">
            <td class="p-2 border border-gray-400 text-center font-mono">${toBn(idx + 1)}</td>
            <td class="p-2 border border-gray-400 text-center font-mono font-bold text-purple-900">${it.emp_code}</td>
            <td class="p-2 border border-gray-400 font-bold">${it.emp_name}</td>
            <td class="p-2 border border-gray-400">${it.designation}</td>
            <td class="p-2 border border-gray-400 font-mono">${it.loan_no}</td>
            <td class="p-2 border border-gray-400 text-center font-mono">${mFormatted}</td>
            <td class="p-2 border border-gray-400 text-right font-bold font-mono">${formatBDT(it.total_amount)}</td>
          </tr>
        `;
      });
    }

    container.innerHTML = `
      ${renderPbsLetterhead(ownPbs)}

      <div class="flex justify-between text-xs text-gray-700 font-mono mb-4">
        <div><strong>স্মারক নং:</strong> ${advice.memo_no}</div>
        <div><strong>তারিখ:</strong> ${toBn(advice.advice_date)} খ্রি:</div>
      </div>

      <div class="text-sm space-y-1 mb-4 text-gray-800">
        <div>বরাবর,</div>
        <div class="font-bold">${recipientTitle}</div>
        <div>${recipientPbs}।</div>
      </div>

      <div class="text-sm font-bold text-gray-900 mb-4 bg-gray-50 p-2.5 border-l-4 border-emerald-700 leading-normal">
        বিষয়: ${isCombined ? 'বিভিন্ন পবিস' : 'আপনার পবিস'} হতে গৃহ নির্মাণ ঋণ গ্রহণকারী কর্মকর্তা/কর্মচারীদের ${periodDisplay} বেতন হতে কর্তনকৃত কিস্তির অর্থ বিইএফটিএন (BEFTN) মূলে প্রেরণ প্রসঙ্গে।
      </div>

      <div class="text-sm text-gray-800 space-y-3 mb-6">
        <p class="indent-8 text-justify">
          উপযুক্ত বিষয়ের প্রেক্ষিতে জানানো যাচ্ছে যে, পল্লী বিদ্যুৎ সমিতি হতে গৃহ নির্মাণ ঋণ গ্রহণকারী নিম্নে বর্ণিত কর্মকর্তা/কর্মচারীগণ বর্তমানে অত্র সমিতিতে কর্মরত থাকায়, তাহাদের বিগত <strong>${periodDisplay}</strong> এর বেতন হতে কর্তনকৃত ঋণের কিস্তির সর্বমোট <strong>${formatBDT(advice.total_amount)} (${advice.amount_in_words})</strong> ${bodyTransferText}
        </p>
      </div>

      <div class="mb-6">
        <div class="text-xs font-bold text-gray-700 mb-2">সংযুক্তি: কর্মকর্তা/কর্মচারীদের কিস্তি কর্তন সংক্রান্ত বিস্তারিত বিবরণী:</div>
        <table class="w-full text-xs border border-gray-400 border-collapse">
          <thead>
            <tr class="bg-gray-100 text-gray-800 border-b border-gray-400 font-semibold">
              <th class="p-2 border border-gray-400 text-center w-10">ক্র: নং</th>
              <th class="p-2 border border-gray-400 text-center">পে আইডি</th>
              <th class="p-2 border border-gray-400">কর্মকর্তা/কর্মচারীর নাম</th>
              <th class="p-2 border border-gray-400">পদবী ও বিভাগ</th>
              <th class="p-2 border border-gray-400">${isCombined ? 'সংশ্লিষ্ট পবিস' : 'ঋণ হিসাব নং'}</th>
              <th class="p-2 border border-gray-400 text-center">কিস্তির মাস</th>
              <th class="p-2 border border-gray-400 text-right">কর্তনকৃত কিস্তি</th>
            </tr>
          </thead>
          <tbody>
            ${letterRowsHtml}
            <tr class="bg-gray-50 font-bold border-t-2 border-gray-400">
              <td colspan="6" class="p-2 border border-gray-400 text-right">সর্বমোট প্রেরিত অর্থ:</td>
              <td class="p-2 border border-gray-400 text-right text-emerald-800 font-mono">${formatBDT(advice.total_amount)}</td>
            </tr>
          </tbody>
        </table>
        <p class="text-xs font-semibold text-gray-800 mt-2">কথায়: ${advice.amount_in_words}</p>
      </div>

      <div class="signature-box grid grid-cols-2 gap-16 pt-16 text-center text-xs text-gray-800">
        <div>
          <div class="border-t border-gray-800 pt-1 font-bold">${ownPbs.agm_finance_name}</div>
          <div>${PBS_AGM_FINANCE_TITLE}</div>
        </div>
        <div>
          <div class="border-t border-gray-800 pt-1 font-bold">${ownPbs.gm_name}</div>
          <div>${PBS_GENERAL_MANAGER_TITLE}</div>
        </div>
      </div>
    `;
  } else {
    // Bank Advice to Samity's Bank Manager (Official BEFTN Advice Format matching PBS Standard exactly)
    const bankGroups = (groupedByPbs && groupedByPbs.length > 0)
      ? groupedByPbs
      : [{
          pbsName: advice.target_pbs_name,
          bankName: advice.target_bank_name || 'ব্যাংক তথ্য নেই',
          bankBranch: advice.target_bank_branch || '',
          accountNo: advice.target_account_no || 'হিসাব নং নেই',
          routingNo: advice.target_routing_no || 'তথ্য নেই',
          pbsTotal: advice.total_amount,
          employees: (state.selectedDocumentAdvice.employeeSummary && state.selectedDocumentAdvice.employeeSummary.length > 0)
            ? state.selectedDocumentAdvice.employeeSummary.map(es => ({
                empCode: es.empCode,
                empName: es.empName,
                designation: es.designation,
                months: es.months,
                totalAmount: es.totalAmount
              }))
            : (items || []).map(it => ({
                empCode: it.emp_code,
                empName: it.emp_name,
                designation: it.designation,
                months: [it.deduction_month],
                totalAmount: it.total_amount
              }))
        }];

    const totalAmount = advice.total_amount;
    const inWords = advice.amount_in_words;
    const bnCalendarDate = toBengaliCalendarDate(advice.advice_date);

    // Build Table Rows matching the official format precisely
    let tableRowsHtml = '';
    let serialCounter = 1;

    bankGroups.forEach(grp => {
      const empList = grp.employees || [];
      const rowCount = empList.length || 1;

      empList.forEach((emp, empIdx) => {
        const isFirstInGroup = empIdx === 0;
        const mFormatted = formatMonthsList(emp.months);

        tableRowsHtml += `
          <tr class="border-b border-black text-center">
            <td class="p-1.5 border border-black font-mono text-xs">${toBn(serialCounter++)}</td>
            <td class="p-1.5 border border-black text-left font-bold text-black text-xs">${emp.empName}</td>
            <td class="p-1.5 border border-black font-mono font-bold text-black text-xs">${emp.empCode}</td>
            <td class="p-1.5 border border-black text-left text-xs text-black">${emp.designation}</td>
            <td class="p-1.5 border border-black text-xs font-semibold text-black leading-tight">${mFormatted}</td>
            <td class="p-1.5 border border-black text-right font-bold text-xs text-black font-mono whitespace-nowrap">${formatBDT(emp.totalAmount)}</td>
            ${isFirstInGroup ? `
              <td rowspan="${rowCount}" class="p-2 border border-black font-bold text-xs text-black align-middle bg-white">
                ${grp.pbsName}
              </td>
              <td rowspan="${rowCount}" class="p-2 border border-black text-xs text-black align-middle bg-white">
                ${grp.bankName}${grp.bankBranch ? `<br><span class="text-[11px] text-gray-700">(${grp.bankBranch})</span>` : ''}
              </td>
              <td rowspan="${rowCount}" class="p-2 border border-black font-mono font-bold text-xs text-black align-middle bg-white tracking-wider whitespace-nowrap">
                ${grp.accountNo}
              </td>
              <td rowspan="${rowCount}" class="p-2 border border-black font-mono font-bold text-xs text-black align-middle bg-white whitespace-nowrap">
                ${grp.routingNo || '-'}
              </td>
              <td rowspan="${rowCount}" class="p-2 border border-black text-right font-mono font-black text-sm text-black align-middle bg-white whitespace-nowrap">
                ${formatBDT(grp.pbsTotal)}
              </td>
            ` : ''}
          </tr>
        `;
      });
    });

    container.innerHTML = `
      <div class="bank-advice-sheet w-full text-black font-sans leading-normal">
        <!-- 1. OFFICIAL PBS LETTERHEAD -->
        ${renderPbsLetterhead(ownPbs)}

        <!-- 2. MEMO NUMBER & BILINGUAL DATE (বাংলা ও খ্রিস্টাব্দ তারিখ) -->
        <div class="flex justify-between items-start text-xs text-black font-mono mb-4 pt-1">
          <div class="font-bold flex items-baseline">
            <span>স্মারক নং- </span>
            <span class="ml-1 text-sm text-black font-semibold">${advice.memo_no}</span>
          </div>
          <div class="text-right leading-tight">
            <div class="font-serif">তারিখ: <span class="border-b border-dotted border-black inline-block min-w-[70px] text-center">${bnCalendarDate}</span></div>
            <div class="mt-0.5 font-mono"><strong>${toBn(advice.advice_date)}</strong> খ্রি:</div>
          </div>
        </div>

        <!-- 3. ADDRESSEE (ব্যাংক ব্যবস্থাপক) -->
        <div class="text-xs space-y-0.5 mb-4 text-black leading-snug">
          <div class="font-bold">ব্যবস্থাপক</div>
          <div>${ownPbs.bank_name}</div>
          <div>${ownPbs.bank_branch || 'গাজীপুর কর্পোরেট শাখা'}</div>
          <div>${ownPbs.address || 'গাজীপুর'}।</div>
        </div>

        <!-- 4. SUBJECT LINE (Exact Official PBS Formulation) -->
        <div class="text-xs font-bold text-black mb-3 pb-1 border-b border-black inline-block leading-normal">
          বিষয়: জমি ক্রয়/গৃহ-নির্মাণ ঋণের কিস্তির অর্থ বিইএফটিএন/আরটিজিএস/অনলাইন ব্যাংকিং এর মাধ্যমে স্থানান্তর প্রসঙ্গে।
        </div>

        <!-- 5. MAIN FORMAL BODY TEXT -->
        <div class="text-xs text-black space-y-2 mb-4 leading-relaxed text-justify">
          <p class="indent-8">
            উপযুক্ত বিষয়ের প্রেক্ষিতে জানানো যাচ্ছে যে, অত্র সমিতির চলতি হিসাব নং- <strong>${advice.from_account_no}</strong> হতে <strong>${formatBDT(advice.total_amount)} (${inWords})</strong> ডেবিট করত: অত্র সমিতির নিম্নবর্ণিত নামের পার্শ্বে বর্ণিত হিসাবে স্থানান্তর করার জন্য অনুরোধ করা হলো।
          </p>
        </div>

        <!-- 6. 11-COLUMN OFFICIAL SCHEDULE TABLE -->
        <div class="overflow-x-auto mb-4">
          <table class="w-full text-xs border border-black border-collapse">
            <thead>
              <tr class="bg-gray-100 text-black font-bold border-b border-black text-center">
                <th class="p-1 border border-black w-7">ক্র: নং</th>
                <th class="p-1.5 border border-black min-w-[120px]">নাম</th>
                <th class="p-1 border border-black w-14">আইডি</th>
                <th class="p-1.5 border border-black min-w-[110px]">পদবী</th>
                <th class="p-1 border border-black min-w-[80px]">কিস্তির মাস</th>
                <th class="p-1.5 border border-black text-right min-w-[70px]">টাকা</th>
                <th class="p-1.5 border border-black min-w-[120px]">পবিসের নাম</th>
                <th class="p-1.5 border border-black min-w-[120px]">ব্যাংক ও শাখার নাম</th>
                <th class="p-1.5 border border-black min-w-[100px]">হিসাব নম্বর</th>
                <th class="p-1.5 border border-black min-w-[80px]">রাউটিং নম্বর</th>
                <th class="p-1.5 border border-black text-right min-w-[90px]">স্থানান্তরকৃত টাকার পরিমাণ</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
              <tr class="bg-gray-50 font-bold border-t-2 border-black text-black">
                <td colspan="5" class="p-1.5 border border-black text-right font-bold">সর্বমোট:</td>
                <td class="p-1.5 border border-black text-right font-mono font-bold whitespace-nowrap">${formatBDT(totalAmount)}</td>
                <td colspan="4" class="p-1.5 border border-black text-left font-normal italic">কথায়: <strong>${inWords}</strong></td>
                <td class="p-1.5 border border-black text-right font-mono font-black text-xs whitespace-nowrap">${formatBDT(totalAmount)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 7. OFFICIAL 2-SIGNATORY BLOCK (AGM Finance & GM) -->
        <div class="signature-box grid grid-cols-2 gap-20 pt-16 mt-8 text-center text-xs text-black">
          <div>
            <div class="border-t border-black pt-1 font-bold text-black">${ownPbs.agm_finance_name}</div>
            <div class="text-[11px] text-gray-800">${PBS_AGM_FINANCE_TITLE}</div>
          </div>
          <div>
            <div class="border-t border-black pt-1 font-bold text-black">${ownPbs.gm_name}</div>
            <div class="text-[11px] text-gray-800">${PBS_GENERAL_MANAGER_TITLE}</div>
          </div>
        </div>
      </div>
    `;
  }
}

// 8. LEDGERS & CONTROL SHEET
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function switchLedgerSubtab(subtab) {
  const glBtn = document.getElementById('subtabBtnGl14320');
  const csBtn = document.getElementById('subtabBtnControlSheet');
  const ownBtn = document.getElementById('subtabBtnOwn');
  const otherBtn = document.getElementById('subtabBtnOther');

  const glContent = document.getElementById('subtabContentGl14320');
  const csContent = document.getElementById('subtabContentControlSheet');
  const ownContent = document.getElementById('subtabContentOwn');
  const otherContent = document.getElementById('subtabContentOther');

  state.activeLedgerSubtab = subtab || 'general_ledger_14320';

  const ledgerButtons = [glBtn, csBtn, ownBtn, otherBtn].filter(Boolean);
  ledgerButtons.forEach(button => button.classList.remove('is-active'));

  if (glContent) glContent.classList.add('hidden');
  if (csContent) csContent.classList.add('hidden');
  if (ownContent) ownContent.classList.add('hidden');
  if (otherContent) otherContent.classList.add('hidden');

  if (subtab === 'general_ledger_14320') {
    if (glBtn) glBtn.classList.add('is-active');
    if (glContent) glContent.classList.remove('hidden');
    loadHouseLoanLedger14320();
  } else if (subtab === 'control_sheet') {
    if (csBtn) csBtn.classList.add('is-active');
    if (csContent) csContent.classList.remove('hidden');
    loadOwnPbsControlSheet();
  } else if (subtab === 'own') {
    if (ownBtn) ownBtn.classList.add('is-active');
    if (ownContent) ownContent.classList.remove('hidden');
    loadOwnPbsLedger();
  } else {
    if (otherBtn) otherBtn.classList.add('is-active');
    if (otherContent) otherContent.classList.remove('hidden');
    loadOtherPbsLedger24250();
  }
}

function setGl14320Preset(preset) {
  const fromInput = document.getElementById('gl14320FromDateInput');
  const toInput = document.getElementById('gl14320ToDateInput');
  if (!fromInput || !toInput) return;

  const today = new Date().toISOString().slice(0, 10);
  if (preset === 'all') {
    fromInput.value = '2024-06-01';
    toInput.value = today;
  } else if (preset === 'cur_fy') {
    fromInput.value = '2026-07-01';
    toInput.value = '2027-06-30';
  } else if (preset === 'fy_25_26') {
    fromInput.value = '2025-07-01';
    toInput.value = '2026-06-30';
  } else if (preset === 'fy_24_25') {
    fromInput.value = '2024-07-01';
    toInput.value = '2025-06-30';
  }
  loadHouseLoanLedger14320();
}

async function loadHouseLoanLedger14320() {
  const fromInput = document.getElementById('gl14320FromDateInput');
  const toInput = document.getElementById('gl14320ToDateInput');
  const empSel = document.getElementById('gl14320EmployeeSelect');
  const balTypeSel = document.getElementById('gl14320BalanceTypeSelect');
  const sheet = document.getElementById('gl14320PaperSheet');

  if (!fromInput || !toInput) return;

  const today = new Date().toISOString().slice(0, 10);
  if (!fromInput.value) fromInput.value = '2024-06-01';
  if (!toInput.value) toInput.value = today;

  const fromDate = fromInput.value;
  const toDate = toInput.value;
  const employeeId = empSel?.value || '';
  const balanceType = balTypeSel?.value || 'principal';

  // Populate employee select if empty or 1 option
  if (empSel && empSel.options.length <= 1) {
    try {
      const empRes = await API.get('/employees');
      if (empRes.success && empRes.employees) {
        const curVal = empSel.value;
        empSel.innerHTML = '<option value="">সকল কর্মচারী (AccountsCode: 143.20)</option>' +
          empRes.employees.map(e => `<option value="${e.id}">${e.emp_code} — ${e.name} (${e.designation})</option>`).join('');
        empSel.value = curVal || '';
      }
    } catch (e) {
      console.warn('Could not load employees for 143.20 dropdown:', e);
    }
  }

  if (sheet) {
    sheet.innerHTML = `
      <div class="flex flex-col items-center justify-center py-20 text-gray-400 space-y-3">
        <div class="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-sm font-medium text-gray-600">হাউজ লোন লেজার (AccountsCode: 143.20) প্রস্তুত করা হচ্ছে...</p>
      </div>
    `;
  }

  try {
    const res = await API.get('/reports/house-loan-ledger-14320', {
      fromDate,
      toDate,
      employeeId,
      balanceType
    });

    if (res.success) {
      state.gl14320Data = res;
      renderGl14320View(res);
    } else {
      if (sheet) {
        sheet.innerHTML = `
          <div class="p-6 text-center text-red-600">
            <p class="font-semibold">ডাটা লোড করতে ব্যর্থ হয়েছে</p>
            <p class="text-xs text-gray-500 mt-1">${res.message || 'পুনরায় চেষ্টা করুন।'}</p>
          </div>
        `;
      }
    }
  } catch (err) {
    console.error('loadHouseLoanLedger14320 error:', err);
    if (sheet) {
      sheet.innerHTML = `
        <div class="p-6 text-center text-red-600">
          <p class="font-semibold">সার্ভার সংযোগ ত্রুটি</p>
          <p class="text-xs text-gray-500 mt-1">${err.message}</p>
        </div>
      `;
    }
  }
}

function renderGl14320View(data) {
  const sheet = document.getElementById('gl14320PaperSheet');
  if (!sheet) return;

  const pbsName = data.pbs?.pbs_name || 'পল্লী বিদ্যুৎ সমিতি';
  const rows = data.rows || [];
  const totals = data.totals || { totalDebit: 0, totalCredit: 0, closingBalance: 0 };
  const emp = data.employee;

  let rowsHtml = '';
  if (rows.length === 0) {
    rowsHtml = `
      <tr>
        <td colspan="5" class="py-8 text-center text-gray-500 text-xs border border-blue-300">
          নির্বাচিত সময়সীমার মধ্যে কোনো লেনদেন পাওয়া যায়নি
        </td>
      </tr>
    `;
  } else {
    rowsHtml = rows.map((r) => {
      const isOpening = r.isOpening;
      const rowBg = isOpening ? 'bg-blue-50/40 font-semibold' : 'hover:bg-blue-50/20';
      return `
        <tr class="gl14320-ledger-row ${isOpening ? 'gl14320-opening-row' : ''} ${rowBg}">
          <td class="py-1.5 px-3 border border-blue-400 text-center font-mono text-xs text-gray-800">${escapeHtml(r.dateFormatted)}</td>
          <td class="py-1.5 px-3 border border-blue-400 text-left text-xs ${isOpening ? 'font-bold text-blue-900' : 'text-gray-900'}">${escapeHtml(r.particulars)}</td>
          <td class="py-1.5 px-3 border border-blue-400 text-right font-mono text-xs text-gray-900">${formatCsNum(r.debit)}</td>
          <td class="py-1.5 px-3 border border-blue-400 text-right font-mono text-xs text-gray-900">${formatCsNum(r.credit)}</td>
          <td class="py-1.5 px-3 border border-blue-400 text-right font-mono text-xs font-semibold text-gray-900">${formatCsNum(r.balance)}</td>
        </tr>
      `;
    }).join('');
  }

  const agmName = data.pbs?.agm_finance_name || 'মোঃ আরিফুল ইসলাম';
  const gmName = data.pbs?.gm_name || 'মোল্লা মোঃ আবুল কালাম আজাদ';

  sheet.innerHTML = `
    <div class="space-y-6">
      <!-- Sheet Header (Centered matching legacy screenshot media_1792501347179.png) -->
      <div class="text-center pb-2">
        <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 uppercase">${escapeHtml(pbsName)}</h1>
        <h2 class="text-base sm:text-lg font-bold text-gray-800 mt-0.5">House Loan Ledger</h2>
        <div class="text-xs sm:text-sm font-semibold text-gray-700 mt-0.5 font-mono">AccountsCode:143.20</div>
        ${emp ? `<div class="text-xs text-emerald-800 font-bold mt-1 bg-emerald-50 inline-block px-3 py-0.5 rounded border border-emerald-200">কর্মচারী: ${escapeHtml(emp.emp_code)} — ${escapeHtml(emp.name)} (${escapeHtml(emp.designation)})</div>` : ''}
      </div>

      <!-- General Ledger Table (Exact Blue borders matching legacy screenshot) -->
      <div class="overflow-x-auto flex justify-center">
        <table class="gl14320-ledger-table w-full max-w-3xl border-collapse border-2 border-blue-500 text-left text-xs bg-white">
          <thead>
            <tr class="bg-gray-100/80 border-b-2 border-blue-500 text-gray-900 font-bold">
              <th class="py-2 px-3 text-center border border-blue-400 w-24">Date</th>
              <th class="py-2 px-3 text-left border border-blue-400">particulars</th>
              <th class="py-2 px-3 text-right border border-blue-400 w-36">Debit</th>
              <th class="py-2 px-3 text-right border border-blue-400 w-36">Credit</th>
              <th class="py-2 px-3 text-right border border-blue-400 w-40">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr class="bg-gray-50 font-bold border-t-2 border-blue-500 text-xs">
              <td class="py-2 px-3 border border-blue-400"></td>
              <td class="py-2 px-3 border border-blue-400"></td>
              <td class="py-2 px-3 text-right border border-blue-500 font-mono text-sm text-gray-900 bg-blue-50/50">${formatCsNum(totals.totalDebit)}</td>
              <td class="py-2 px-3 text-right border border-blue-500 font-mono text-sm text-gray-900 bg-blue-50/50">${formatCsNum(totals.totalCredit)}</td>
              <td class="py-2 px-3 text-right border border-blue-500 font-mono text-sm text-gray-900 bg-blue-50/50 underline decoration-double">${formatCsNum(totals.closingBalance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Signatories Block (Official PBS 2-officer signature) -->
      <div class="pt-20 pb-4 flex justify-between items-end text-xs text-gray-800 signature-box max-w-3xl mx-auto">
        <div class="text-center w-60 space-y-1">
          <div class="border-t border-gray-600 pt-1 font-bold text-sm text-gray-900">${escapeHtml(agmName)}</div>
          <div class="text-gray-700 font-semibold">${PBS_AGM_FINANCE_TITLE}</div>
          <div class="text-[11px] text-gray-500">${escapeHtml(pbsName)}</div>
        </div>

        <div class="text-center w-60 space-y-1">
          <div class="border-t border-gray-600 pt-1 font-bold text-sm text-gray-900">${escapeHtml(gmName)}</div>
          <div class="text-gray-700 font-semibold">${PBS_GENERAL_MANAGER_TITLE}</div>
          <div class="text-[11px] text-gray-500">${escapeHtml(pbsName)}</div>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

function printGl14320Document() {
  const data = state.gl14320Data;
  if (!data || !data.rows) {
    showToast('প্রিন্ট করার জন্য লেজার ডাটা প্রস্তুত নেই।', 'warning');
    return;
  }

  const pbsName = data.pbs?.pbs_name || 'পল্লী বিদ্যুৎ সমিতি';
  const rows = data.rows || [];
  const totals = data.totals || { totalDebit: 0, totalCredit: 0, closingBalance: 0 };
  const agmName = data.pbs?.agm_finance_name || 'মোঃ আরিফুল ইসলাম';
  const gmName = data.pbs?.gm_name || 'মোল্লা মোঃ আবুল কালাম আজাদ';
  const emp = data.employee;

  let printFrame = document.getElementById('gl14320PrintFrame');
  if (printFrame) {
    printFrame.remove();
  }

  printFrame = document.createElement('iframe');
  printFrame.id = 'gl14320PrintFrame';
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  printFrame.style.border = '0';
  printFrame.style.visibility = 'hidden';
  document.body.appendChild(printFrame);

  const doc = printFrame.contentWindow.document;
  doc.open();

  const rowsTr = rows.map((r) => `
    <tr class="${r.isOpening ? 'opening-row' : ''}">
      <td style="text-align:center; padding: 5px 6px; border: 1px solid #2563eb; font-family: monospace;">${escapeHtml(r.dateFormatted)}</td>
      <td style="padding: 5px 8px; border: 1px solid #2563eb; ${r.isOpening ? 'font-weight: bold;' : ''}">${escapeHtml(r.particulars)}</td>
      <td style="text-align:right; padding: 5px 8px; border: 1px solid #2563eb; font-family: monospace;">${formatCsNum(r.debit)}</td>
      <td style="text-align:right; padding: 5px 8px; border: 1px solid #2563eb; font-family: monospace;">${formatCsNum(r.credit)}</td>
      <td style="text-align:right; padding: 5px 8px; border: 1px solid #2563eb; font-family: monospace; font-weight: bold;">${formatCsNum(r.balance)}</td>
    </tr>
  `).join('');

  doc.write(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <title>House Loan Ledger - AccountsCode: 143.20</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 15mm 20mm;
        }
        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #000;
          background: #fff;
          font-size: 11pt;
        }
        .header {
          text-align: center;
          margin-bottom: 20px;
        }
        .header h1 {
          font-size: 18pt;
          font-weight: bold;
          margin: 0 0 4px 0;
          text-transform: uppercase;
        }
        .header h2 {
          font-size: 13pt;
          font-weight: bold;
          margin: 0 0 4px 0;
        }
        .header .code-line {
          font-size: 11pt;
          font-weight: bold;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 25px;
          font-size: 10pt;
          border: 2px solid #2563eb;
        }
        th {
          border: 1px solid #2563eb;
          padding: 6px 8px;
          background-color: #f1f5f9;
          font-weight: bold;
          font-size: 9.5pt;
        }
        td {
          border: 1px solid #2563eb;
        }
        tbody tr:nth-child(even) {
          background-color: #eff6ff;
        }
        tbody tr:nth-child(odd) {
          background-color: #ffffff;
        }
        tbody tr.opening-row {
          background-color: #dbeafe;
          font-weight: bold;
        }
        .totals td {
          font-weight: bold;
          border-top: 2px solid #2563eb;
          background-color: #f8fafc;
        }
        .signatures {
          margin-top: 60px;
          display: flex;
          justify-content: space-between;
          page-break-inside: avoid;
        }
        .sig-block {
          width: 250px;
          text-align: center;
        }
        .sig-line {
          border-top: 1px solid #000;
          padding-top: 4px;
          font-weight: bold;
          font-size: 10pt;
        }
        .sig-title {
          font-size: 9pt;
          color: #333;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${escapeHtml(pbsName)}</h1>
        <h2>House Loan Ledger</h2>
        <div class="code-line">AccountsCode:143.20</div>
        ${emp ? `<div style="font-size: 10pt; margin-top: 4px; font-weight: bold;">Employee: ${escapeHtml(emp.emp_code)} - ${escapeHtml(emp.name)} (${escapeHtml(emp.designation)})</div>` : ''}
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 85px; text-align: center;">Date</th>
            <th style="text-align: left;">particulars</th>
            <th style="width: 125px; text-align: right;">Debit</th>
            <th style="width: 125px; text-align: right;">Credit</th>
            <th style="width: 135px; text-align: right;">Balance</th>
          </tr>
        </thead>
        <tbody>
          ${rowsTr}
        </tbody>
        <tfoot>
          <tr class="totals">
            <td></td>
            <td></td>
            <td style="text-align: right; padding: 6px 8px; font-family: monospace; font-size: 10pt;">${formatCsNum(totals.totalDebit)}</td>
            <td style="text-align: right; padding: 6px 8px; font-family: monospace; font-size: 10pt;">${formatCsNum(totals.totalCredit)}</td>
            <td style="text-align: right; padding: 6px 8px; font-family: monospace; font-size: 10pt; text-decoration: underline double;">${formatCsNum(totals.closingBalance)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="signatures">
        <div class="sig-block">
          <div class="sig-line">${escapeHtml(agmName)}</div>
          <div class="sig-title">${PBS_AGM_FINANCE_TITLE}</div>
        </div>
        <div class="sig-block">
          <div class="sig-line">${escapeHtml(gmName)}</div>
          <div class="sig-title">${PBS_GENERAL_MANAGER_TITLE}</div>
        </div>
      </div>
    </body>
    </html>
  `);

  doc.close();

  setTimeout(() => {
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();
  }, 250);
}

function exportGl14320Excel() {
  const fromInput = document.getElementById('gl14320FromDateInput');
  const toInput = document.getElementById('gl14320ToDateInput');
  const empSel = document.getElementById('gl14320EmployeeSelect');
  const balTypeSel = document.getElementById('gl14320BalanceTypeSelect');

  const fromDate = fromInput?.value || '2024-06-01';
  const toDate = toInput?.value || new Date().toISOString().slice(0, 10);
  const employeeId = empSel?.value || '';
  const balanceType = balTypeSel?.value || 'principal';

  const token = typeof API !== 'undefined' && API.getToken ? (API.getToken() || '') : '';
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const empParam = employeeId ? `&employeeId=${encodeURIComponent(employeeId)}` : '';
  const balParam = `&balanceType=${encodeURIComponent(balanceType)}`;

  const url = `/api/reports/export/excel?reportType=house_loan_ledger_14320&fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}${empParam}${balParam}${tokenParam}`;
  window.open(url, '_blank');
}

// ----------------- OTHER PBS HOUSE LOAN LEDGER (AccountsCode: 242.50) -----------------

function setOtherPbs24250Preset(preset) {
  const fromInput = document.getElementById('otherPbs24250FromDate');
  const toInput = document.getElementById('otherPbs24250ToDate');
  if (!fromInput || !toInput) return;

  const today = new Date().toISOString().slice(0, 10);
  if (preset === 'all') {
    fromInput.value = '2024-06-01';
    toInput.value = today;
  } else if (preset === 'cur_fy') {
    fromInput.value = '2026-07-01';
    toInput.value = '2027-06-30';
  } else if (preset === 'fy_25_26') {
    fromInput.value = '2025-07-01';
    toInput.value = '2026-06-30';
  } else if (preset === 'fy_24_25') {
    fromInput.value = '2024-07-01';
    toInput.value = '2025-06-30';
  }
  loadOtherPbsLedger24250();
}

async function loadOtherPbsLedger24250() {
  const fromInput = document.getElementById('otherPbs24250FromDate');
  const toInput = document.getElementById('otherPbs24250ToDate');
  const pbsSel = document.getElementById('otherPbs24250Select');
  const sheet = document.getElementById('otherPbs24250PaperSheet');

  if (!fromInput || !toInput) return;

  const today = new Date().toISOString().slice(0, 10);
  if (!fromInput.value) fromInput.value = '2024-06-01';
  if (!toInput.value) toInput.value = today;

  const fromDate = fromInput.value;
  const toDate = toInput.value;
  const otherPbsId = pbsSel?.value || '';

  if (sheet) {
    sheet.innerHTML = `
      <div class="flex flex-col items-center justify-center py-20 text-gray-400 space-y-3">
        <div class="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-sm font-medium text-gray-600">অন্য পবিসের লেজার (AccountsCode: 242.50) প্রস্তুত করা হচ্ছে...</p>
      </div>
    `;
  }

  try {
    const res = await API.get('/reports/other-pbs-ledger-24250', {
      fromDate,
      toDate,
      otherPbsId
    });

    if (res.success) {
      state.otherPbs24250Data = res;

      // Populate PBS select if empty or 1 option
      if (pbsSel && pbsSel.options.length <= 1 && res.otherPbsList) {
        const curVal = pbsSel.value;
        pbsSel.innerHTML = '<option value="">সকল পবিস (AccountsCode: 242.50)</option>' +
          res.otherPbsList.map(p => `<option value="${p.id}">${p.pbs_name} (${p.short_name || p.pbs_code || ''})</option>`).join('');
        pbsSel.value = curVal || '';
      }

      renderOtherPbs24250View(res);
    } else {
      if (sheet) {
        sheet.innerHTML = `
          <div class="p-6 text-center text-red-600">
            <p class="font-semibold">ডাটা লোড করতে ব্যর্থ হয়েছে</p>
            <p class="text-xs text-gray-500 mt-1">${res.message || 'পুনরায় চেষ্টা করুন।'}</p>
          </div>
        `;
      }
    }
  } catch (err) {
    console.error('loadOtherPbsLedger24250 error:', err);
    if (sheet) {
      sheet.innerHTML = `
        <div class="p-6 text-center text-red-600">
          <p class="font-semibold">সার্ভার সংযোগ ত্রুটি</p>
          <p class="text-xs text-gray-500 mt-1">${err.message}</p>
        </div>
      `;
    }
  }
}

function renderOtherPbs24250View(data) {
  const sheet = document.getElementById('otherPbs24250PaperSheet');
  if (!sheet) return;

  const pbsName = data.pbs?.pbs_name || 'পল্লী বিদ্যুৎ সমিতি';
  const rows = data.rows || [];
  const totals = data.totals || { totalDebit: 0, totalCredit: 0, closingBalance: 0, balanceDisplay: 0, balanceNature: 'Credit' };
  const selPbs = data.selectedOtherPbs;

  let rowsHtml = '';
  if (rows.length === 0) {
    rowsHtml = `
      <tr>
        <td colspan="5" class="py-8 text-center text-gray-500 text-xs border border-blue-300">
          নির্বাচিত সময়সীমার মধ্যে কোনো লেনদেন পাওয়া যায়নি
        </td>
      </tr>
    `;
  } else {
    rowsHtml = rows.map((r) => {
      const isOpening = r.isOpening;
      const rowBg = isOpening ? 'bg-purple-50/40 font-semibold' : 'hover:bg-blue-50/20';
      return `
        <tr class="${rowBg}">
          <td class="py-1.5 px-3 border border-blue-400 text-center font-mono text-xs text-gray-800">${escapeHtml(r.dateFormatted)}</td>
          <td class="py-1.5 px-3 border border-blue-400 text-left text-xs ${isOpening ? 'font-bold text-purple-900' : 'text-gray-900'}">${escapeHtml(r.particulars)}</td>
          <td class="py-1.5 px-3 border border-blue-400 text-right font-mono text-xs text-gray-900">${formatCsNum(r.debit)}</td>
          <td class="py-1.5 px-3 border border-blue-400 text-right font-mono text-xs text-gray-900">${formatCsNum(r.credit)}</td>
          <td class="py-1.5 px-3 border border-blue-400 text-right font-mono text-xs font-semibold text-gray-900">${formatCsNum(r.balance)}</td>
        </tr>
      `;
    }).join('');
  }

  const agmName = data.pbs?.agm_finance_name || 'মোঃ আরিফুল ইসলাম';
  const gmName = data.pbs?.gm_name || 'মোল্লা মোঃ আবুল কালাম আজাদ';

  sheet.innerHTML = `
    <div class="space-y-6">
      <!-- Sheet Top Bar matching media_1792503645827.png -->
      <div class="flex items-start justify-between border-b border-gray-200 pb-3">
        <!-- Top Left Legacy ID -->
        <div class="text-[11px] font-mono font-bold text-gray-500 tracking-wider">
          Ledger550_242_50
        </div>

        <!-- Center Header -->
        <div class="text-center flex-1 pr-4">
          <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">${escapeHtml(pbsName)}</h1>
          <h2 class="text-base sm:text-lg font-bold text-gray-800 mt-0.5">House Loan Ledger</h2>
          <div class="text-xs sm:text-sm font-semibold text-gray-700 mt-0.5 font-mono">AccountsCode:242.50</div>
          ${selPbs ? `<div class="text-xs text-purple-800 font-bold mt-1 bg-purple-50 inline-block px-3 py-0.5 rounded border border-purple-200">সংশ্লিষ্ট পবিস: ${escapeHtml(selPbs.pbs_name)}</div>` : '<div class="text-xs text-gray-500 mt-0.5">সকল অন্যান্য পল্লী বিদ্যুৎ সমিতি</div>'}
        </div>

        <!-- Top Right Yellow Highlight Box matching screenshot -->
        <div class="border border-black bg-[#ffff99] px-3.5 py-1 text-center shadow-sm min-w-[130px]">
          <div class="text-[11px] font-bold text-black border-b border-black pb-0.5">Balance</div>
          <div class="text-xs font-bold text-black pt-0.5 font-mono">${formatCsNum(totals.balanceDisplay)} ${totals.balanceNature}</div>
        </div>
      </div>

      <!-- General Ledger Table (Exact Blue borders matching legacy screenshot media_1792503645827.png) -->
      <div class="overflow-x-auto flex justify-center">
        <table class="w-full max-w-3xl border-collapse border-2 border-blue-500 text-left text-xs bg-white">
          <thead>
            <tr class="bg-gray-100/80 border-b-2 border-blue-500 text-gray-900 font-bold">
              <th class="py-2 px-3 text-center border border-blue-400 w-24">Date</th>
              <th class="py-2 px-3 text-left border border-blue-400">particulars</th>
              <th class="py-2 px-3 text-right border border-blue-400 w-36">Debit</th>
              <th class="py-2 px-3 text-right border border-blue-400 w-36">Credit</th>
              <th class="py-2 px-3 text-right border border-blue-400 w-40">Balance</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr class="bg-gray-50 font-bold border-t-2 border-blue-500 text-xs">
              <td class="py-2 px-3 border border-blue-400"></td>
              <td class="py-2 px-3 border border-blue-400 text-left font-bold">Total</td>
              <td class="py-2 px-3 text-right border border-blue-500 font-mono text-sm text-gray-900 bg-blue-50/50">${formatCsNum(totals.totalDebit)}</td>
              <td class="py-2 px-3 text-right border border-blue-500 font-mono text-sm text-gray-900 bg-blue-50/50">${formatCsNum(totals.totalCredit)}</td>
              <td class="py-2 px-3 text-right border border-blue-500 font-mono text-sm text-gray-900 bg-blue-50/50 underline decoration-double">${formatCsNum(totals.closingBalance)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Signatories Block (Official PBS 2-officer signature) -->
      <div class="pt-20 pb-4 flex justify-between items-end text-xs text-gray-800 signature-box max-w-3xl mx-auto">
        <div class="text-center w-60 space-y-1">
          <div class="border-t border-gray-600 pt-1 font-bold text-sm text-gray-900">${escapeHtml(agmName)}</div>
          <div class="text-gray-700 font-semibold">${PBS_AGM_FINANCE_TITLE}</div>
          <div class="text-[11px] text-gray-500">${escapeHtml(pbsName)}</div>
        </div>

        <div class="text-center w-60 space-y-1">
          <div class="border-t border-gray-600 pt-1 font-bold text-sm text-gray-900">${escapeHtml(gmName)}</div>
          <div class="text-gray-700 font-semibold">${PBS_GENERAL_MANAGER_TITLE}</div>
          <div class="text-[11px] text-gray-500">${escapeHtml(pbsName)}</div>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

function printOtherPbs24250Document() {
  const data = state.otherPbs24250Data;
  if (!data || !data.rows) {
    showToast('প্রিন্ট করার জন্য লেজার ডাটা প্রস্তুত নেই।', 'warning');
    return;
  }

  const pbsName = data.pbs?.pbs_name || 'পল্লী বিদ্যুৎ সমিতি';
  const rows = data.rows || [];
  const totals = data.totals || { totalDebit: 0, totalCredit: 0, closingBalance: 0, balanceDisplay: 0, balanceNature: 'Credit' };
  const agmName = data.pbs?.agm_finance_name || 'মোঃ আরিফুল ইসলাম';
  const gmName = data.pbs?.gm_name || 'মোল্লা মোঃ আবুল কালাম আজাদ';
  const selPbs = data.selectedOtherPbs;

  let printFrame = document.getElementById('otherPbs24250PrintFrame');
  if (printFrame) {
    printFrame.remove();
  }

  printFrame = document.createElement('iframe');
  printFrame.id = 'otherPbs24250PrintFrame';
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  printFrame.style.border = '0';
  printFrame.style.visibility = 'hidden';
  document.body.appendChild(printFrame);

  const doc = printFrame.contentWindow.document;
  doc.open();

  const rowsTr = rows.map((r) => `
    <tr>
      <td style="text-align:center; padding: 5px 6px; border: 1px solid #2563eb; font-family: monospace;">${escapeHtml(r.dateFormatted)}</td>
      <td style="padding: 5px 8px; border: 1px solid #2563eb; ${r.isOpening ? 'font-weight: bold;' : ''}">${escapeHtml(r.particulars)}</td>
      <td style="text-align:right; padding: 5px 8px; border: 1px solid #2563eb; font-family: monospace;">${formatCsNum(r.debit)}</td>
      <td style="text-align:right; padding: 5px 8px; border: 1px solid #2563eb; font-family: monospace;">${formatCsNum(r.credit)}</td>
      <td style="text-align:right; padding: 5px 8px; border: 1px solid #2563eb; font-family: monospace; font-weight: bold;">${formatCsNum(r.balance)}</td>
    </tr>
  `).join('');

  doc.write(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <title>House Loan Ledger - AccountsCode: 242.50</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 15mm 20mm;
        }
        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #000;
          background: #fff;
          font-size: 11pt;
        }
        .top-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          margin-bottom: 20px;
        }
        .legacy-code {
          font-family: monospace;
          font-size: 9pt;
          font-weight: bold;
          color: #555;
        }
        .header {
          text-align: center;
          flex: 1;
        }
        .header h1 {
          font-size: 18pt;
          font-weight: bold;
          margin: 0 0 4px 0;
        }
        .header h2 {
          font-size: 13pt;
          font-weight: bold;
          margin: 0 0 4px 0;
        }
        .header .code-line {
          font-size: 11pt;
          font-weight: bold;
        }
        .yellow-box {
          border: 1px solid #000;
          background-color: #ffff99;
          padding: 4px 12px;
          text-align: center;
          min-width: 130px;
        }
        .yellow-box-title {
          font-size: 9pt;
          font-weight: bold;
          border-bottom: 1px solid #000;
          padding-bottom: 2px;
        }
        .yellow-box-val {
          font-size: 10pt;
          font-weight: bold;
          padding-top: 2px;
          font-family: monospace;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 25px;
          font-size: 10pt;
          border: 2px solid #2563eb;
        }
        th {
          border: 1px solid #2563eb;
          padding: 6px 8px;
          background-color: #f1f5f9;
          font-weight: bold;
          font-size: 9.5pt;
        }
        td {
          border: 1px solid #2563eb;
        }
        .totals td {
          font-weight: bold;
          border-top: 2px solid #2563eb;
          background-color: #f8fafc;
        }
        .signatures {
          margin-top: 60px;
          display: flex;
          justify-content: space-between;
          page-break-inside: avoid;
        }
        .sig-block {
          width: 250px;
          text-align: center;
        }
        .sig-line {
          border-top: 1px solid #000;
          padding-top: 4px;
          font-weight: bold;
          font-size: 10pt;
        }
        .sig-title {
          font-size: 9pt;
          color: #333;
        }
      </style>
    </head>
    <body>
      <div class="top-row">
        <div class="legacy-code">Ledger550_242_50</div>
        <div class="header">
          <h1>${escapeHtml(pbsName)}</h1>
          <h2>House Loan Ledger</h2>
          <div class="code-line">AccountsCode:242.50</div>
          ${selPbs ? `<div style="font-size: 10pt; margin-top: 4px; font-weight: bold;">সংশ্লিষ্ট পবিস: ${escapeHtml(selPbs.pbs_name)}</div>` : ''}
        </div>
        <div class="yellow-box">
          <div class="yellow-box-title">Balance</div>
          <div class="yellow-box-val">${formatCsNum(totals.balanceDisplay)} ${totals.balanceNature}</div>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 85px; text-align: center;">Date</th>
            <th style="text-align: left;">particulars</th>
            <th style="width: 125px; text-align: right;">Debit</th>
            <th style="width: 125px; text-align: right;">Credit</th>
            <th style="width: 135px; text-align: right;">Balance</th>
          </tr>
        </thead>
        <tbody>
          ${rowsTr}
        </tbody>
        <tfoot>
          <tr class="totals">
            <td></td>
            <td style="font-weight: bold;">Total</td>
            <td style="text-align: right; padding: 6px 8px; font-family: monospace; font-size: 10pt;">${formatCsNum(totals.totalDebit)}</td>
            <td style="text-align: right; padding: 6px 8px; font-family: monospace; font-size: 10pt;">${formatCsNum(totals.totalCredit)}</td>
            <td style="text-align: right; padding: 6px 8px; font-family: monospace; font-size: 10pt; text-decoration: underline double;">${formatCsNum(totals.closingBalance)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="signatures">
        <div class="sig-block">
          <div class="sig-line">${escapeHtml(agmName)}</div>
          <div class="sig-title">${PBS_AGM_FINANCE_TITLE}</div>
        </div>
        <div class="sig-block">
          <div class="sig-line">${escapeHtml(gmName)}</div>
          <div class="sig-title">${PBS_GENERAL_MANAGER_TITLE}</div>
        </div>
      </div>
    </body>
    </html>
  `);

  doc.close();

  setTimeout(() => {
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();
  }, 250);
}

function exportOtherPbs24250Excel() {
  const fromInput = document.getElementById('otherPbs24250FromDate');
  const toInput = document.getElementById('otherPbs24250ToDate');
  const pbsSel = document.getElementById('otherPbs24250Select');

  const fromDate = fromInput?.value || '2024-06-01';
  const toDate = toInput?.value || new Date().toISOString().slice(0, 10);
  const otherPbsId = pbsSel?.value || '';

  const token = typeof API !== 'undefined' && API.getToken ? (API.getToken() || '') : '';
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  const pbsParam = otherPbsId ? `&otherPbsId=${encodeURIComponent(otherPbsId)}` : '';

  const url = `/api/reports/export/excel?reportType=other_pbs_ledger_24250&fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}${pbsParam}${tokenParam}`;
  window.open(url, '_blank');
}

function setCsPreset(preset) {
  const asOnInput = document.getElementById('csAsOnDateInput');
  const compInput = document.getElementById('csCompDateInput');
  if (!asOnInput || !compInput) return;

  const today = new Date().toISOString().slice(0, 10);
  if (preset === 'cur_fy') {
    asOnInput.value = '2026-06-30';
    compInput.value = '2025-06-30';
  } else if (preset === 'prev_fy') {
    asOnInput.value = '2025-06-30';
    compInput.value = '2024-06-30';
  } else if (preset === 'today') {
    asOnInput.value = today;
    const d = new Date(today);
    d.setFullYear(d.getFullYear() - 1);
    compInput.value = d.toISOString().slice(0, 10);
  }
  loadOwnPbsControlSheet();
}

async function loadOwnPbsControlSheet() {
  const asOnInput = document.getElementById('csAsOnDateInput');
  const compInput = document.getElementById('csCompDateInput');
  const balTypeSelect = document.getElementById('csBalanceTypeSelect');
  const sheet = document.getElementById('csPaperSheet');

  if (!asOnInput || !compInput) return;

  // Initialize defaults if empty
  if (!asOnInput.value) {
    asOnInput.value = '2026-06-30';
  }
  if (!compInput.value) {
    compInput.value = '2025-06-30';
  }

  const asOnDate = asOnInput.value;
  const comparativeDate = compInput.value;
  const balanceType = balTypeSelect?.value || 'total';

  if (sheet) {
    sheet.innerHTML = `
      <div class="flex flex-col items-center justify-center py-20 text-gray-400 space-y-3">
        <div class="w-8 h-8 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-sm font-medium text-gray-600">তুলনামূলক ঋণ স্থিতি কন্ট্রোল শিট প্রস্তুত করা হচ্ছে...</p>
      </div>
    `;
  }

  try {
    const res = await API.get('/reports/own-control-sheet', {
      asOnDate,
      comparativeDate,
      balanceType
    });

    if (res.success) {
      state.controlSheetData = res;
      renderControlSheetView(res);
    } else {
      if (sheet) {
        sheet.innerHTML = `
          <div class="p-6 text-center text-red-600">
            <p class="font-semibold">ডাটা লোড করতে ব্যর্থ হয়েছে</p>
            <p class="text-xs text-gray-500 mt-1">${res.message || 'অনুগ্রহ করে পুনরায় চেষ্টা করুন।'}</p>
          </div>
        `;
      }
    }
  } catch (err) {
    console.error('loadOwnPbsControlSheet error:', err);
    if (sheet) {
      sheet.innerHTML = `
        <div class="p-6 text-center text-red-600">
          <p class="font-semibold">সার্ভার সংযোগ ত্রুটি</p>
          <p class="text-xs text-gray-500 mt-1">${err.message}</p>
        </div>
      `;
    }
  }
}

function formatCsNum(val) {
  if (val === null || val === undefined || isNaN(val)) return '0.00';
  return Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderControlSheetView(data) {
  const sheet = document.getElementById('csPaperSheet');
  if (!sheet) return;

  const pbsName = data.pbs?.pbs_name || 'পল্লী বিদ্যুৎ সমিতি';
  const asOnFormatted = data.asOnDateFormatted || data.asOnDate;
  const compFormatted = data.comparativeDateFormatted || data.comparativeDate;
  const isPrinOnly = data.balanceType === 'principal';

  const rows = data.rows || [];
  const totals = data.totals || { totalAsOn: 0, totalComp: 0, totalDiff: 0, totalEmployees: 0 };

  let rowsHtml = '';
  if (rows.length === 0) {
    rowsHtml = `
      <tr>
        <td colspan="7" class="py-8 text-center text-gray-500 text-xs">
          কোনো ঋণ হিসাব পাওয়া যায়নি
        </td>
      </tr>
    `;
  } else {
    rowsHtml = rows.map((r, idx) => {
      const diffVal = r.diff || 0;
      const diffFormatted = (diffVal > 0 ? '+' : '') + formatCsNum(diffVal);
      const diffColorClass = diffVal < 0 ? 'text-emerald-700' : (diffVal > 0 ? 'text-blue-700' : 'text-gray-500');

      return `
        <tr class="hover:bg-gray-50 border-b border-gray-300">
          <td class="py-2 px-2 text-center text-xs text-gray-600 font-mono">${idx + 1}</td>
          <td class="py-2 px-2 text-center text-xs font-semibold font-mono text-gray-800">${escapeHtml(r.emp_id)}</td>
          <td class="py-2 px-3 text-left text-xs font-medium text-gray-900">${escapeHtml(r.name)}</td>
          <td class="py-2 px-3 text-left text-xs text-gray-600">${escapeHtml(r.designation || '-')}</td>
          <td class="py-2 px-3 text-right text-xs font-mono font-semibold text-gray-900">${formatCsNum(r.valAsOn)}</td>
          <td class="py-2 px-3 text-right text-xs font-mono text-gray-700">${formatCsNum(r.valComp)}</td>
          <td class="py-2 px-3 text-right text-xs font-mono font-medium ${diffColorClass} no-print">${diffFormatted}</td>
        </tr>
      `;
    }).join('');
  }

  const agmName = data.pbs?.agm_finance_name || 'মোঃ আরিফুল ইসলাম';
  const gmName = data.pbs?.gm_name || 'মোল্লা মোঃ আবুল কালাম আজাদ';

  sheet.innerHTML = `
    <div class="space-y-6">
      <!-- Sheet Header (Centered matching legacy format) -->
      <div class="text-center pb-2">
        <h1 class="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 uppercase">${escapeHtml(pbsName)}</h1>
        <h2 class="text-base sm:text-lg font-bold text-gray-800 mt-1">House Loan Balance</h2>
        <div class="text-xs sm:text-sm font-semibold text-gray-700 mt-1">
          <span>As on the Date: </span>
          <span class="font-bold underline decoration-1 underline-offset-2">${asOnFormatted}</span>
        </div>
        ${isPrinOnly ? '<div class="text-[11px] text-emerald-800 font-medium italic mt-0.5">[ কেবল আসল স্থিতি / Principal Balance Only ]</div>' : ''}
      </div>

      <!-- Control Sheet Table -->
      <div class="overflow-x-auto">
        <table class="w-full border-collapse border border-gray-400 text-left">
          <thead>
            <tr class="bg-gray-100 border-b-2 border-gray-400 text-gray-800 font-bold text-xs uppercase tracking-wider">
              <th class="py-2.5 px-2 text-center border border-gray-400 w-12">SL</th>
              <th class="py-2.5 px-2 text-center border border-gray-400 w-24">EM_ID</th>
              <th class="py-2.5 px-3 text-left border border-gray-400">Name</th>
              <th class="py-2.5 px-3 text-left border border-gray-400">Designation</th>
              <th class="py-2.5 px-3 text-right border border-gray-400 w-36 bg-gray-200/70">${asOnFormatted}</th>
              <th class="py-2.5 px-3 text-right border border-gray-400 w-36">${compFormatted}</th>
              <th class="py-2.5 px-3 text-right border border-gray-400 w-28 no-print">Difference</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
          <tfoot>
            <tr class="bg-gray-100 font-bold border-t-2 border-b-4 border-double border-gray-900 text-xs">
              <td colspan="4" class="py-2.5 px-4 text-right border border-gray-400 uppercase tracking-wide">Grand Total:</td>
              <td class="py-2.5 px-3 text-right font-mono text-sm text-gray-900 border border-gray-400 bg-gray-200/80 underline decoration-double">${formatCsNum(totals.totalAsOn)}</td>
              <td class="py-2.5 px-3 text-right font-mono text-sm text-gray-800 border border-gray-400 underline decoration-double">${formatCsNum(totals.totalComp)}</td>
              <td class="py-2.5 px-3 text-right font-mono text-xs border border-gray-400 no-print ${totals.totalDiff < 0 ? 'text-emerald-700' : 'text-blue-700'}">${(totals.totalDiff > 0 ? '+' : '') + formatCsNum(totals.totalDiff)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Signatories Block (2 official PBS signatories: AGM Finance & GM) -->
      <div class="pt-16 pb-4 flex justify-between items-end text-xs text-gray-800 signature-box">
        <div class="text-center w-64 space-y-1">
          <div class="border-t border-gray-600 pt-1 font-bold text-sm text-gray-900">${escapeHtml(agmName)}</div>
          <div class="text-gray-700 font-semibold">${PBS_AGM_FINANCE_TITLE}</div>
          <div class="text-[11px] text-gray-500">${escapeHtml(pbsName)}</div>
        </div>

        <div class="text-center w-64 space-y-1">
          <div class="border-t border-gray-600 pt-1 font-bold text-sm text-gray-900">${escapeHtml(gmName)}</div>
          <div class="text-gray-700 font-semibold">${PBS_GENERAL_MANAGER_TITLE}</div>
          <div class="text-[11px] text-gray-500">${escapeHtml(pbsName)}</div>
        </div>
      </div>
    </div>
  `;

  if (window.lucide) lucide.createIcons();
}

function printControlSheetDocument() {
  const data = state.controlSheetData;
  if (!data || !data.rows) {
    showToast('প্রিন্ট করার জন্য কন্ট্রোল শিটের ডাটা প্রস্তুত নেই।', 'warning');
    return;
  }

  const pbsName = data.pbs?.pbs_name || 'পল্লী বিদ্যুৎ সমিতি';
  const asOnFormatted = data.asOnDateFormatted || data.asOnDate;
  const compFormatted = data.comparativeDateFormatted || data.comparativeDate;
  const isPrinOnly = data.balanceType === 'principal';
  const rows = data.rows || [];
  const totals = data.totals || { totalAsOn: 0, totalComp: 0, totalDiff: 0 };
  const agmName = data.pbs?.agm_finance_name || 'মোঃ আরিফুল ইসলাম';
  const gmName = data.pbs?.gm_name || 'মোল্লা মোঃ আবুল কালাম আজাদ';

  let printFrame = document.getElementById('csPrintFrame');
  if (printFrame) {
    printFrame.remove();
  }

  printFrame = document.createElement('iframe');
  printFrame.id = 'csPrintFrame';
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  printFrame.style.border = '0';
  printFrame.style.visibility = 'hidden';
  document.body.appendChild(printFrame);

  const doc = printFrame.contentWindow.document;
  doc.open();

  const rowsTr = rows.map((r, i) => `
    <tr>
      <td style="text-align:center; padding: 5px 6px; border: 1px solid #000; font-family: monospace;">${i + 1}</td>
      <td style="text-align:center; padding: 5px 6px; border: 1px solid #000; font-weight: bold; font-family: monospace;">${escapeHtml(r.emp_id)}</td>
      <td style="padding: 5px 8px; border: 1px solid #000;">${escapeHtml(r.name)}</td>
      <td style="padding: 5px 8px; border: 1px solid #000;">${escapeHtml(r.designation || '-')}</td>
      <td style="text-align:right; padding: 5px 8px; border: 1px solid #000; font-family: monospace; font-weight: bold;">${formatCsNum(r.valAsOn)}</td>
      <td style="text-align:right; padding: 5px 8px; border: 1px solid #000; font-family: monospace;">${formatCsNum(r.valComp)}</td>
    </tr>
  `).join('');

  doc.write(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <title>House Loan Balance - ${escapeHtml(pbsName)}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 12mm 15mm 15mm 15mm;
        }
        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #000;
          background: #fff;
          font-size: 11pt;
        }
        .header {
          text-align: center;
          margin-bottom: 18px;
        }
        .header h1 {
          font-size: 18pt;
          font-weight: bold;
          margin: 0 0 4px 0;
          text-transform: uppercase;
        }
        .header h2 {
          font-size: 13pt;
          font-weight: bold;
          margin: 0 0 4px 0;
        }
        .header .date-line {
          font-size: 11pt;
          font-weight: bold;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
          font-size: 10pt;
        }
        th {
          border: 1px solid #000;
          padding: 6px 8px;
          background-color: #f2f2f2;
          font-weight: bold;
          text-transform: uppercase;
          font-size: 9.5pt;
        }
        td {
          border: 1px solid #000;
        }
        .grand-total td {
          font-weight: bold;
          border-top: 2px solid #000;
          border-bottom: 3px double #000;
          background-color: #f9f9f9;
        }
        .signatures {
          margin-top: 55px;
          display: flex;
          justify-content: space-between;
          page-break-inside: avoid;
        }
        .sig-block {
          width: 250px;
          text-align: center;
        }
        .sig-line {
          border-top: 1px solid #000;
          padding-top: 4px;
          font-weight: bold;
          font-size: 10pt;
        }
        .sig-title {
          font-size: 9pt;
          color: #333;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${escapeHtml(pbsName)}</h1>
        <h2>House Loan Balance</h2>
        <div class="date-line">As on the Date: ${asOnFormatted}</div>
        ${isPrinOnly ? '<div style="font-size: 9pt; font-style: italic; margin-top: 2px;">[ কেবল আসল স্থিতি / Principal Balance Only ]</div>' : ''}
      </div>

      <table>
        <thead>
          <tr>
            <th style="width: 35px; text-align: center;">SL</th>
            <th style="width: 70px; text-align: center;">EM_ID</th>
            <th style="text-align: left;">Name</th>
            <th style="text-align: left;">Designation</th>
            <th style="width: 130px; text-align: right;">${asOnFormatted}</th>
            <th style="width: 130px; text-align: right;">${compFormatted}</th>
          </tr>
        </thead>
        <tbody>
          ${rowsTr}
        </tbody>
        <tfoot>
          <tr class="grand-total">
            <td colspan="4" style="text-align: right; padding: 6px 10px;">Grand Total:</td>
            <td style="text-align: right; padding: 6px 8px; font-family: monospace; font-size: 10.5pt;">${formatCsNum(totals.totalAsOn)}</td>
            <td style="text-align: right; padding: 6px 8px; font-family: monospace; font-size: 10.5pt;">${formatCsNum(totals.totalComp)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="signatures">
        <div class="sig-block">
          <div class="sig-line">${escapeHtml(agmName)}</div>
          <div class="sig-title">${PBS_AGM_FINANCE_TITLE}</div>
        </div>
        <div class="sig-block">
          <div class="sig-line">${escapeHtml(gmName)}</div>
          <div class="sig-title">${PBS_GENERAL_MANAGER_TITLE}</div>
        </div>
      </div>
    </body>
    </html>
  `);

  doc.close();

  setTimeout(() => {
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();
  }, 250);
}

function exportControlSheetExcel() {
  const asOnInput = document.getElementById('csAsOnDateInput');
  const compInput = document.getElementById('csCompDateInput');
  const balTypeSelect = document.getElementById('csBalanceTypeSelect');

  const asOnDate = asOnInput?.value || '2026-06-30';
  const comparativeDate = compInput?.value || '2025-06-30';
  const balanceType = balTypeSelect?.value || 'total';

  const token = typeof API !== 'undefined' && API.getToken ? (API.getToken() || '') : '';
  const url = `/api/reports/export/excel?reportType=own_control_sheet&asOnDate=${encodeURIComponent(asOnDate)}&comparativeDate=${encodeURIComponent(comparativeDate)}&balanceType=${encodeURIComponent(balanceType)}${token ? '&token=' + encodeURIComponent(token) : ''}`;
  window.open(url, '_blank');
}

function printCurrentLedgerTab() {
  if (state.activeLedgerSubtab === 'general_ledger_14320') {
    printGl14320Document();
  } else if (state.activeLedgerSubtab === 'control_sheet') {
    printControlSheetDocument();
  } else if (state.activeLedgerSubtab === 'other') {
    printOtherPbs24250Document();
  } else {
    window.print();
  }
}

function exportCurrentLedgerTabExcel() {
  const token = typeof API !== 'undefined' && API.getToken ? (API.getToken() || '') : '';
  const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
  if (state.activeLedgerSubtab === 'general_ledger_14320') {
    exportGl14320Excel();
  } else if (state.activeLedgerSubtab === 'control_sheet') {
    exportControlSheetExcel();
  } else if (state.activeLedgerSubtab === 'other') {
    exportOtherPbs24250Excel();
  } else {
    const sel = document.getElementById('ownLedgerEmployeeSelect');
    const empId = sel?.value || '';
    window.open(`/api/reports/export/excel?reportType=own_ledger${empId ? '&employeeId=' + encodeURIComponent(empId) : ''}${tokenParam}`, '_blank');
  }
}

async function loadOwnPbsLedger(targetEmployeeId) {
  const sel = document.getElementById('ownLedgerEmployeeSelect');
  const resetBtnContainer = document.getElementById('ownLedgerResetContainer');
  let employeeId = '';
  if (targetEmployeeId !== undefined && targetEmployeeId !== null) {
    employeeId = targetEmployeeId ? String(targetEmployeeId) : '';
  } else {
    employeeId = sel?.value || '';
  }

  const container = document.getElementById('ownLedgerContent');
  if (resetBtnContainer) {
    if (employeeId) {
      resetBtnContainer.classList.remove('hidden');
    } else {
      resetBtnContainer.classList.add('hidden');
    }
  }

  try {
    // Call employee-loan-ledger report endpoint
    const res = await API.get('/reports/employee-loan-ledger', employeeId ? { employeeId } : {});
    if (!res.success) return;

    // Populate employee select dropdown if empty or has 1 option
    if (res.employees && sel && (sel.options.length <= 1 || !sel.querySelector(`option[value="${res.employees[0]?.id}"]`))) {
      const currentSelected = employeeId || sel.value;
      sel.innerHTML = '<option value="">--- সকল কর্মকর্তা/কর্মচারী সারসংক্ষেপ ---</option>' +
        res.employees.map(e => `<option value="${e.id}">${e.emp_code} — ${e.name} (${e.designation})</option>`).join('');
      sel.value = currentSelected || '';
    }

    if (employeeId && res.loanLedgers && res.loanLedgers.length > 0) {
      // Set dropdown value
      if (sel) sel.value = employeeId;

      const emp = res.employee;
      const gt = res.grandTotal;
      const hasMultiplePbs = res.pbsSummary && res.pbsSummary.length > 1;
      const hasMultipleLoans = res.loanLedgers.length > 1;

      let html = `
        <!-- Employee Header -->
        <div class="p-5 bg-gradient-to-r from-emerald-800 to-emerald-700 text-white flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div class="flex items-center space-x-2 mb-1">
              <button onclick="loadOwnPbsLedger('')" class="text-xs bg-white/20 hover:bg-white/30 text-white px-2.5 py-1 rounded-lg border border-white/30 font-semibold shadow-sm transition inline-flex items-center space-x-1 cursor-pointer">
                <span>&larr;</span>
                <span>সকল কর্মচারী তালিকায় ফিরুন</span>
              </button>
              <span class="text-xs font-semibold text-emerald-200 uppercase tracking-wider">কর্মচারীভিত্তিক সম্পূর্ণ ঋণ খতিয়ান</span>
            </div>
            <h3 class="text-xl font-bold mt-1">${emp.name} <span class="font-mono text-emerald-200 text-base">(পে আইডি: ${emp.emp_code})</span></h3>
            <p class="text-xs text-emerald-200 mt-0.5">${emp.designation} &bull; ${emp.department}</p>
          </div>
          <div class="bg-white/10 rounded-xl p-3 text-right">
            <div class="text-xs text-emerald-200">মোট ঋণ সংখ্যা: ${toBn(gt.loanCount)} টি</div>
            <div class="text-xl font-extrabold text-white mt-1">${formatBDT(gt.netBalance)}</div>
            <div class="text-xs text-emerald-200">আসল: ${formatBDT(gt.principalBalance)} | সুদ: ${formatBDT(gt.interestBalance)}</div>
          </div>
        </div>
      `;

      // PBS-wise summary cards (shown only when multiple PBS loans)
      if (hasMultiplePbs) {
        html += `
          <div class="p-4 bg-amber-50 border-b border-amber-200">
            <div class="text-xs font-bold text-amber-800 uppercase tracking-wider mb-2">★ পবিস-ওয়ারি সারসংক্ষেপ (PBS-wise Summary)</div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              ${res.pbsSummary.map(pbs => `
                <div class="bg-white rounded-lg p-3 border ${pbs.loanSourceType === 'OWN_PBS' ? 'border-emerald-200' : 'border-amber-200'} shadow-sm">
                  <div class="flex items-center justify-between mb-2">
                    <span class="font-bold text-xs ${pbs.loanSourceType === 'OWN_PBS' ? 'text-emerald-800' : 'text-amber-800'}">${pbs.pbsName}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded ${pbs.loanSourceType === 'OWN_PBS' ? 'badge-own' : 'badge-other'}">${pbs.loanSourceType === 'OWN_PBS' ? 'নিজস্ব' : 'অন্য পবিস'}</span>
                  </div>
                  <div class="space-y-0.5 text-[11px] text-gray-600">
                    <div class="flex justify-between"><span>মঞ্জুরকৃত আসল:</span><strong>${formatBDT(pbs.totalDisbursed)}</strong></div>
                    <div class="flex justify-between"><span>আসল পরিশোধ:</span><strong class="text-emerald-700">${formatBDT(pbs.totalPrincipalPaid)}</strong></div>
                    <div class="flex justify-between"><span>অবশিষ্ট আসল:</span><strong class="text-blue-800">${formatBDT(pbs.principalBalance)}</strong></div>
                    ${pbs.loanSourceType === 'OWN_PBS' ? `
                    <div class="flex justify-between"><span>ধার্যকৃত সুদ:</span><strong class="text-orange-700">${formatBDT(pbs.totalInterestProvisioned)}</strong></div>
                    <div class="flex justify-between"><span>সুদ পরিশোধ:</span><strong class="text-amber-700">${formatBDT(pbs.totalInterestPaid)}</strong></div>
                    <div class="flex justify-between"><span>অবশিষ্ট সুদ:</span><strong class="text-amber-800">${formatBDT(pbs.interestBalance)}</strong></div>
                    ` : ''}
                    <div class="flex justify-between border-t border-gray-200 pt-1 mt-1 font-bold">
                      <span>মোট অবশিষ্ট:</span><strong class="text-gray-900">${formatBDT(pbs.netBalance)}</strong>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      // Render Each loan ledger
      res.loanLedgers.forEach((ll, idx) => {
        const loan = ll.loan;
        const sub = ll.subtotal;
        const isOwn = loan.loan_source_type === 'OWN_PBS';
        const borderColor = isOwn ? 'border-emerald-400' : 'border-amber-400';
        const bgColor = isOwn ? 'bg-emerald-50' : 'bg-amber-50';
        const badgeClass = isOwn ? 'badge-own' : 'badge-other';
        const loanNo = idx + 1;

        html += `
          <!-- LOAN #${loanNo}: ${loan.loan_no} -->
          <div class="border-t-4 ${borderColor}">
            <!-- Loan Header -->
            <div class="p-4 ${bgColor} flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="text-xs font-extrabold text-gray-600 uppercase">ঋণ #${toBn(loanNo)}</span>
                  <span class="font-bold font-mono text-base ${isOwn ? 'text-emerald-900' : 'text-amber-900'}">${loan.loan_no}</span>
                  <span class="px-2 py-0.5 text-xs rounded font-semibold ${badgeClass}">${loan.origin_pbs_name}</span>
                  <span class="text-xs text-gray-700 font-bold bg-white/70 px-2 py-0.5 rounded border border-gray-300">${loan.loan_lot_name}</span>
                  <span class="px-2 py-0.5 text-[10px] rounded ${loan.status === 'ACTIVE' ? 'badge-active' : 'badge-closed'}">${loan.status === 'ACTIVE' ? 'সক্রিয়' : 'পরিশোধিত'}</span>
                </div>
                <div class="text-xs text-gray-600 mt-1">
                  মঞ্জুরি: ${loan.sanction_no || 'N/A'} | বিতরণ: ${toBn(loan.disbursement_date)} | সুদ: ${isOwn ? toBn(loan.interest_rate) + '% সরল' : 'প্রভিশন প্রযোজ্য নয়'}
                </div>
              </div>
              <div class="text-right">
                <div class="text-xs text-gray-500">মঞ্জুরকৃত আসল</div>
                <div class="font-bold text-gray-900">${formatBDT(loan.disbursed_amount)}</div>
                <div class="text-xs text-gray-500 mt-0.5">মাসিক কিস্তি: ${formatBDT(loan.monthly_installment)}</div>
              </div>
            </div>

            <!-- Ledger Table -->
            <div class="overflow-x-auto">
              <table class="w-full text-left border-collapse text-xs">
                <thead>
                  <tr class="table-header text-gray-700 font-semibold border-b">
                    <th class="p-2.5">তারিখ</th>
                    <th class="p-2.5">বিবরণ</th>
                    <th class="p-2.5">ভাউচার</th>
                    <th class="p-2.5 text-right bg-blue-50/50">ডেবিট আসল</th>
                    <th class="p-2.5 text-right bg-emerald-50/50">ক্রেডিট আসল</th>
                    ${isOwn ? `
                    <th class="p-2.5 text-right bg-orange-50/50">ডেবিট সুদ</th>
                    <th class="p-2.5 text-right bg-amber-50/50">ক্রেডিট সুদ</th>
                    ` : ''}
                    <th class="p-2.5 text-right text-blue-900 font-bold">আসল স্থিতি</th>
                    ${isOwn ? `<th class="p-2.5 text-right text-amber-900 font-bold">সুদ স্থিতি</th>` : ''}
                    <th class="p-2.5 text-right text-emerald-950 font-extrabold">মোট স্থিতি</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 font-mono">
                  ${ll.entries.map(e => {
                    const isPrior = e.type && e.type.startsWith('PRIOR_');
                    const rowBg = e.type === 'DISBURSEMENT' ? 'bg-blue-50/40' : e.type === 'INTEREST_PROVISION' ? 'bg-orange-50/30' : isPrior ? 'bg-purple-50/40' : '';
                    return `
                    <tr class="hover:bg-gray-50 ${rowBg}">
                      <td class="p-2.5 font-medium">${toBn(e.date)}</td>
                      <td class="p-2.5 font-sans font-medium text-gray-800">
                        ${isPrior ? '<span class="inline-block px-1.5 py-0.5 rounded text-[10px] bg-purple-100 text-purple-800 font-bold mr-1">প্রারম্ভিক</span>' : ''}
                        ${e.description}
                      </td>
                      <td class="p-2.5 text-gray-500 text-[11px] font-mono">${e.voucher}</td>
                      <td class="p-2.5 text-right text-blue-800">${e.debitPrincipal > 0 ? formatBDT(e.debitPrincipal) : '—'}</td>
                      <td class="p-2.5 text-right text-emerald-700">${e.creditPrincipal > 0 ? formatBDT(e.creditPrincipal) : '—'}</td>
                      ${isOwn ? `
                      <td class="p-2.5 text-right text-orange-800">${e.debitInterest > 0 ? formatBDT(e.debitInterest) : '—'}</td>
                      <td class="p-2.5 text-right text-amber-700">${e.creditInterest > 0 ? formatBDT(e.creditInterest) : '—'}</td>
                      ` : ''}
                      <td class="p-2.5 text-right font-bold text-blue-900">${formatBDT(e.principalBalance)}</td>
                      ${isOwn ? `<td class="p-2.5 text-right font-bold text-amber-900">${formatBDT(e.interestBalance)}</td>` : ''}
                      <td class="p-2.5 text-right font-bold text-emerald-800 bg-emerald-50/30">${formatBDT(e.netBalance)}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>

            <!-- Loan Subtotal Row -->
            <div class="p-3 bg-gray-100 border-t-2 border-dashed border-gray-300 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
              <div class="font-extrabold text-gray-700 col-span-2 sm:col-span-4 lg:col-span-1 flex items-center">
                ★ লট / ঋণ সাব-টোটাল (${loan.loan_lot_name})
              </div>
              <div class="text-center">
                <div class="text-gray-500">মঞ্জুরকৃত আসল</div>
                <div class="font-bold text-gray-900">${formatBDT(sub.totalDisbursed)}</div>
              </div>
              <div class="text-center">
                <div class="text-gray-500">আসল পরিশোধ</div>
                <div class="font-bold text-emerald-700">${formatBDT(sub.totalPrincipalPaid)}</div>
              </div>
              <div class="text-center">
                <div class="text-gray-500">অবশিষ্ট আসল</div>
                <div class="font-bold text-blue-800">${formatBDT(sub.principalBalance)}</div>
              </div>
              ${isOwn ? `
              <div class="text-center">
                <div class="text-gray-500">ধার্যকৃত সুদ</div>
                <div class="font-bold text-orange-700">${formatBDT(sub.totalInterestProvisioned)}</div>
              </div>
              <div class="text-center">
                <div class="text-gray-500">সুদ আদায়</div>
                <div class="font-bold text-amber-700">${formatBDT(sub.totalInterestPaid)}</div>
              </div>
              <div class="text-center">
                <div class="text-gray-500">অবশিষ্ট সুদ</div>
                <div class="font-bold text-amber-800">${formatBDT(sub.interestBalance)}</div>
              </div>
              ` : `
              <div class="text-center col-span-3 text-gray-400 italic flex items-center justify-center text-[11px]">
                (অন্য পবিস ঋণ: সুদ প্রভিশন প্রযোজ্য নয়)
              </div>
              `}
              <div class="text-center border-l-2 border-gray-400 pl-2">
                <div class="text-gray-600 font-bold">মোট অবশিষ্ট</div>
                <div class="font-extrabold text-gray-900 text-sm">${formatBDT(sub.netBalance)}</div>
              </div>
            </div>
          </div>
        `;
      });

      // Grand Total section (shown if multiple loans)
      if (hasMultipleLoans) {
        html += `
          <!-- Grand Total -->
          <div class="p-4 bg-emerald-900 text-white">
            <div class="text-xs font-bold uppercase tracking-wider text-emerald-300 mb-3">★ সর্বমোট গ্র্যান্ড টোটাল (${toBn(gt.loanCount)} টি ঋণের সম্মিলিত স্থিতি)</div>
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
              <div class="bg-white/10 rounded-lg p-2 text-center">
                <div class="text-emerald-300 text-xs">মোট মঞ্জুরকৃত আসল</div>
                <div class="font-bold text-white">${formatBDT(gt.totalDisbursed)}</div>
              </div>
              <div class="bg-white/10 rounded-lg p-2 text-center">
                <div class="text-emerald-300 text-xs">মোট আসল পরিশোধ</div>
                <div class="font-bold text-emerald-300">${formatBDT(gt.totalPrincipalPaid)}</div>
              </div>
              <div class="bg-white/10 rounded-lg p-2 text-center">
                <div class="text-emerald-300 text-xs">মোট অবশিষ্ট আসল</div>
                <div class="font-bold text-blue-300">${formatBDT(gt.principalBalance)}</div>
              </div>
              <div class="bg-white/10 rounded-lg p-2 text-center">
                <div class="text-emerald-300 text-xs">মোট ধার্যকৃত সুদ</div>
                <div class="font-bold text-orange-300">${formatBDT(gt.totalInterestProvisioned)}</div>
              </div>
              <div class="bg-white/10 rounded-lg p-2 text-center">
                <div class="text-emerald-300 text-xs">মোট সুদ আদায়</div>
                <div class="font-bold text-amber-300">${formatBDT(gt.totalInterestPaid)}</div>
              </div>
              <div class="bg-white/20 rounded-lg p-2 text-center border-2 border-white/30">
                <div class="text-emerald-200 text-xs font-bold">সর্বমোট অবশিষ্ট</div>
                <div class="font-extrabold text-white text-lg">${formatBDT(gt.netBalance)}</div>
              </div>
            </div>
          </div>
        `;
      }

      container.innerHTML = html;
      if (window.lucide) lucide.createIcons();
    } else {
      if (sel) sel.value = '';
      // Summary table of all employees with loans
      const employees = res.employees || [];
      const totalDisb = employees.reduce((s, e) => s + (e.total_disbursed || 0), 0);
      const totalPaid = employees.reduce((s, e) => s + (e.total_principal_paid || 0), 0);
      const totalPrinBal = employees.reduce((s, e) => s + (e.principal_balance || 0), 0);
      const totalIntBal = employees.reduce((s, e) => s + (e.interest_balance || 0), 0);
      const totalNetBal = employees.reduce((s, e) => s + (e.net_balance || 0), 0);

      container.innerHTML = `
        <div class="p-4 border-b bg-emerald-50/60 flex items-center justify-between">
          <div>
            <h3 class="font-bold text-emerald-950 text-sm">সকল কর্মকর্তা/কর্মচারীর ঋণ খতিয়ান সারসংক্ষেপ</h3>
            <p class="text-xs text-emerald-700">কর্মচারীভিত্তিক মোট ঋণ সংখ্যা, গৃহীত আসল, পরিশোধ ও অবশিষ্ট স্থিতির তালিকা</p>
          </div>
          <div class="text-xs text-gray-500 font-semibold">
            মোট ঋণগ্রহীতা: <span class="font-bold text-emerald-900">${toBn(employees.length)} জন</span>
          </div>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-sm">
            <thead>
              <tr class="table-header text-gray-700 font-semibold border-b">
                <th class="p-3.5">পে আইডি</th>
                <th class="p-3.5">কর্মকর্তা/কর্মচারীর নাম ও পদবী</th>
                <th class="p-3.5 text-center">ঋণ সংখ্যা</th>
                <th class="p-3.5 text-right">মোট মঞ্জুরকৃত আসল</th>
                <th class="p-3.5 text-right">আদায়কৃত আসল</th>
                <th class="p-3.5 text-right">অবশিষ্ট আসল</th>
                <th class="p-3.5 text-right">ধার্য সুদ স্থিতি</th>
                <th class="p-3.5 text-right font-bold">মোট অবশিষ্ট</th>
                <th class="p-3.5 text-center">সম্পূর্ণ লেজার</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              ${employees.map(e => `
                <tr class="hover:bg-gray-50">
                  <td class="p-3.5 font-bold font-mono text-emerald-800">${e.emp_code}</td>
                  <td class="p-3.5">
                    <div class="font-bold text-gray-900">${e.name}</div>
                    <div class="text-xs text-gray-500">${e.designation} &bull; ${e.department}</div>
                  </td>
                  <td class="p-3.5 text-center">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${e.loan_count > 1 ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}">
                      ${toBn(e.loan_count)} টি
                    </span>
                    ${e.loan_count > 1 ? '<div class="text-[10px] text-amber-600 font-semibold">একাধিক লট/পবিস</div>' : ''}
                  </td>
                  <td class="p-3.5 text-right font-medium">${formatBDT(e.total_disbursed)}</td>
                  <td class="p-3.5 text-right text-emerald-700 font-medium">${formatBDT(e.total_principal_paid)}</td>
                  <td class="p-3.5 text-right font-bold text-blue-800">${formatBDT(e.principal_balance)}</td>
                  <td class="p-3.5 text-right font-bold text-amber-700">${formatBDT(e.interest_balance)}</td>
                  <td class="p-3.5 text-right font-bold text-emerald-900">${formatBDT(e.net_balance)}</td>
                  <td class="p-3.5 text-center">
                    <button onclick="loadOwnPbsLedger(${e.id})" class="text-xs text-emerald-700 hover:text-emerald-900 font-bold bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-lg border border-emerald-200 transition shadow-sm inline-flex items-center space-x-1 cursor-pointer">
                      <span>খতিয়ান দেখুন</span>
                      <span>&rarr;</span>
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr class="bg-gray-100 font-bold border-t-2 border-gray-300 text-gray-900">
                <td colspan="3" class="p-3.5 text-right">সর্বমোট:</td>
                <td class="p-3.5 text-right">${formatBDT(totalDisb)}</td>
                <td class="p-3.5 text-right text-emerald-700">${formatBDT(totalPaid)}</td>
                <td class="p-3.5 text-right text-blue-900">${formatBDT(totalPrinBal)}</td>
                <td class="p-3.5 text-right text-amber-800">${formatBDT(totalIntBal)}</td>
                <td class="p-3.5 text-right text-emerald-950 font-extrabold">${formatBDT(totalNetBal)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;
    }
  } catch (err) {
    console.error('Own PBS ledger error:', err);
  }
}

async function loadOtherPbsLedger() {
  const container = document.getElementById('otherLedgerContent');
  try {
    const res = await API.get('/reports/other-pbs-ledger');
    if (!res.success) return;

    container.innerHTML = `
      <div class="p-5 border-b bg-purple-50/50">
        <h3 class="font-bold text-purple-950 text-base">অন্যান্য পবিস হতে গৃহীত ঋণের কিস্তি কর্তন ও প্রেরণ খতিয়ান (Inter-PBS Ledger)</h3>
        <p class="text-xs text-purple-800 mt-0.5">ক্রেডিট: বেতন হতে কর্তন | ডেবিট: ব্যাংক অ্যাডভাইস মূলে সংশ্লিষ্ট পবিসে প্রেরণ</p>
      </div>

      <!-- PBS Summary Cards -->
      <div class="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 border-b bg-gray-50">
        ${(res.pbsSummary || []).map(p => `
          <div class="bg-white p-3.5 rounded-lg border border-purple-100 shadow-sm">
            <h4 class="font-bold text-xs text-purple-900">${p.pbsName}</h4>
            <div class="text-[11px] text-gray-600 mt-1 flex justify-between">
              <span>মোট কর্তন:</span> <strong>${formatBDT(p.totalDeducted)}</strong>
            </div>
            <div class="text-[11px] text-emerald-700 flex justify-between">
              <span>প্রেরিত অর্থ:</span> <strong>${formatBDT(p.totalRemitted)}</strong>
            </div>
            <div class="text-[11px] text-purple-800 font-bold flex justify-between border-t pt-1 mt-1">
              <span>অনিষ্পন্ন রেমিট্যান্স:</span> <strong>${formatBDT(p.pendingRemittance)}</strong>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="table-header text-gray-700 font-semibold border-b">
              <th class="p-3">কর্তনের মাস</th>
              <th class="p-3">উৎস পবিস</th>
              <th class="p-3">কর্মকর্তা/কর্মচারী</th>
              <th class="p-3">ঋণ নং</th>
              <th class="p-3 text-right bg-purple-50/50">ক্রেডিট (বেতন কর্তন)</th>
              <th class="p-3 text-right bg-emerald-50/50">ডেবিট (পবিসে প্রেরণ)</th>
              <th class="p-3 text-center">রেমিট্যান্স স্থিতি</th>
              <th class="p-3">ব্যাংক অ্যাডভাইস নং</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 font-mono">
            ${(res.records || []).map(r => `
              <tr class="hover:bg-gray-50">
                <td class="p-3">${toBn(r.deduction_month)}</td>
                <td class="p-3 font-sans font-bold text-purple-900">${r.origin_pbs_name}</td>
                <td class="p-3 font-sans font-medium text-gray-800">${r.emp_name} (${r.emp_code})</td>
                <td class="p-3">${r.loan_no}</td>
                <td class="p-3 text-right font-bold text-purple-900">${formatBDT(r.credit_deduction)}</td>
                <td class="p-3 text-right font-bold text-emerald-800">${r.debit_remittance > 0 ? formatBDT(r.debit_remittance) : '-'}</td>
                <td class="p-3 text-center">
                  <span class="px-2 py-0.5 rounded text-[10px] font-bold ${r.remittance_status === 'REMITTED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                    ${r.remittance_status === 'REMITTED' ? 'পরিশোধিত' : 'অনিষ্পন্ন'}
                  </span>
                </td>
                <td class="p-3 text-gray-600">${r.advice_no || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error('Other PBS ledger error:', err);
  }
}

// 8b. EMPLOYEE-BASED LOAN LEDGER (New tab with loan-wise + PBS-wise subtotals)
async function loadEmployeeLoanLedgerTab() {
  // Populate employee dropdown
  const sel = document.getElementById('empLedgerEmployeeSelect');
  if (sel && sel.options.length <= 1) {
    try {
      const res = await API.get('/reports/employee-loan-ledger');
      if (res.success && res.employees) {
        sel.innerHTML = '<option value="">--- কর্মচারী নির্বাচন করুন ---</option>';
        res.employees.forEach(emp => {
          sel.innerHTML += `<option value="${emp.id}">${emp.emp_code} — ${emp.name} (${emp.designation})</option>`;
        });
      }
    } catch (err) {
      console.error('Employee list load error:', err);
    }
  }
}

async function loadEmployeeLoanLedger() {
  const employeeId = document.getElementById('empLedgerEmployeeSelect')?.value;
  const container = document.getElementById('empLoanLedgerContent');

  if (!employeeId) {
    container.innerHTML = `<div class="p-10 text-center text-gray-400"><p class="text-sm">একজন কর্মকর্তা/কর্মচারী নির্বাচন করুন</p></div>`;
    return;
  }

  container.innerHTML = `<div class="p-10 text-center text-gray-400 animate-pulse"><p class="text-sm">লোড হচ্ছে...</p></div>`;

  try {
    const res = await API.get('/reports/employee-loan-ledger', { employeeId });
    if (!res.success) { container.innerHTML = `<div class="p-6 text-red-600">ডেটা আনা যায়নি।</div>`; return; }

    if (!res.loanLedgers || res.loanLedgers.length === 0) {
      container.innerHTML = `<div class="p-10 text-center text-gray-400"><p class="text-sm">এই কর্মচারীর কোনো ঋণ তথ্য পাওয়া যায়নি।</p></div>`;
      return;
    }

    const emp = res.employee;
    const gt = res.grandTotal;
    const hasMultiplePbs = res.pbsSummary && res.pbsSummary.length > 1;
    const hasMultipleLoans = res.loanLedgers.length > 1;

    let html = `
      <!-- Employee Header -->
      <div class="employee-ledger-header p-5 bg-gradient-to-r from-emerald-800 to-emerald-700 text-white">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div class="text-xs font-semibold text-emerald-200 uppercase tracking-wider mb-1">কর্মচারীভিত্তিক সম্পূর্ণ ঋণ খতিয়ান</div>
            <h3 class="text-xl font-bold">${emp.name} <span class="font-mono text-emerald-200 text-base">(পে আইডি: ${emp.emp_code})</span></h3>
            <p class="text-xs text-emerald-200 mt-0.5">${emp.designation} • ${emp.department}</p>
          </div>
          <div class="bg-white/10 rounded-xl p-3 text-right">
            <div class="text-xs text-emerald-200">মোট ঋণ সংখ্যা: ${toBn(gt.loanCount)} টি</div>
            <div class="text-xl font-extrabold text-white mt-1">${formatBDT(gt.netBalance)}</div>
            <div class="text-xs text-emerald-200">আসল: ${formatBDT(gt.principalBalance)} | সুদ: ${formatBDT(gt.interestBalance)}</div>
          </div>
        </div>
      </div>
    `;

    // PBS-wise summary cards (shown only when multiple PBS loans)
    if (hasMultiplePbs) {
      html += `
        <div class="p-4 bg-amber-50 border-b border-amber-200">
          <div class="text-xs font-bold text-amber-800 uppercase tracking-wider mb-2">★ পবিস-ওয়ারি সারসংক্ষেপ (PBS-wise Summary)</div>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            ${res.pbsSummary.map(pbs => `
              <div class="bg-white rounded-lg p-3 border ${pbs.loanSourceType === 'OWN_PBS' ? 'border-emerald-200' : 'border-amber-200'} shadow-sm">
                <div class="flex items-center justify-between mb-2">
                  <span class="font-bold text-xs ${pbs.loanSourceType === 'OWN_PBS' ? 'text-emerald-800' : 'text-amber-800'}">${pbs.pbsName}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded ${pbs.loanSourceType === 'OWN_PBS' ? 'badge-own' : 'badge-other'}">${pbs.loanSourceType === 'OWN_PBS' ? 'নিজস্ব' : 'অন্য পবিস'}</span>
                </div>
                <div class="space-y-0.5 text-[11px] text-gray-600">
                  <div class="flex justify-between"><span>মঞ্জুরকৃত আসল:</span><strong>${formatBDT(pbs.totalDisbursed)}</strong></div>
                  <div class="flex justify-between"><span>আসল পরিশোধ:</span><strong class="text-emerald-700">${formatBDT(pbs.totalPrincipalPaid)}</strong></div>
                  <div class="flex justify-between"><span>অবশিষ্ট আসল:</span><strong class="text-blue-800">${formatBDT(pbs.principalBalance)}</strong></div>
                  ${pbs.loanSourceType === 'OWN_PBS' ? `
                  <div class="flex justify-between"><span>ধার্যকৃত সুদ:</span><strong class="text-orange-700">${formatBDT(pbs.totalInterestProvisioned)}</strong></div>
                  <div class="flex justify-between"><span>সুদ পরিশোধ:</span><strong class="text-amber-700">${formatBDT(pbs.totalInterestPaid)}</strong></div>
                  <div class="flex justify-between"><span>অবশিষ্ট সুদ:</span><strong class="text-amber-800">${formatBDT(pbs.interestBalance)}</strong></div>
                  ` : ''}
                  <div class="flex justify-between border-t border-gray-200 pt-1 mt-1 font-bold">
                    <span>মোট অবশিষ্ট:</span><strong class="text-gray-900">${formatBDT(pbs.netBalance)}</strong>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Each loan ledger
    res.loanLedgers.forEach((ll, idx) => {
      const loan = ll.loan;
      const sub = ll.subtotal;
      const isOwn = loan.loan_source_type === 'OWN_PBS';
      const borderColor = isOwn ? 'border-emerald-400' : 'border-amber-400';
      const bgColor = isOwn ? 'bg-emerald-50' : 'bg-amber-50';
      const badgeClass = isOwn ? 'badge-own' : 'badge-other';
      const loanNo = idx + 1;

      html += `
        <!-- LOAN #${loanNo}: ${loan.loan_no} -->
        <div class="employee-loan-section border-t-4 ${borderColor}">
          <!-- Loan Header -->
          <div class="employee-loan-heading p-4 ${bgColor} flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs font-extrabold text-gray-600 uppercase">ঋণ #${toBn(loanNo)}</span>
                <span class="font-bold font-mono text-base ${isOwn ? 'text-emerald-900' : 'text-amber-900'}">${loan.loan_no}</span>
                <span class="px-2 py-0.5 text-xs rounded font-semibold ${badgeClass}">${loan.origin_pbs_name}</span>
                <span class="text-xs text-gray-600 font-medium">${loan.loan_lot_name}</span>
                <span class="px-2 py-0.5 text-[10px] rounded ${loan.status === 'ACTIVE' ? 'badge-active' : 'badge-closed'}">${loan.status === 'ACTIVE' ? 'সক্রিয়' : 'পরিশোধিত'}</span>
              </div>
              <div class="text-xs text-gray-600 mt-1">
                মঞ্জুরি: ${loan.sanction_no || 'N/A'} | বিতরণ: ${toBn(loan.disbursement_date)} | সুদ: ${isOwn ? toBn(loan.interest_rate) + '% সরল' : 'প্রভিশন প্রযোজ্য নয়'}
              </div>
            </div>
            <div class="text-right">
              <div class="text-xs text-gray-500">মঞ্জুরকৃত আসল</div>
              <div class="font-bold text-gray-900">${formatBDT(loan.disbursed_amount)}</div>
              <div class="text-xs text-gray-500 mt-0.5">মাসিক কিস্তি: ${formatBDT(loan.monthly_installment)}</div>
            </div>
          </div>

          <!-- Ledger Table -->
          <div class="overflow-x-auto">
            <table class="employee-loan-table w-full text-left border-collapse text-xs">
              <thead>
                <tr class="table-header text-gray-700 font-semibold border-b">
                  <th class="p-2.5">তারিখ</th>
                  <th class="p-2.5">বিবরণ</th>
                  <th class="p-2.5">ভাউচার</th>
                  <th class="p-2.5 text-right bg-blue-50/50">ডেবিট আসল</th>
                  <th class="p-2.5 text-right bg-emerald-50/50">ক্রেডিট আসল</th>
                  ${isOwn ? `
                  <th class="p-2.5 text-right bg-orange-50/50">ডেবিট সুদ</th>
                  <th class="p-2.5 text-right bg-amber-50/50">ক্রেডিট সুদ</th>
                  ` : ''}
                  <th class="p-2.5 text-right text-blue-900 font-bold">আসল স্থিতি</th>
                  ${isOwn ? `<th class="p-2.5 text-right text-amber-900 font-bold">সুদ স্থিতি</th>` : ''}
                  <th class="p-2.5 text-right text-emerald-950 font-extrabold">মোট স্থিতি</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 font-mono">
                ${ll.entries.map(e => {
                  const isPrior = e.type && e.type.startsWith('PRIOR_');
                  const rowBg = e.type === 'DISBURSEMENT' ? 'bg-blue-50/40' : e.type === 'INTEREST_PROVISION' ? 'bg-orange-50/30' : isPrior ? 'bg-purple-50/40' : '';
                  return `
                  <tr class="hover:bg-gray-50 ${rowBg}">
                    <td class="p-2.5 font-medium">${toBn(e.date)}</td>
                    <td class="p-2.5 font-sans font-medium text-gray-800">
                      ${isPrior ? '<span class="inline-block px-1.5 py-0.5 rounded text-[10px] bg-purple-100 text-purple-800 font-bold mr-1">প্রারম্ভিক</span>' : ''}
                      ${e.description}
                    </td>
                    <td class="p-2.5 text-gray-500 text-[11px] font-mono">${e.voucher}</td>
                    <td class="p-2.5 text-right text-blue-800">${e.debitPrincipal > 0 ? formatBDT(e.debitPrincipal) : '—'}</td>
                    <td class="p-2.5 text-right text-emerald-700">${e.creditPrincipal > 0 ? formatBDT(e.creditPrincipal) : '—'}</td>
                    ${isOwn ? `
                    <td class="p-2.5 text-right text-orange-800">${e.debitInterest > 0 ? formatBDT(e.debitInterest) : '—'}</td>
                    <td class="p-2.5 text-right text-amber-700">${e.creditInterest > 0 ? formatBDT(e.creditInterest) : '—'}</td>
                    ` : ''}
                    <td class="p-2.5 text-right font-bold text-blue-900">${formatBDT(e.principalBalance)}</td>
                    ${isOwn ? `<td class="p-2.5 text-right font-bold text-amber-900">${formatBDT(e.interestBalance)}</td>` : ''}
                    <td class="p-2.5 text-right font-bold text-emerald-800 bg-emerald-50/30">${formatBDT(e.netBalance)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
              <tfoot>
                <tr class="employee-loan-subtotal-row">
                  <th colspan="3" class="p-2.5 text-left font-extrabold">ঋণ সাব-টোটাল</th>
                  <td class="p-2.5 text-right font-bold">${formatBDT(sub.totalDisbursed)}</td>
                  <td class="p-2.5 text-right font-bold">${formatBDT(sub.totalPrincipalPaid)}</td>
                  ${isOwn ? `
                  <td class="p-2.5 text-right font-bold">${formatBDT(sub.totalInterestProvisioned)}</td>
                  <td class="p-2.5 text-right font-bold">${formatBDT(sub.totalInterestPaid)}</td>
                  ` : ''}
                  <td class="p-2.5 text-right font-bold">${formatBDT(sub.principalBalance)}</td>
                  ${isOwn ? `<td class="p-2.5 text-right font-bold">${formatBDT(sub.interestBalance)}</td>` : ''}
                  <td class="p-2.5 text-right font-extrabold">${formatBDT(sub.netBalance)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      `;
    });

    // Grand Total section (shown only if multiple loans)
    if (hasMultipleLoans) {
      html += `
        <!-- Grand Total -->
        <div class="p-4 bg-emerald-900 text-white">
          <div class="text-xs font-bold uppercase tracking-wider text-emerald-300 mb-3">★ সর্বমোট গ্র্যান্ড টোটাল (${toBn(gt.loanCount)} টি ঋণের সম্মিলিত স্থিতি)</div>
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
            <div class="bg-white/10 rounded-lg p-2 text-center">
              <div class="text-emerald-300 text-xs">মোট মঞ্জুরকৃত আসল</div>
              <div class="font-bold text-white">${formatBDT(gt.totalDisbursed)}</div>
            </div>
            <div class="bg-white/10 rounded-lg p-2 text-center">
              <div class="text-emerald-300 text-xs">মোট আসল পরিশোধ</div>
              <div class="font-bold text-emerald-300">${formatBDT(gt.totalPrincipalPaid)}</div>
            </div>
            <div class="bg-white/10 rounded-lg p-2 text-center">
              <div class="text-emerald-300 text-xs">মোট অবশিষ্ট আসল</div>
              <div class="font-bold text-blue-300">${formatBDT(gt.principalBalance)}</div>
            </div>
            <div class="bg-white/10 rounded-lg p-2 text-center">
              <div class="text-emerald-300 text-xs">মোট ধার্যকৃত সুদ</div>
              <div class="font-bold text-orange-300">${formatBDT(gt.totalInterestProvisioned)}</div>
            </div>
            <div class="bg-white/10 rounded-lg p-2 text-center">
              <div class="text-emerald-300 text-xs">মোট সুদ আদায়</div>
              <div class="font-bold text-amber-300">${formatBDT(gt.totalInterestPaid)}</div>
            </div>
            <div class="bg-white/20 rounded-lg p-2 text-center border-2 border-white/30">
              <div class="text-emerald-200 text-xs font-bold">সর্বমোট অবশিষ্ট</div>
              <div class="font-extrabold text-white text-lg">${formatBDT(gt.netBalance)}</div>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Employee loan ledger render error:', err);
    container.innerHTML = `<div class="p-6 text-red-600">ত্রুটি: ${err.message}</div>`;
  }
}

function printEmployeeLoanLedger() {
  const employeeId = document.getElementById('empLedgerEmployeeSelect')?.value;
  const content = document.getElementById('empLoanLedgerContent');
  if (!employeeId || !content || !content.querySelector('table')) {
    showToast('প্রিন্ট করার জন্য কর্মচারীর খতিয়ান নির্বাচন করুন।', 'warning');
    return;
  }

  const printClass = 'print-employee-loan-ledger';
  const cleanup = () => document.body.classList.remove(printClass);
  window.addEventListener('afterprint', cleanup, { once: true });
  document.body.classList.add(printClass);

  try {
    window.print();
  } catch (error) {
    cleanup();
    window.removeEventListener('afterprint', cleanup);
    console.error('Employee loan ledger print error:', error);
    showToast('কর্মচারীভিত্তিক খতিয়ান প্রিন্ট করা যায়নি।', 'error');
  }
}

// 9. FISCAL YEAR COMPARATIVE STATEMENT
async function loadComparativeStatement() {
  const container = document.getElementById('comparativeStatementContainer');
  try {
    const res = await API.get('/reports/comparative-statement');
    if (!res.success || !res.statement) return;

    const { ownPbsStats, otherPbsStats } = res.statement;

    container.innerHTML = `
      <!-- Table 1: Own PBS Comparative Statement -->
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="p-4 border-b bg-emerald-50/50">
          <h3 class="font-bold text-emerald-950 text-base">১. নিজস্ব পল্লী বিদ্যুৎ সমিতির গৃহ নির্মাণ ঋণ তুলনামূলক বিবরণী</h3>
          <p class="text-xs text-emerald-800">অর্থবছর ভিত্তিক প্রারম্ভিক স্থিতি, নতুন ঋণ বিতরণ, আসল ও সুদ আদায় এবং সমাপনী স্থিতি</p>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="table-header text-gray-700 font-semibold border-b">
                <th class="p-3 font-bold text-gray-900">বিবরণ / আর্থিক খাত</th>
                ${ownPbsStats.map(s => `<th class="p-3 text-right font-bold font-mono text-emerald-900 bg-emerald-50/40">${toBn(s.fiscalYear)}</th>`).join('')}
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr class="hover:bg-gray-50">
                <td class="p-3 font-medium text-gray-800">১. প্রারম্ভিক আসল স্থিতি (Opening Principal)</td>
                ${ownPbsStats.map(s => `<td class="p-3 text-right font-mono text-gray-700">${formatBDT(s.openingPrincipal)}</td>`).join('')}
              </tr>
              <tr class="hover:bg-gray-50 bg-blue-50/20">
                <td class="p-3 font-semibold text-blue-900">২. অর্থবছরে নতুন ঋণ বিতরণ (Disbursed in FY)</td>
                ${ownPbsStats.map(s => `<td class="p-3 text-right font-mono font-bold text-blue-900">${formatBDT(s.disbursed)}</td>`).join('')}
              </tr>
              <tr class="hover:bg-gray-50 bg-emerald-50/20">
                <td class="p-3 font-semibold text-emerald-900">৩. অর্থবছরে আসল আদায় (Principal Recovered)</td>
                ${ownPbsStats.map(s => `<td class="p-3 text-right font-mono font-bold text-emerald-800">${formatBDT(s.principalRecovered)}</td>`).join('')}
              </tr>
              <tr class="hover:bg-gray-50 font-bold bg-gray-50">
                <td class="p-3 text-gray-900">৪. সমাপনী আসল স্থিতি (Closing Principal) = (১+২-৩)</td>
                ${ownPbsStats.map(s => `<td class="p-3 text-right font-mono text-blue-950">${formatBDT(s.closingPrincipal)}</td>`).join('')}
              </tr>
              <tr class="hover:bg-gray-50">
                <td class="p-3 font-medium text-gray-800">৫. প্রারম্ভিক সুদ স্থিতি (Opening Interest)</td>
                ${ownPbsStats.map(s => `<td class="p-3 text-right font-mono text-gray-700">${formatBDT(s.openingInterest)}</td>`).join('')}
              </tr>
              <tr class="hover:bg-gray-50 bg-amber-50/20">
                <td class="p-3 font-semibold text-amber-900">৬. অর্থবছরে ধার্যকৃত সুদ (Interest Provisioned)</td>
                ${ownPbsStats.map(s => `<td class="p-3 text-right font-mono font-bold text-amber-800">${formatBDT(s.interestProvisioned)}</td>`).join('')}
              </tr>
              <tr class="hover:bg-gray-50 bg-orange-50/20">
                <td class="p-3 font-semibold text-orange-900">৭. অর্থবছরে সুদ আদায় (Interest Recovered)</td>
                ${ownPbsStats.map(s => `<td class="p-3 text-right font-mono font-bold text-orange-800">${formatBDT(s.interestRecovered)}</td>`).join('')}
              </tr>
              <tr class="hover:bg-gray-50 font-bold bg-gray-50">
                <td class="p-3 text-gray-900">৮. সমাপনী সুদ স্থিতি (Closing Interest) = (৫+৬-৭)</td>
                ${ownPbsStats.map(s => `<td class="p-3 text-right font-mono text-amber-950">${formatBDT(s.closingInterest)}</td>`).join('')}
              </tr>
              <tr class="bg-emerald-100/70 font-extrabold text-sm border-t-2 border-emerald-700">
                <td class="p-3.5 text-emerald-950">সর্বমোট সমাপনী স্থিতি (Total Closing Balance) = (৪+৮)</td>
                ${ownPbsStats.map(s => `<td class="p-3.5 text-right font-mono text-emerald-950">${formatBDT(s.totalClosingBalance)}</td>`).join('')}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Table 2: Other PBS Comparative Statement -->
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div class="p-4 border-b bg-purple-50/50">
          <h3 class="font-bold text-purple-950 text-base">২. অন্যান্য পবিসের ঋণ কিস্তি কর্তন ও রেমিট্যান্স তুলনামূলক বিবরণী</h3>
          <p class="text-xs text-purple-800">কর্মকর্তা-কর্মচারীদের বেতন হতে কর্তন ও সংশ্লিষ্ট পবিসে ব্যাংক অ্যাডভাইস মূলে প্রেরিত অর্থ</p>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="table-header text-gray-700 font-semibold border-b">
                <th class="p-3 font-bold text-gray-900">বিবরণ / খাত</th>
                ${otherPbsStats.map(s => `<th class="p-3 text-right font-bold font-mono text-purple-900 bg-purple-50/40">${toBn(s.fiscalYear)}</th>`).join('')}
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr class="hover:bg-gray-50">
                <td class="p-3 font-medium text-gray-800">১. প্রারম্ভিক অপরিশোধিত স্থিতি (Opening Payable)</td>
                ${otherPbsStats.map(s => `<td class="p-3 text-right font-mono">${formatBDT(s.openingPayable)}</td>`).join('')}
              </tr>
              <tr class="hover:bg-gray-50 bg-purple-50/20">
                <td class="p-3 font-semibold text-purple-900">২. অর্থবছরে বেতন হতে মোট কর্তন (Deducted in FY)</td>
                ${otherPbsStats.map(s => `<td class="p-3 text-right font-mono font-bold text-purple-900">${formatBDT(s.deductedFromSalary)} (${toBn(s.deductionCount)} টি)</td>`).join('')}
              </tr>
              <tr class="hover:bg-gray-50 bg-emerald-50/20">
                <td class="p-3 font-semibold text-emerald-900">৩. সংশ্লিষ্ট পবিসে প্রেরিত অর্থ (Remitted to PBS)</td>
                ${otherPbsStats.map(s => `<td class="p-3 text-right font-mono font-bold text-emerald-800">${formatBDT(s.remittedToPBS)} (${toBn(s.adviceCount)} টি অ্যাডভাইস)</td>`).join('')}
              </tr>
              <tr class="bg-purple-100/70 font-bold border-t-2 border-purple-700">
                <td class="p-3 text-purple-950">৪. সমাপনী অপরিশোধিত রেমিট্যান্স স্থিতি = (১+২-৩)</td>
                ${otherPbsStats.map(s => `<td class="p-3 text-right font-mono text-purple-950">${formatBDT(s.closingPayable)}</td>`).join('')}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    console.error('Comparative statement error:', err);
  }
}

// 10. AUDIT LOG REPORT
async function loadAuditLogs() {
  const tbody = document.getElementById('auditLogsTableBody');
  try {
    const res = await API.get('/reports/audit-logs');
    if (!res.success) return;

    tbody.innerHTML = '';
    if (res.logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-400">কোন অডিট রেকর্ড নেই।</td></tr>`;
      return;
    }

    res.logs.forEach(log => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      tr.innerHTML = `
        <td class="p-3 text-gray-500">${toBn(log.created_at)}</td>
        <td class="p-3 font-bold text-gray-800">${log.username}</td>
        <td class="p-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
            log.action === 'CREATE' ? 'bg-emerald-100 text-emerald-800' :
            log.action === 'UPDATE' ? 'bg-blue-100 text-blue-800' :
            log.action === 'DELETE' ? 'bg-red-100 text-red-800' :
            log.action === 'RESTORE' ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
          }">
            ${log.action}
          </span>
        </td>
        <td class="p-3 text-gray-700">${log.entity_type}</td>
        <td class="p-3 text-gray-800 font-sans">${log.details || ''}</td>
        <td class="p-3 text-gray-400">${log.ip_address}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Audit logs error:', err);
  }
}

// 11. RECYCLE BIN
async function loadRecycleBin() {
  const tbody = document.getElementById('recycleBinTableBody');
  try {
    const res = await API.get('/recyclebin');
    if (!res.success) return;

    tbody.innerHTML = '';
    if (res.deletedItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center p-6 text-gray-400">রিসাইকেল বিন খালি। কোন ডিলিটকৃত রেকর্ড নেই।</td></tr>`;
      return;
    }

    res.deletedItems.forEach(item => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-gray-50';
      tr.innerHTML = `
        <td class="p-3.5">
          <span class="px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800">
            ${item.entity_type}
          </span>
        </td>
        <td class="p-3.5 font-bold font-mono text-gray-800">${item.code || item.id}</td>
        <td class="p-3.5">
          <div class="font-bold text-gray-900">${item.title}</div>
          <div class="text-xs text-gray-500">${item.subtitle || ''}</div>
        </td>
        <td class="p-3.5 text-xs text-gray-500">${toBn(item.deleted_at)}</td>
        <td class="p-3.5 text-xs font-semibold text-gray-700">${item.deleted_by || '-'}</td>
        <td class="p-3.5 text-center">
          <button onclick="restoreRecord('${item.entity_type}', ${item.id})" class="px-3 py-1 bg-purple-700 hover:bg-purple-800 text-white rounded-lg text-xs font-semibold shadow transition flex items-center space-x-1 mx-auto">
            <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
            <span>পুনরুদ্ধার (Restore)</span>
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Recycle bin load error:', err);
  }
}

async function restoreRecord(entity_type, id) {
  if (!await confirmWithSweetAlert(
    `আপনি কি এই রেকর্ডটি (${entity_type}) পুনর্বহাল করতে চান? এটি সাথে সাথে ডাটাবেজ এবং ব্যালেন্স হিসেবে সমন্বয় হবে।`,
    { icon: 'question', confirmButtonColor: '#7e22ce' }
  )) return;
  try {
    const res = await API.post('/recyclebin/restore', { entity_type, id });
    if (res.success) {
      showToast(res.message, 'success');
      loadRecycleBin();
      loadLoans();
      loadEmployees();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

const ownPbsSettingsFields = {
  pbs_name: 'settingPbsName',
  pbs_code: 'settingPbsCode',
  address: 'settingPbsAddress',
  phone: 'settingPbsPhone',
  email: 'settingPbsEmail',
  pbs_english_name: 'settingPbsEnglishName',
  letterhead_subtitle: 'settingLetterheadSubtitle',
  letterhead_right_title: 'settingLetterheadRightTitle',
  letterhead_badge_text: 'settingLetterheadBadgeText',
  website: 'settingWebsite',
  bank_name: 'settingBankName',
  account_no: 'settingAccountNo',
  routing_no: 'settingRoutingNo',
  bank_advice_prepared_by_name: 'settingBankAdvicePreparedByName',
  bank_advice_verified_by_name: 'settingBankAdviceVerifiedByName',
  agm_finance_name: 'settingAgmName',
  gm_name: 'settingGmName',
  memo_no_prefix: 'settingMemoNoPrefix'
};
let ownPbsSettingsSaveQueue = Promise.resolve();
let ownPbsSettingsAutosaveTimer = null;

function buildOwnPbsSettingsPayload() {
  return Object.fromEntries(Object.entries(ownPbsSettingsFields).map(([field, elementId]) => [
    field,
    document.getElementById(elementId)?.value || ''
  ]));
}

function setOwnPbsSettingsSaveStatus(message, stateName = 'idle') {
  const status = document.getElementById('ownPbsSettingsSaveStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `text-xs mr-3 ${
    stateName === 'error' ? 'text-red-700'
      : stateName === 'saving' ? 'text-blue-700'
        : stateName === 'saved' ? 'text-emerald-700'
          : 'text-gray-500'
  }`;
}

function saveOwnPbsSettings(showSuccessToast = false) {
  const saveTask = ownPbsSettingsSaveQueue.catch(() => {}).then(async () => {
    setOwnPbsSettingsSaveStatus('ডাটাবেজে সংরক্ষণ হচ্ছে...', 'saving');
    const payload = buildOwnPbsSettingsPayload();
    try {
      const result = await API.put('/settings', payload);
      if (!result.success) throw new Error(result.message || 'পবিস সেটিংস সংরক্ষণ করা যায়নি।');
      state.pbsSettings = { ...(state.pbsSettings || {}), ...payload };
      setOwnPbsSettingsSaveStatus('ডাটাবেজে সংরক্ষিত হয়েছে', 'saved');
      if (showSuccessToast) showToast(result.message, 'success');
      return result;
    } catch (error) {
      console.error('Own PBS settings save error:', error);
      setOwnPbsSettingsSaveStatus(`সংরক্ষণ হয়নি: ${error.message}`, 'error');
      if (showSuccessToast) showToast(error.message || 'পবিস সেটিংস সংরক্ষণ ব্যর্থ হয়েছে।', 'error');
      return null;
    }
  });

  ownPbsSettingsSaveQueue = saveTask;
  return saveTask;
}

function scheduleOwnPbsSettingsAutosave(delay = 700) {
  clearTimeout(ownPbsSettingsAutosaveTimer);
  setOwnPbsSettingsSaveStatus('পরিবর্তন সংরক্ষণের জন্য অপেক্ষা করছে...', 'saving');
  ownPbsSettingsAutosaveTimer = setTimeout(() => {
    saveOwnPbsSettings();
  }, delay);
}

// 12. SETTINGS TAB
async function loadSettingsTab() {
  if (ownPbsSettingsAutosaveTimer) {
    clearTimeout(ownPbsSettingsAutosaveTimer);
    ownPbsSettingsAutosaveTimer = null;
    await saveOwnPbsSettings();
  }
  await ownPbsSettingsSaveQueue;
  await loadSettings();
}

async function loadSettings() {
  try {
    const res = await API.get('/settings');
    if (!res.success) return;

    const s = res.pbsSettings;
    if (s) {
      document.getElementById('settingPbsName').value = s.pbs_name || '';
      document.getElementById('settingPbsCode').value = s.pbs_code || '';
      document.getElementById('settingPbsAddress').value = s.address || '';
      document.getElementById('settingPbsPhone').value = s.phone || '';
      document.getElementById('settingPbsEmail').value = s.email || '';
      document.getElementById('settingPbsEnglishName').value = s.pbs_english_name || '';
      document.getElementById('settingLetterheadSubtitle').value = s.letterhead_subtitle || '';
      document.getElementById('settingLetterheadRightTitle').value = s.letterhead_right_title || '';
      document.getElementById('settingLetterheadBadgeText').value = s.letterhead_badge_text || '';
      document.getElementById('settingWebsite').value = s.website || '';
      const logoPreview = document.getElementById('settingLetterheadLogoPreview');
      if (logoPreview) {
        logoPreview.src = s.logo_url || '/logo.jpg';
        logoPreview.classList.remove('hidden');
      }
      document.getElementById('settingBankName').value = s.bank_name || '';
      document.getElementById('settingAccountNo').value = s.account_no || '';
      document.getElementById('settingBankAdvicePreparedByName').value = s.bank_advice_prepared_by_name || '';
      document.getElementById('settingBankAdviceVerifiedByName').value = s.bank_advice_verified_by_name || '';
      if (document.getElementById('settingRoutingNo')) {
        document.getElementById('settingRoutingNo').value = s.routing_no || '';
      }
      document.getElementById('settingAgmName').value = s.agm_finance_name || '';
      document.getElementById('settingGmName').value = s.gm_name || '';
      document.getElementById('settingMemoNoPrefix').value = s.memo_no_prefix || '২৭.১২.৬১০০.৫৪২.০১.০২৪';
    }

    state.otherPbsList = res.otherPbsList || [];
    renderOtherPbsTable(state.otherPbsList);
  } catch (err) {
    console.error('Settings load error:', err);
  }
}

function renderOtherPbsTable(list = []) {
  const tbody = document.getElementById('otherPbsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const badge = document.getElementById('otherPbsCountBadge');
  if (badge) {
    badge.textContent = `মোট ${toBn(list.length)} টি পবিস`;
  }

  if (list.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="p-6 text-center text-gray-500 italic">কোনো পল্লী বিদ্যুৎ সমিতি পাওয়া যায়নি।</td>
      </tr>
    `;
    return;
  }

  list.forEach((p, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-purple-50/40 transition border-b border-gray-100';
    tr.innerHTML = `
      <td class="p-2.5 text-center font-mono text-gray-500 font-bold">${toBn(idx + 1)}</td>
      <td class="p-2.5">
        <div class="font-bold text-gray-900">${p.pbs_name}</div>
        <div class="text-[11px] text-gray-400 font-mono">${p.short_name || '-'}</div>
      </td>
      <td class="p-2.5">
        <div class="font-semibold text-gray-800">${p.bank_name || '-'}</div>
        <div class="text-[11px] text-gray-500">${p.bank_branch ? `(${p.bank_branch})` : ''}</div>
      </td>
      <td class="p-2.5 font-mono font-bold text-blue-900 tracking-wide">${p.account_no || '-'}</td>
      <td class="p-2.5 font-mono text-gray-600 font-semibold">${p.routing_no || '-'}</td>
      <td class="p-2.5 text-center">
        <div class="flex items-center justify-center space-x-1">
          <button onclick="openOtherPbsModal(${p.id})" class="p-1.5 text-blue-600 hover:bg-blue-100 rounded-lg transition" title="ব্যাংক তথ্য সম্পাদন">
            <i data-lucide="edit-3" class="w-4 h-4"></i>
          </button>
          <button onclick="deleteOtherPbsRecord(${p.id})" class="p-1.5 text-red-600 hover:bg-red-100 rounded-lg transition" title="মুছে ফেলুন">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (window.lucide) lucide.createIcons();
}

function filterOtherPbsTable() {
  const query = (document.getElementById('otherPbsSearchInput')?.value || '').toLowerCase().trim();
  if (!state.otherPbsList) return;

  if (!query) {
    renderOtherPbsTable(state.otherPbsList);
    return;
  }

  const filtered = state.otherPbsList.filter(p => {
    return (p.pbs_name && p.pbs_name.toLowerCase().includes(query)) ||
           (p.short_name && p.short_name.toLowerCase().includes(query)) ||
           (p.bank_name && p.bank_name.toLowerCase().includes(query)) ||
           (p.bank_branch && p.bank_branch.toLowerCase().includes(query)) ||
           (p.account_no && p.account_no.toLowerCase().includes(query)) ||
           (p.routing_no && p.routing_no.toLowerCase().includes(query));
  });

  renderOtherPbsTable(filtered);
}

function openOtherPbsModal(id = null) {
  const titleEl = document.getElementById('otherPbsModalTitle');
  const btnEl = document.getElementById('otherPbsSubmitBtn');

  if (id) {
    const pbs = (state.otherPbsList || []).find(p => p.id === id);
    if (!pbs) return;

    titleEl.innerHTML = `<i data-lucide="building-2" class="w-5 h-5 text-purple-700"></i><span>${pbs.pbs_name} — ব্যাংক তথ্য সম্পাদন</span>`;
    document.getElementById('editOtherPbsId').value = pbs.id;
    document.getElementById('editOtherPbsName').value = pbs.pbs_name || '';
    document.getElementById('editOtherPbsShortName').value = pbs.short_name || '';
    document.getElementById('editOtherPbsBankName').value = pbs.bank_name || '';
    document.getElementById('editOtherPbsBankBranch').value = pbs.bank_branch || '';
    document.getElementById('editOtherPbsAccountNo').value = pbs.account_no || '';
    document.getElementById('editOtherPbsRoutingNo').value = pbs.routing_no || '';
    document.getElementById('editOtherPbsContactPerson').value = pbs.contact_person || '';
    document.getElementById('editOtherPbsPhone').value = pbs.phone || '';
    btnEl.textContent = 'আপডেট সংরক্ষণ করুন';
  } else {
    titleEl.innerHTML = `<i data-lucide="building-2" class="w-5 h-5 text-purple-700"></i><span>নতুন পবিস ব্যাংক তথ্য সংযোজন</span>`;
    document.getElementById('editOtherPbsId').value = '';
    document.getElementById('editOtherPbsName').value = '';
    document.getElementById('editOtherPbsShortName').value = '';
    document.getElementById('editOtherPbsBankName').value = '';
    document.getElementById('editOtherPbsBankBranch').value = '';
    document.getElementById('editOtherPbsAccountNo').value = '';
    document.getElementById('editOtherPbsRoutingNo').value = '';
    document.getElementById('editOtherPbsContactPerson').value = '';
    document.getElementById('editOtherPbsPhone').value = '';
    btnEl.textContent = 'নতুন পবিস যুক্ত করুন';
  }

  openModal('otherPbsModal');
  if (window.lucide) lucide.createIcons();
}

async function handleOtherPbsSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('editOtherPbsId').value;
  const payload = {
    pbs_name: document.getElementById('editOtherPbsName').value.trim(),
    short_name: document.getElementById('editOtherPbsShortName').value.trim(),
    bank_name: document.getElementById('editOtherPbsBankName').value.trim(),
    bank_branch: document.getElementById('editOtherPbsBankBranch').value.trim(),
    account_no: document.getElementById('editOtherPbsAccountNo').value.trim(),
    routing_no: document.getElementById('editOtherPbsRoutingNo').value.trim(),
    contact_person: document.getElementById('editOtherPbsContactPerson').value.trim(),
    phone: document.getElementById('editOtherPbsPhone').value.trim()
  };

  const submitBtn = document.getElementById('otherPbsSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'সংরক্ষণ করা হচ্ছে...';

  try {
    let res;
    if (id) {
      res = await API.put(`/settings/other-pbs/${id}`, payload);
    } else {
      res = await API.post('/settings/other-pbs', payload);
    }

    if (res.success) {
      showToast(res.message, 'success');
      closeModal('otherPbsModal');
      await loadSettings();
    } else {
      showToast(res.message || 'ব্যর্থ হয়েছে।', 'error');
    }
  } catch (err) {
    showToast(err.message || 'সার্ভার সংযোগ ত্রুটি', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'সংরক্ষণ করুন';
  }
}

async function deleteOtherPbsRecord(id) {
  const pbs = (state.otherPbsList || []).find(p => p.id === id);
  const pbsName = pbs ? pbs.pbs_name : 'এই পবিসের';

  if (!await confirmWithSweetAlert(`আপনি কি নিশ্চিত যে "${pbsName}" এর ব্যাংক তথ্য মুছে ফেলতে চান?`)) {
    return;
  }

  try {
    const res = await API.delete(`/settings/other-pbs/${id}`);
    if (res.success) {
      showToast(res.message, 'success');
      await loadSettings();
    } else {
      showToast(res.message || 'মুছে ফেলা যায়নি।', 'error');
    }
  } catch (err) {
    showToast(err.message || 'সার্ভার সংযোগ ত্রুটি', 'error');
  }
}

window.openOtherPbsModal = openOtherPbsModal;
window.filterOtherPbsTable = filterOtherPbsTable;
window.handleOtherPbsSubmit = handleOtherPbsSubmit;
window.deleteOtherPbsRecord = deleteOtherPbsRecord;


// 13. EMPLOYEE SELF-SERVICE PORTAL (Personal Loan Ledger)
let currentEmployeeLedgerData = null;

async function loadEmployeePortal() {
  const container = document.getElementById('empLedgerTablesContainer');
  const loansContainer = document.getElementById('empLoansContainer');
  if (container) {
    container.innerHTML = `
      <div class="p-8 text-center text-gray-400 bg-white rounded-2xl border border-gray-100">
        <i data-lucide="loader-2" class="w-8 h-8 mx-auto mb-2 animate-spin text-emerald-600"></i>
        <p class="font-medium text-xs">আপনার খতিয়ান ও হিসাব বিবরণী প্রস্তুত করা হচ্ছে...</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
  }

  try {
    const empId = state.user?.employeeId;
    const res = await API.get('/reports/employee-loan-ledger', empId ? { employeeId: empId } : {});
    if (!res.success) {
      if (container) container.innerHTML = `<div class="p-6 text-center text-red-500 bg-white rounded-xl">খতিয়ান লোড করতে ব্যর্থ হয়েছে।</div>`;
      return;
    }

    currentEmployeeLedgerData = res;
    const emp = res.employee || {
      name: state.user?.fullName || 'কর্মকর্তা/কর্মচারী',
      emp_code: state.user?.empCode || state.user?.username || '',
      designation: state.user?.designation || '',
      department: state.user?.department || ''
    };
    const gt = res.grandTotal || {
      totalDisbursed: 0,
      totalPrincipalPaid: 0,
      principalBalance: 0,
      totalInterestProvisioned: 0,
      totalInterestPaid: 0,
      interestBalance: 0,
      netBalance: 0,
      loanCount: (res.loanLedgers || []).length
    };

    // Update Header and KPI Strips
    const nameEl = document.getElementById('empPortalName');
    const desigEl = document.getElementById('empPortalDesignation');
    const badgeEl = document.getElementById('empPortalLoanCountBadge');
    
    if (nameEl) nameEl.textContent = emp.name;
    if (desigEl) desigEl.textContent = `${emp.designation || 'কর্মকর্তা/কর্মচারী'} • পে-আইডি: ${toBn(emp.emp_code)} • বিভাগ: ${emp.department || 'সাধারণ'}`;
    if (badgeEl) badgeEl.textContent = `${toBn(gt.loanCount || (res.loanLedgers || []).length)}টি ঋণ হিসাব`;

    const elDisbursed = document.getElementById('empPortalDisbursed');
    const elPrinPaid = document.getElementById('empPortalPrincipalPaid');
    const elPrinBal = document.getElementById('empPortalPrincipal');
    const elIntProv = document.getElementById('empPortalInterestProvisioned');
    const elIntPaid = document.getElementById('empPortalInterestPaid');
    const elNetBal = document.getElementById('empPortalTotal');

    if (elDisbursed) elDisbursed.textContent = formatBDT(gt.totalDisbursed);
    if (elPrinPaid) elPrinPaid.textContent = formatBDT(gt.totalPrincipalPaid);
    if (elPrinBal) elPrinBal.textContent = formatBDT(gt.principalBalance);
    if (elIntProv) elIntProv.textContent = formatBDT(gt.totalInterestProvisioned);
    if (elIntPaid) elIntPaid.textContent = formatBDT(gt.totalInterestPaid);
    if (elNetBal) elNetBal.textContent = formatBDT(gt.netBalance);

    // 1. Render Loan Particulars Cards
    if (loansContainer) {
      loansContainer.innerHTML = '';
      if (!res.loanLedgers || res.loanLedgers.length === 0) {
        loansContainer.innerHTML = '<div class="text-xs text-gray-500 p-4 bg-white rounded-xl border border-gray-100 col-span-2">আপনার নামে কোনো সক্রিয় বা পূর্ববর্তী গৃহ ঋণ রেকর্ড নেই।</div>';
      } else {
        res.loanLedgers.forEach((ll, idx) => {
          const l = ll.loan;
          const isOwn = l.loan_source_type === 'OWN_PBS';
          const card = document.createElement('div');
          card.className = 'bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-gray-200 hover:border-emerald-300 transition space-y-3';
          card.innerHTML = `
            <div class="flex items-center justify-between border-b pb-2.5">
              <div class="flex items-center space-x-2">
                <span class="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold flex items-center justify-center font-mono">${toBn(idx + 1)}</span>
                <span class="font-bold text-gray-900 text-base font-mono">${l.loan_no}</span>
                <span class="text-xs font-semibold px-2 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200">${l.loan_lot_name}</span>
              </div>
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${isOwn ? 'badge-own' : 'badge-other'}">
                ${l.origin_pbs_name}
              </span>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs text-gray-600">
              <div>
                <span class="text-gray-400 block text-[10px]">মঞ্জুরি নং ও তারিখ:</span>
                <strong class="text-gray-800">${l.sanction_no ? `${l.sanction_no} (${toBn(l.sanction_date || '-')})` : '—'}</strong>
              </div>
              <div>
                <span class="text-gray-400 block text-[10px]">বিতরণ তারিখ:</span>
                <strong class="text-gray-800">${toBn(l.disbursement_date)}</strong>
              </div>
              <div>
                <span class="text-gray-400 block text-[10px]">মঞ্জুরিকৃত আসল:</span>
                <strong class="text-gray-900 font-bold font-mono">${formatBDT(l.disbursed_amount)}</strong>
              </div>
              <div>
                <span class="text-gray-400 block text-[10px]">মাসিক কিস্তি:</span>
                <strong class="text-blue-900 font-bold font-mono">${formatBDT(l.monthly_installment)}</strong>
              </div>
              <div>
                <span class="text-gray-400 block text-[10px]">সুদের হার:</span>
                <strong class="text-orange-800 font-bold">${isOwn ? toBn(l.interest_rate) + '% (সরল সুদ)' : 'প্রভিশন প্রযোজ্য নয়'}</strong>
              </div>
              <div>
                <span class="text-gray-400 block text-[10px]">হিসাব অবস্থা:</span>
                <span class="font-bold ${l.status === 'ACTIVE' ? 'text-emerald-700' : 'text-gray-500'}">${l.status === 'ACTIVE' ? '● সক্রিয় (Active)' : '○ পরিশোধিত (Closed)'}</span>
              </div>
            </div>

            <div class="pt-2 border-t flex justify-between items-center text-xs bg-gray-50 -mx-4 -mb-4 sm:-mx-5 sm:-mb-5 p-3 rounded-b-2xl">
              <div>
                <span class="text-gray-500">অবশিষ্ট আসল:</span>
                <strong class="text-blue-900 font-bold ml-1 font-mono">${formatBDT(l.principal_balance)}</strong>
              </div>
              <div>
                <span class="text-gray-500">অবশিষ্ট সুদ:</span>
                <strong class="text-amber-800 font-bold ml-1 font-mono">${formatBDT(l.interest_balance)}</strong>
              </div>
              ${l.advance_balance > 0 ? `<div><span class="text-blue-700">অগ্রিম জমা:</span><strong class="text-blue-800 font-bold ml-1 font-mono">${formatBDT(l.advance_balance)}</strong></div>` : ''}
              <div class="font-bold text-emerald-950">
                <span>মোট জের:</span>
                <strong class="ml-1 font-mono text-emerald-800">${formatBDT(l.principal_balance + l.interest_balance)}</strong>
              </div>
            </div>
          `;
          loansContainer.appendChild(card);
        });
      }
    }

    // 2. Render Full Debit / Credit Ledger Tables (খতিয়ান বই)
    if (container) {
      container.innerHTML = '';
      if (!res.loanLedgers || res.loanLedgers.length === 0) {
        container.innerHTML = `
          <div class="p-8 text-center text-gray-500 bg-white rounded-2xl border border-gray-200">
            <i data-lucide="folder-x" class="w-10 h-10 mx-auto mb-2 text-gray-400"></i>
            <h4 class="font-bold text-gray-700">কোন খতিয়ান এন্ট্রি নেই</h4>
            <p class="text-xs text-gray-400 mt-1">আপনার নামে কোনো ঋণ বা লেনদেন পাওয়া যায়নি।</p>
          </div>
        `;
        if (window.lucide) lucide.createIcons();
        return;
      }

      res.loanLedgers.forEach((ll, idx) => {
        const loan = ll.loan;
        const sub = ll.subtotal || {};
        const entries = ll.entries || [];
        const isOwn = loan.loan_source_type === 'OWN_PBS';
        const loanCard = document.createElement('div');
        loanCard.className = 'bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden';

        let rowsHtml = '';
        if (entries.length === 0) {
          rowsHtml = `<tr><td colspan="${isOwn ? 10 : 8}" class="p-6 text-center text-gray-400 text-xs">কোন খতিয়ান লেনদেন পাওয়া যায়নি।</td></tr>`;
        } else {
          rowsHtml = entries.map((e, eIdx) => {
            const isPrior = e.type && e.type.startsWith('PRIOR_');
            const isDisb = e.type === 'DISBURSEMENT';
            const isProv = e.type === 'INTEREST_PROVISION';
            const isRepay = e.type === 'REPAYMENT';
            
            let typeBadge = '';
            let rowBg = '';
            if (isDisb) {
              rowBg = 'bg-blue-50/30';
              typeBadge = '<span class="inline-block px-1.5 py-0.2 rounded text-[10px] bg-blue-100 text-blue-800 font-bold mr-1.5">বিতরণ</span>';
            } else if (isProv) {
              rowBg = 'bg-orange-50/20';
              typeBadge = '<span class="inline-block px-1.5 py-0.2 rounded text-[10px] bg-orange-100 text-orange-800 font-bold mr-1.5">সুদ</span>';
            } else if (isPrior) {
              rowBg = 'bg-purple-50/30';
              typeBadge = '<span class="inline-block px-1.5 py-0.2 rounded text-[10px] bg-purple-100 text-purple-800 font-bold mr-1.5">প্রারম্ভিক</span>';
            } else if (isRepay) {
              typeBadge = '<span class="inline-block px-1.5 py-0.2 rounded text-[10px] bg-emerald-100 text-emerald-800 font-bold mr-1.5">কিস্তি</span>';
            }

            return `
              <tr class="hover:bg-blue-50/50 transition ${rowBg} text-xs">
                <td class="p-2.5 text-center text-gray-400 font-mono">${toBn(eIdx + 1)}</td>
                <td class="p-2.5 font-mono font-medium text-gray-800 whitespace-nowrap">${toBn(e.date)}</td>
                <td class="p-2.5 font-sans font-medium text-gray-900">
                  ${typeBadge}<span>${e.description}</span>
                </td>
                <td class="p-2.5 text-gray-500 font-mono text-[11px] whitespace-nowrap">${e.voucher || '—'}</td>
                <td class="p-2.5 text-right font-mono font-bold text-blue-800 bg-blue-50/30">${e.debitPrincipal > 0 ? formatBDT(e.debitPrincipal) : '—'}</td>
                <td class="p-2.5 text-right font-mono font-bold text-emerald-700 bg-emerald-50/30">${e.creditPrincipal > 0 ? formatBDT(e.creditPrincipal) : '—'}</td>
                ${isOwn ? `
                <td class="p-2.5 text-right font-mono font-bold text-orange-800 bg-orange-50/30">${e.debitInterest > 0 ? formatBDT(e.debitInterest) : '—'}</td>
                <td class="p-2.5 text-right font-mono font-bold text-amber-700 bg-amber-50/30">${e.creditInterest > 0 ? formatBDT(e.creditInterest) : '—'}</td>
                ` : ''}
                <td class="p-2.5 text-right font-mono font-bold text-blue-900">${formatBDT(e.principalBalance)}</td>
                ${isOwn ? `<td class="p-2.5 text-right font-mono font-bold text-amber-900">${formatBDT(e.interestBalance)}</td>` : ''}
                <td class="p-2.5 text-right font-mono font-extrabold text-emerald-900 bg-emerald-50/40">${formatBDT(e.netBalance)}</td>
              </tr>
            `;
          }).join('');
        }

        loanCard.innerHTML = `
          <!-- Loan Section Top Bar -->
          <div class="p-4 bg-gradient-to-r from-gray-50 to-gray-100 border-b border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div class="flex items-center space-x-2 flex-wrap">
              <span class="w-6 h-6 rounded-md bg-emerald-800 text-white text-xs font-bold flex items-center justify-center font-mono">#${toBn(idx + 1)}</span>
              <span class="font-extrabold font-mono text-gray-900 text-base">${loan.loan_no}</span>
              <span class="px-2 py-0.5 text-xs font-semibold rounded bg-white text-gray-700 border border-gray-200">${loan.loan_lot_name}</span>
              <span class="px-2 py-0.5 text-xs font-bold rounded ${isOwn ? 'badge-own' : 'badge-other'}">${loan.origin_pbs_name}</span>
            </div>
            <div class="text-xs text-gray-600 flex items-center space-x-4">
              <span>মঞ্জুরিকৃত মূল ঋণ: <strong class="text-gray-900 font-mono font-bold">${formatBDT(loan.disbursed_amount)}</strong></span>
              <span>মাসিক কিস্তি: <strong class="text-blue-900 font-mono font-bold">${formatBDT(loan.monthly_installment)}</strong></span>
            </div>
          </div>

          <!-- Table Container -->
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse">
              <thead>
                <tr class="bg-gray-100/90 text-gray-700 font-bold border-b text-[11px] uppercase tracking-wider">
                  <th class="p-2.5 text-center w-8">#</th>
                  <th class="p-2.5 whitespace-nowrap">তারিখ</th>
                  <th class="p-2.5 min-w-[200px]">লেনদেনের বিবরণ</th>
                  <th class="p-2.5 whitespace-nowrap">ভাউচার</th>
                  <th class="p-2.5 text-right bg-blue-100/60 text-blue-950 font-extrabold">ডেবিট আসল</th>
                  <th class="p-2.5 text-right bg-emerald-100/60 text-emerald-950 font-extrabold">ক্রেডিট আসল</th>
                  ${isOwn ? `
                  <th class="p-2.5 text-right bg-orange-100/60 text-orange-950 font-extrabold">ডেবিট সুদ</th>
                  <th class="p-2.5 text-right bg-amber-100/60 text-amber-950 font-extrabold">ক্রেডিট সুদ</th>
                  ` : ''}
                  <th class="p-2.5 text-right text-blue-900 font-extrabold">আসল স্থিতি</th>
                  ${isOwn ? `<th class="p-2.5 text-right text-amber-900 font-extrabold">সুদ স্থিতি</th>` : ''}
                  <th class="p-2.5 text-right text-emerald-950 font-extrabold bg-emerald-100/40">মোট স্থিতি</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 bg-white">
                ${rowsHtml}
              </tbody>
              <!-- Subtotals and Closing Balance Footer -->
              <tfoot class="bg-gray-100 border-t-2 border-gray-300 font-mono text-xs font-bold text-gray-900">
                <tr>
                  <td colspan="4" class="p-3 text-right font-sans font-extrabold text-gray-800">
                    ★ হিসাব সমাপ্তি জের (Closing Balance):
                  </td>
                  <td class="p-3 text-right text-blue-900 bg-blue-50/50">${formatBDT(sub.totalDisbursed || 0)}</td>
                  <td class="p-3 text-right text-emerald-800 bg-emerald-50/50">${formatBDT(sub.totalPrincipalPaid || 0)}</td>
                  ${isOwn ? `
                  <td class="p-3 text-right text-orange-900 bg-orange-50/50">${formatBDT(sub.totalInterestProvisioned || 0)}</td>
                  <td class="p-3 text-right text-amber-800 bg-amber-50/50">${formatBDT(sub.totalInterestPaid || 0)}</td>
                  ` : ''}
                  <td class="p-3 text-right text-blue-900 font-extrabold">${formatBDT(sub.principalBalance || 0)}</td>
                  ${isOwn ? `<td class="p-3 text-right text-amber-900 font-extrabold">${formatBDT(sub.interestBalance || 0)}</td>` : ''}
                  <td class="p-3 text-right text-emerald-950 font-extrabold bg-emerald-100/60">${formatBDT(sub.netBalance || 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        `;
        container.appendChild(loanCard);
      });
    }

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    console.error('Employee portal ledger error:', err);
    if (container) {
      container.innerHTML = `<div class="p-6 text-center text-red-500 bg-white rounded-xl">খতিয়ান তথ্য লোড করতে সমস্যা হয়েছে: ${err.message}</div>`;
    }
  }
}

function printEmployeePortalLedger() {
  const data = currentEmployeeLedgerData;
  if (!data || !data.loanLedgers || data.loanLedgers.length === 0) {
    showToast('প্রিন্ট করার জন্য খতিয়ান ডাটা প্রস্তুত নেই।', 'warning');
    return;
  }

  const emp = data.employee || state.user || {};
  const gt = data.grandTotal || {};
  const pbsName = state.settings?.own_pbs_name || 'গাজীপুর পল্লী বিদ্যুৎ সমিতি-২';

  let printFrame = document.getElementById('empLedgerPrintFrame');
  if (printFrame) printFrame.remove();

  printFrame = document.createElement('iframe');
  printFrame.id = 'empLedgerPrintFrame';
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  printFrame.style.border = '0';
  printFrame.style.visibility = 'hidden';
  document.body.appendChild(printFrame);

  const doc = printFrame.contentWindow.document;
  doc.open();

  let ledgersHtml = '';
  data.loanLedgers.forEach((ll, idx) => {
    const loan = ll.loan;
    const isOwn = loan.loan_source_type === 'OWN_PBS';
    const sub = ll.subtotal || {};

    const rowsTr = (ll.entries || []).map((e, eIdx) => `
      <tr>
        <td style="text-align:center; padding: 4px; border: 1px solid #333; font-family: monospace;">${toBn(eIdx + 1)}</td>
        <td style="text-align:center; padding: 4px; border: 1px solid #333; font-family: monospace;">${toBn(e.date)}</td>
        <td style="padding: 4px 6px; border: 1px solid #333;">${escapeHtml(e.description)}</td>
        <td style="text-align:center; padding: 4px; border: 1px solid #333; font-family: monospace;">${escapeHtml(e.voucher || '—')}</td>
        <td style="text-align:right; padding: 4px 6px; border: 1px solid #333; font-family: monospace;">${e.debitPrincipal > 0 ? formatBDT(e.debitPrincipal) : '—'}</td>
        <td style="text-align:right; padding: 4px 6px; border: 1px solid #333; font-family: monospace;">${e.creditPrincipal > 0 ? formatBDT(e.creditPrincipal) : '—'}</td>
        ${isOwn ? `
        <td style="text-align:right; padding: 4px 6px; border: 1px solid #333; font-family: monospace;">${e.debitInterest > 0 ? formatBDT(e.debitInterest) : '—'}</td>
        <td style="text-align:right; padding: 4px 6px; border: 1px solid #333; font-family: monospace;">${e.creditInterest > 0 ? formatBDT(e.creditInterest) : '—'}</td>
        ` : ''}
        <td style="text-align:right; padding: 4px 6px; border: 1px solid #333; font-family: monospace; font-weight: bold;">${formatBDT(e.principalBalance)}</td>
        ${isOwn ? `<td style="text-align:right; padding: 4px 6px; border: 1px solid #333; font-family: monospace; font-weight: bold;">${formatBDT(e.interestBalance)}</td>` : ''}
        <td style="text-align:right; padding: 4px 6px; border: 1px solid #333; font-family: monospace; font-weight: bold; background: #f0fdf4;">${formatBDT(e.netBalance)}</td>
      </tr>
    `).join('');

    ledgersHtml += `
      <div style="margin-top: 15px; margin-bottom: 25px;">
        <div style="background: #f1f5f9; padding: 6px 10px; border: 1px solid #333; border-bottom: none; display: flex; justify-content: space-between; font-size: 11px;">
          <div>
            <strong>ঋণ হিসাব #${toBn(idx + 1)}: ${escapeHtml(loan.loan_no)} (${escapeHtml(loan.loan_lot_name)})</strong> &bull;
            <span>উৎস: ${escapeHtml(loan.origin_pbs_name)}</span> &bull;
            <span>মঞ্জুরি: ${escapeHtml(loan.sanction_no || 'N/A')}</span> &bull;
            <span>সুদ: ${isOwn ? toBn(loan.interest_rate) + '% সরল' : 'প্রভিশন প্রযোজ্য নয়'}</span>
          </div>
          <div>
            <span>মঞ্জুরিকৃত আসল: <strong>${formatBDT(loan.disbursed_amount)}</strong></span> |
            <span>মাসিক কিস্তি: <strong>${formatBDT(loan.monthly_installment)}</strong></span>
          </div>
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 10px;">
          <thead>
            <tr style="background: #e2e8f0; font-weight: bold;">
              <th style="padding: 5px; border: 1px solid #333; width: 25px;">#</th>
              <th style="padding: 5px; border: 1px solid #333; width: 75px;">তারিখ</th>
              <th style="padding: 5px; border: 1px solid #333;">বিবরণ</th>
              <th style="padding: 5px; border: 1px solid #333; width: 80px;">ভাউচার</th>
              <th style="padding: 5px; border: 1px solid #333; width: 75px; text-align: right;">ডেবিট আসল</th>
              <th style="padding: 5px; border: 1px solid #333; width: 75px; text-align: right;">ক্রেডিট আসল</th>
              ${isOwn ? `
              <th style="padding: 5px; border: 1px solid #333; width: 70px; text-align: right;">ডেবিট সুদ</th>
              <th style="padding: 5px; border: 1px solid #333; width: 70px; text-align: right;">ক্রেডিট সুদ</th>
              ` : ''}
              <th style="padding: 5px; border: 1px solid #333; width: 85px; text-align: right;">আসল স্থিতি</th>
              ${isOwn ? `<th style="padding: 5px; border: 1px solid #333; width: 80px; text-align: right;">সুদ স্থিতি</th>` : ''}
              <th style="padding: 5px; border: 1px solid #333; width: 90px; text-align: right;">মোট স্থিতি</th>
            </tr>
          </thead>
          <tbody>
            ${rowsTr}
          </tbody>
          <tfoot>
            <tr style="background: #f8fafc; font-weight: bold; border-top: 2px solid #333;">
              <td colspan="4" style="padding: 6px; border: 1px solid #333; text-align: right;">সমাপ্তি জের (Closing Balance):</td>
              <td style="padding: 6px; border: 1px solid #333; text-align: right; font-family: monospace;">${formatBDT(sub.totalDisbursed || 0)}</td>
              <td style="padding: 6px; border: 1px solid #333; text-align: right; font-family: monospace;">${formatBDT(sub.totalPrincipalPaid || 0)}</td>
              ${isOwn ? `
              <td style="padding: 6px; border: 1px solid #333; text-align: right; font-family: monospace;">${formatBDT(sub.totalInterestProvisioned || 0)}</td>
              <td style="padding: 6px; border: 1px solid #333; text-align: right; font-family: monospace;">${formatBDT(sub.totalInterestPaid || 0)}</td>
              ` : ''}
              <td style="padding: 6px; border: 1px solid #333; text-align: right; font-family: monospace;">${formatBDT(sub.principalBalance || 0)}</td>
              ${isOwn ? `<td style="padding: 6px; border: 1px solid #333; text-align: right; font-family: monospace;">${formatBDT(sub.interestBalance || 0)}</td>` : ''}
              <td style="padding: 6px; border: 1px solid #333; text-align: right; font-family: monospace; background: #e6f4ea;">${formatBDT(sub.netBalance || 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  });

  doc.write(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <title>ব্যক্তিগত গৃহ ঋণ হিসাব খতিয়ান - ${escapeHtml(emp.name)}</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { font-family: 'SolaimanLipi', 'Kalpurush', 'Nikosh', 'Arial', sans-serif; color: #111; margin: 0; padding: 10px; }
        .text-center { text-align: center; }
        .header { border-bottom: 2px double #333; padding-bottom: 8px; margin-bottom: 12px; }
      </style>
    </head>
    <body>
      <div class="header text-center">
        <h3 style="margin: 0; font-size: 16px;">বাংলাদেশ পল্লী বিদ্যুতায়ন বোর্ড</h3>
        <h2 style="margin: 3px 0; font-size: 18px;">${escapeHtml(pbsName)}</h2>
        <h4 style="margin: 3px 0; font-size: 14px; text-decoration: underline;">কর্মকর্তা-কর্মচারী গৃহ ঋণ ব্যক্তিগত হিসাব খতিয়ান (Personal Loan Ledger)</h4>
        <div style="display: flex; justify-content: space-between; margin-top: 8px; font-size: 11px; text-align: left;">
          <div>
            <strong>নাম:</strong> ${escapeHtml(emp.name)} &bull;
            <strong>পে-আইডি:</strong> ${toBn(emp.emp_code)} &bull;
            <strong>পদবী:</strong> ${escapeHtml(emp.designation || '')}
          </div>
          <div>
            <strong>সর্বমোট অবশিষ্ট প্রদেয়:</strong> <span style="font-weight: bold; font-family: monospace; font-size: 13px;">${formatBDT(gt.netBalance || 0)}</span> &bull;
            <strong>প্রিন্ট তারিখ:</strong> ${new Date().toLocaleDateString('bn-BD')}
          </div>
        </div>
      </div>

      ${ledgersHtml}

      <div style="margin-top: 40px; display: flex; justify-content: space-between; font-size: 11px;">
        <div style="text-align: center; width: 180px; border-top: 1px dashed #333; padding-top: 5px;">
          ঋণগ্রহীতার স্বাক্ষর
        </div>
        <div style="text-align: center; width: 180px; border-top: 1px dashed #333; padding-top: 5px;">
          সহকারী হিসাবরক্ষক / হিসাবরক্ষক
        </div>
        <div style="text-align: center; width: 200px; border-top: 1px dashed #333; padding-top: 5px;">
          সহকারী জেনারেল ম্যানেজার (অর্থ-হিসাব)
        </div>
      </div>
    </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();
  }, 400);
}

function exportEmployeePortalLedgerExcel() {
  const data = currentEmployeeLedgerData;
  if (!data || !data.loanLedgers || data.loanLedgers.length === 0) {
    showToast('ডাউনলোড করার জন্য খতিয়ান ডাটা প্রস্তুত নেই।', 'warning');
    return;
  }

  const emp = data.employee || state.user || {};
  let csv = '\uFEFF'; // UTF-8 BOM
  csv += `কর্মকর্তা-কর্মচারী গৃহ ঋণ ব্যক্তিগত হিসাব খতিয়ান (Personal Loan Ledger)\n`;
  csv += `নাম:,${emp.name},পে-আইডি:,${emp.emp_code},পদবী:,${emp.designation || ''}\n\n`;

  data.loanLedgers.forEach((ll, idx) => {
    const loan = ll.loan;
    const isOwn = loan.loan_source_type === 'OWN_PBS';
    const sub = ll.subtotal || {};

    csv += `ঋণ নং:,${loan.loan_no},বরাদ্দ লট:,${loan.loan_lot_name},উৎস:,${loan.origin_pbs_name},মঞ্জুরিকৃত আসল:,${loan.disbursed_amount},মাসিক কিস্তি:,${loan.monthly_installment}\n`;
    
    if (isOwn) {
      csv += `ক্রমিক,তারিখ,বিবরণ,ভাউচার,ডেবিট আসল,ক্রেডিট আসল,ডেবিট সুদ,ক্রেডিট সুদ,আসল স্থিতি,সুদ স্থিতি,মোট স্থিতি\n`;
    } else {
      csv += `ক্রমিক,তারিখ,বিবরণ,ভাউচার,ডেবিট আসল,ক্রেডিট আসল,আসল স্থিতি,মোট স্থিতি\n`;
    }

    (ll.entries || []).forEach((e, eIdx) => {
      const desc = `"${(e.description || '').replace(/"/g, '""')}"`;
      if (isOwn) {
        csv += `${eIdx + 1},${e.date},${desc},${e.voucher || ''},${e.debitPrincipal || 0},${e.creditPrincipal || 0},${e.debitInterest || 0},${e.creditInterest || 0},${e.principalBalance || 0},${e.interestBalance || 0},${e.netBalance || 0}\n`;
      } else {
        csv += `${eIdx + 1},${e.date},${desc},${e.voucher || ''},${e.debitPrincipal || 0},${e.creditPrincipal || 0},${e.principalBalance || 0},${e.netBalance || 0}\n`;
      }
    });

    if (isOwn) {
      csv += `সমাপ্তি জের,,,,${sub.totalDisbursed || 0},${sub.totalPrincipalPaid || 0},${sub.totalInterestProvisioned || 0},${sub.totalInterestPaid || 0},${sub.principalBalance || 0},${sub.interestBalance || 0},${sub.netBalance || 0}\n\n`;
    } else {
      csv += `সমাপ্তি জের,,,,${sub.totalDisbursed || 0},${sub.totalPrincipalPaid || 0},${sub.principalBalance || 0},${sub.netBalance || 0}\n\n`;
    }
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Loan_Ledger_${emp.emp_code || 'Employee'}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('খতিয়ান এক্সেল ফাইল সফলভাবে ডাউনলোড হয়েছে।', 'success');
}

// ----------------- FORM HANDLERS -----------------

function setupFormListeners() {
  document.getElementById('employeeExcelImportInput')?.addEventListener('change', (event) => {
    importExcelFile(event.currentTarget, '/employees/import', 'কর্মচারী', async () => {
      await loadEmployees();
    });
  });
  document.getElementById('loanExcelImportInput')?.addEventListener('change', (event) => {
    importExcelFile(event.currentTarget, '/loans/import', 'ঋণের opening balance', async () => {
      await Promise.all([loadLoans(), loadEmployees()]);
      if (typeof loadDashboard === 'function') await loadDashboard();
    });
  });

  // Login
  document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await handleLoginSubmit();
  });
  document.getElementById('changePasswordForm')?.addEventListener('submit', submitChangePassword);

  // New / Edit Loan Form
  document.getElementById('newLoanForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('loanEditId')?.value;
    const sourceType = document.getElementById('loanSourceTypeSelect')?.value || 'OWN_PBS';
    const isOtherPbs = (sourceType === 'OTHER_PBS');

    const payload = {
      employee_id: document.getElementById('loanEmployeeSelect').value,
      loan_no: document.getElementById('loanNoInput').value,
      loan_lot_name: document.getElementById('loanLotInput').value,
      loan_source_type: sourceType,
      origin_pbs_id: isOtherPbs ? (document.getElementById('loanOriginPbsSelect').value || null) : null,
      sanction_no: isOtherPbs ? '' : (document.getElementById('loanSanctionNo')?.value || ''),
      sanction_date: isOtherPbs ? '' : (document.getElementById('loanSanctionDate')?.value || ''),
      disbursement_date: isOtherPbs ? '' : (document.getElementById('loanDisbursementDate')?.value || ''),
      sanction_amount: document.getElementById('loanDisbursedAmount').value,
      disbursed_amount: document.getElementById('loanDisbursedAmount').value,
      monthly_installment: document.getElementById('loanMonthlyInstallment').value,
      custom_interest_rate: document.getElementById('loanInterestRate').value,
      remarks: document.getElementById('loanRemarks').value
    };

    try {
      let res;
      if (editId) {
        res = await API.put(`/loans/${editId}`, payload);
      } else {
        res = await API.post('/loans', payload);
      }

      if (res && res.success) {
        closeModal('newLoanModal');
        showToast(res.message, 'success');
        document.getElementById('newLoanForm').reset();
        const editIdInput = document.getElementById('loanEditId');
        if (editIdInput) editIdInput.value = '';
        loadLoans();
        loadEmployees();
        if (typeof loadDashboard === 'function') loadDashboard();
      } else {
        showToast(res?.message || 'ব্যর্থ হয়েছে।', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // New / Edit Employee Form
  document.getElementById('newEmployeeForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('empEditId')?.value;
    const payload = {
      emp_code: document.getElementById('empCodeInput').value,
      name: document.getElementById('empNameInput').value,
      designation: document.getElementById('empDesignationInput').value,
      department: document.getElementById('empDepartmentInput').value,
      mobile: document.getElementById('empMobileInput').value,
      joining_date: document.getElementById('empJoiningDate').value,
      current_posting_pbs: document.getElementById('empPostingPbs').value
    };

    try {
      let res;
      if (editId) {
        res = await API.put(`/employees/${editId}`, payload);
      } else {
        res = await API.post('/employees', payload);
      }

      if (res.success) {
        closeModal('newEmployeeModal');
        showToast(res.message, 'success');
        document.getElementById('newEmployeeForm').reset();
        document.getElementById('empEditId').value = '';
        loadEmployees();
      } else {
        showToast(res.message || 'ব্যর্থ হয়েছে।', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Single Deduction Form
  document.getElementById('singleDeductionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      loan_id: document.getElementById('deductionLoanSelect').value,
      deduction_month: document.getElementById('deductionMonthInput').value,
      deduction_date: document.getElementById('deductionDateInput').value,
      amount: document.getElementById('deductionAmountInput').value,
      voucher_no: document.getElementById('deductionVoucherInput').value,
      principal_posting: document.getElementById('singlePrincipalPostingInput')?.value || '',
      interest_posting: document.getElementById('singleInterestPostingInput')?.value || ''
    };

    try {
      const res = await API.post('/repayments', payload);
      if (res.success) {
        closeModal('singleDeductionModal');
        showToast(res.message, 'success');
        document.getElementById('singleDeductionForm').reset();
        loadRepayments();
        loadLoans();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Batch Deduction Form
  document.getElementById('batchDeductionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const loanIds = Array.from(batchSelectedLoanIds || []);

    if (loanIds.length === 0) {
      showToast('ব্যাচ কর্তনে অন্তর্ভুক্ত করার জন্য অন্তত একটি ঋণ নির্বাচন করুন।', 'error');
      return;
    }

    const payload = {
      deduction_month: document.getElementById('batchMonthInput').value,
      deduction_date: document.getElementById('batchDateInput').value,
      voucher_no: document.getElementById('batchVoucherInput').value,
      loan_ids: loanIds
    };

    const submitBtn = document.getElementById('batchSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>প্রক্রিয়াধীন...</span>';
    }

    try {
      const res = await API.post('/repayments/batch', payload);
      if (res.success) {
        closeModal('batchDeductionModal');
        showToast(res.message, 'success');
        loadDashboard();
        loadRepayments();
        loadLoans();
      } else {
        showToast(res.message || 'ব্যাচ কর্তন সম্পন্ন হয়নি।', 'error');
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i data-lucide="check-circle" class="w-4 h-4 mr-1"></i><span>ব্যাচ কর্তন শুরু করুন</span>';
        if (window.lucide) lucide.createIcons();
      }
    }
  });

  // Generate Bank Advice & Letter Form (PBS & Date Range based)
  document.getElementById('generateAdviceForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const selectedCheckboxes = document.querySelectorAll('input[name="adviceRepaymentCheck"]:checked');
    const repaymentIds = Array.from(selectedCheckboxes).map(cb => parseInt(cb.value, 10));

    if (repaymentIds.length === 0) {
      showToast('ব্যাংক অ্যাডভাইসে অন্তর্ভুক্ত করার জন্য অন্তত একটি কিস্তি নির্বাচন করুন।', 'error');
      return;
    }

    const payload = {
      target_pbs_name: document.getElementById('adviceTargetPbsName').value,
      target_pbs_id: document.getElementById('adviceTargetPbsId').value || null,
      from_date: document.getElementById('adviceFromDateInput').value,
      to_date: document.getElementById('adviceToDateInput').value,
      repayment_ids: repaymentIds,
      advice_date: document.getElementById('adviceDateInput').value,
      memo_no: document.getElementById('adviceMemoInput').value,
      remarks: document.getElementById('adviceRemarksInput').value
    };

    try {
      const res = await API.post('/remittances/generate', payload);
      if (res.success) {
        closeModal('generateAdviceModal');
        showToast(res.message, 'success');
        loadRemittances();
        loadGeneratedBankAdvices();
        loadRepayments();
        // Immediately open printable document view!
        viewPrintableDocument(res.adviceId);
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Own PBS Settings Form
  const ownPbsSettingsForm = document.getElementById('ownPbsSettingsForm');
  ownPbsSettingsForm?.querySelectorAll('input:not([type="file"])').forEach(input => {
    input.addEventListener('input', () => scheduleOwnPbsSettingsAutosave());
    input.addEventListener('change', () => scheduleOwnPbsSettingsAutosave(0));
    input.addEventListener('blur', () => {
      if (!ownPbsSettingsAutosaveTimer) return;
      clearTimeout(ownPbsSettingsAutosaveTimer);
      ownPbsSettingsAutosaveTimer = null;
      saveOwnPbsSettings();
    });
  });

  ownPbsSettingsForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearTimeout(ownPbsSettingsAutosaveTimer);
    await saveOwnPbsSettings(true);
  });

  document.getElementById('uploadLetterheadLogoBtn')?.addEventListener('click', async () => {
    const fileInput = document.getElementById('settingLetterheadLogoFile');
    const file = fileInput?.files?.[0];
    if (!file) {
      showToast('আপলোডের জন্য লোগো ফাইল নির্বাচন করুন।', 'warning');
      return;
    }

    const button = document.getElementById('uploadLetterheadLogoBtn');
    button.disabled = true;
    try {
      const result = await API.postFile('/settings/letterhead-logo', file);
      if (!result.success) {
        showToast(result.message || 'লোগো আপলোড করা যায়নি।', 'error');
        return;
      }
      const logoPreview = document.getElementById('settingLetterheadLogoPreview');
      logoPreview.src = `${result.logo_url}?v=${Date.now()}`;
      logoPreview.classList.remove('hidden');
      showToast(result.message || 'লোগো আপলোড হয়েছে।', 'success');
    } catch (error) {
      console.error('Letterhead logo upload error:', error);
      showToast(error.message || 'লোগো আপলোড করা যায়নি।', 'error');
    } finally {
      button.disabled = false;
    }
  });
}

// Helper: Toggle Other PBS Selection in New Loan Modal
async function toggleLoanOriginPBS() {
  const sourceType = document.getElementById('loanSourceTypeSelect')?.value;
  const otherDiv = document.getElementById('otherPbsSelectDiv');
  const sel = document.getElementById('loanOriginPbsSelect');
  const ownFields = document.getElementById('ownPbsSanctionFields');
  const sanctionDateInput = document.getElementById('loanSanctionDate');
  const disbDateInput = document.getElementById('loanDisbursementDate');

  if (sourceType === 'OTHER_PBS') {
    // 1. Show Other PBS selection dropdown
    if (otherDiv) otherDiv.classList.remove('hidden');
    if (sel) sel.required = true;

    // 2. Hide / Avoid sanction and disbursement date fields
    if (ownFields) ownFields.classList.add('hidden');
    if (sanctionDateInput) sanctionDateInput.required = false;
    if (disbDateInput) disbDateInput.required = false;

    if (!state.otherPbsList || state.otherPbsList.length === 0) {
      try {
        const res = await API.get('/settings');
        if (res && res.success) {
          state.pbsSettings = res.pbsSettings;
          state.otherPbsList = res.otherPbsList || [];
        }
      } catch (e) {
        console.warn('Could not fetch settings for other pbs list:', e);
      }
    }
    if (sel) {
      const currentVal = sel.value;
      sel.innerHTML = '<option value="">সংশ্লিষ্ট পবিস নির্বাচন করুন</option>';
      (state.otherPbsList || []).forEach(p => {
        sel.innerHTML += `<option value="${p.id}">${p.pbs_name} (${p.short_name || ''})</option>`;
      });
      if (currentVal) sel.value = currentVal;
    }
  } else {
    // OWN_PBS:
    if (otherDiv) otherDiv.classList.add('hidden');
    if (sel) {
      sel.required = false;
      sel.value = '';
    }

    // Show sanction and disbursement date fields
    if (ownFields) ownFields.classList.remove('hidden');
    if (sanctionDateInput) sanctionDateInput.required = true;
    if (disbDateInput) disbDateInput.required = true;
  }

  autoUpdateInterestRule();
}

// Helper: Auto-determine 8% vs 7% rule in New Loan Modal
function autoUpdateInterestRule() {
  const disbDate = document.getElementById('loanDisbursementDate')?.value;
  const sourceType = document.getElementById('loanSourceTypeSelect')?.value;
  const rateInput = document.getElementById('loanInterestRate');
  const banner = document.getElementById('interestRuleBanner');

  if (sourceType === 'OTHER_PBS') {
    if (rateInput) rateInput.value = '0.0';
    if (banner) {
      banner.classList.remove('hidden');
      banner.className = 'p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900';
      banner.innerHTML = `
        <div class="font-bold flex items-center space-x-1">
          <i data-lucide="info" class="w-4 h-4 text-purple-700"></i>
          <span>অন্য পবিসের ঋণ (Inter-PBS Transfer):</span>
        </div>
        <div>অন্য পবিস থেকে গ্রহণকৃত ঋণের ক্ষেত্রে মঞ্জুরি ও বিতরণের তারিখ প্রযোজ্য নয় এবং অত্র সমিতিতে কোনো সুদ প্রভিশন ধার্য হবে না। বেতন থেকে কর্তিত অর্থ ব্যাংক অ্যাডভাইস ও চিঠির মাধ্যমে সংশ্লিষ্ট পবিসে পাঠানো হবে।</div>
      `;
    }
  } else {
    if (!disbDate) {
      if (rateInput) rateInput.value = '7.0';
      if (banner) {
        banner.classList.add('hidden');
        banner.replaceChildren();
      }
      return;
    }

    if (banner) banner.classList.remove('hidden');
    if (disbDate < '2020-01-01') {
      rateInput.value = '8.0';
      banner.className = 'p-3 bg-orange-50 border border-orange-200 rounded-xl text-xs text-orange-900';
      banner.innerHTML = `
        <div class="font-bold flex items-center space-x-1">
          <i data-lucide="alert-triangle" class="w-4 h-4 text-orange-700"></i>
          <span>২০২০ পূর্ববর্তী সরকারি নিয়ম (৮% সরল সুদ):</span>
        </div>
        <div>১লা জানুয়ারি ২০২০ এর পূর্বে গ্রহণকৃত ও অপরিশোধিত ঋণের উপর <strong>৮% হারে সরল সুদ</strong> প্রতিমাসের ব্যালেন্সের উপর ধার্য হবে।</div>
      `;
    } else {
      rateInput.value = '7.0';
      banner.className = 'p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900';
      banner.innerHTML = `
        <div class="font-bold flex items-center space-x-1">
          <i data-lucide="check-circle" class="w-4 h-4 text-emerald-700"></i>
          <span>২০২০ পরবর্তী সরকারি নিয়ম (৭% সরল সুদ):</span>
        </div>
        <div>১লা জানুয়ারি ২০২০ এর পর গ্রহণকৃত ঋণের উপর <strong>৭% হারে সরল সুদ</strong> প্রতিমাসের ব্যালেন্সের উপর ধার্য হবে।</div>
      `;
    }
  }

  if (window.lucide) lucide.createIcons();
}

// Window Exposures for Ledgers & Control Sheets
window.switchLedgerSubtab = switchLedgerSubtab;
window.setGl14320Preset = setGl14320Preset;
window.loadHouseLoanLedger14320 = loadHouseLoanLedger14320;
window.printGl14320Document = printGl14320Document;
window.exportGl14320Excel = exportGl14320Excel;
window.setCsPreset = setCsPreset;
window.loadOwnPbsControlSheet = loadOwnPbsControlSheet;
window.printControlSheetDocument = printControlSheetDocument;
window.exportControlSheetExcel = exportControlSheetExcel;
window.printCurrentLedgerTab = printCurrentLedgerTab;
window.exportCurrentLedgerTabExcel = exportCurrentLedgerTabExcel;
window.setOtherPbs24250Preset = setOtherPbs24250Preset;
window.loadOtherPbsLedger24250 = loadOtherPbsLedger24250;
window.printOtherPbs24250Document = printOtherPbs24250Document;
window.exportOtherPbs24250Excel = exportOtherPbs24250Excel;
window.openNewLoanModal = openNewLoanModal;
window.openEditLoanModal = openEditLoanModal;

// ==================== TRANSFERRED EMPLOYEES LOANS & DEMAND LETTERS ====================

let transferredLoansData = null;
let currentIpcMonths = [];
let currentDemandLetterData = null;

async function loadTransferredLoans() {
  const pbsFilter = document.getElementById('transferredPbsFilter')?.value || '';
  const overdueOnly = document.getElementById('transferredOverdueOnlyFilter')?.checked ? 'true' : 'false';
  const search = document.getElementById('transferredSearchInput')?.value || '';

  const tbody = document.getElementById('transferredLoansTableBody');
  if (tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12" class="p-8 text-center text-gray-500">
          <div class="flex flex-col items-center justify-center space-y-2">
            <div class="w-7 h-7 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
            <span class="text-xs font-semibold text-gray-700">বদলিকৃত কর্মচারীদের গৃহ ঋণ ও বকেয়া কিস্তির হিসাব প্রস্তুত হচ্ছে...</span>
          </div>
        </td>
      </tr>
    `;
    if (window.lucide) lucide.createIcons();
  }

  try {
    const res = await API.get('/transferred-loans', {
      targetPbsName: pbsFilter,
      overdueOnly,
      search
    });

    if (!res || !res.success) {
      showToast(res?.message || 'ডাটা লোড করতে ব্যর্থ হয়েছে।', 'error');
      return;
    }

    transferredLoansData = res;

    // Update KPI summary cards
    const t = res.totals || {};
    const totalBorrowersEl = document.getElementById('kpiTransferredTotalBorrowers');
    const totalDueMonthsEl = document.getElementById('kpiTransferredTotalDueMonths');
    const totalOverdueAmountEl = document.getElementById('kpiTransferredTotalOverdueAmount');
    const totalOutstandingEl = document.getElementById('kpiTransferredTotalOutstanding');

    if (totalBorrowersEl) totalBorrowersEl.textContent = `${toBn(t.totalTransferredBorrowers || 0)} জন`;
    if (totalDueMonthsEl) totalDueMonthsEl.textContent = `${toBn(t.totalOverdueInstallments || 0)} মাস`;
    if (totalOverdueAmountEl) totalOverdueAmountEl.textContent = formatBDT(t.totalOverdueAmount || 0);
    if (totalOutstandingEl) totalOutstandingEl.textContent = formatBDT(t.totalOutstandingBalance || 0);

    // Populate PBS select filter if needed
    const pbsSel = document.getElementById('transferredPbsFilter');
    if (pbsSel && pbsSel.options.length <= 1 && res.pbsSummary) {
      const cur = pbsSel.value;
      let optHtml = '<option value="">সকল পবিস (All Target PBS)</option>';
      res.pbsSummary.forEach(p => {
        optHtml += `<option value="${p.pbsName}">${p.pbsName} (${toBn(p.borrowerCount)} জন)</option>`;
      });
      pbsSel.innerHTML = optHtml;
      pbsSel.value = cur;
    }

    // Render table
    renderTransferredLoansTable(res.records || []);

    // Render PBS summary cards
    renderTransferredPbsSummary(res.pbsSummary || []);

  } catch (err) {
    console.error('loadTransferredLoans error:', err);
    showToast('বদলিকৃত ঋণের তথ্য লোড করা যায়নি।', 'error');
  }
}

function renderTransferredLoansTable(records) {
  const tbody = document.getElementById('transferredLoansTableBody');
  const countBadge = document.getElementById('transferredTableCountBadge');
  if (!tbody) return;

  if (countBadge) {
    countBadge.textContent = `${toBn(records.length)} জন`;
  }

  if (!records || records.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12" class="p-8 text-center text-gray-400 italic">
          কোনো বদলিকৃত কর্মচারীর ঋণ বা বকেয়া কিস্তির তথ্য পাওয়া যায়নি।
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = records.map((r, idx) => {
    const isDue = r.dueMonthsCount > 0;
    const dueBadgeClass = isDue
      ? 'bg-rose-100 text-rose-800 font-bold border border-rose-200'
      : 'bg-emerald-100 text-emerald-800 font-bold border border-emerald-200';

    const safeEmpName = (r.empName || '').replace(/'/g, "\\'");
    const safePbsName = (r.currentPostingPbs || '').replace(/'/g, "\\'");

    return `
      <tr class="hover:bg-amber-50/30 transition">
        <td class="p-3 text-center font-mono text-gray-500">${toBn(idx + 1)}</td>
        <td class="p-3">
          <div class="font-bold text-gray-900 text-xs">${r.empName}</div>
          <div class="font-mono text-[11px] text-emerald-800 font-semibold">পে আইডি: ${r.empCode}</div>
        </td>
        <td class="p-3">
          <div class="text-gray-700 text-xs">${r.designation}</div>
          <div class="text-gray-400 text-[11px] font-mono">${r.mobile || '-'}</div>
        </td>
        <td class="p-3">
          <div class="flex items-center space-x-1.5">
            <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-200">${r.currentPostingPbs}</span>
            <button onclick="openChangePostingPbsModal(${r.employeeId}, '${safeEmpName}', '${safePbsName}')" class="p-1 hover:bg-gray-200 rounded text-gray-500 transition cursor-pointer" title="পদায়ন পবিস পরিবর্তন করুন">
              <i data-lucide="edit-3" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        </td>
        <td class="p-3">
          <div class="font-mono font-bold text-xs text-blue-900">${r.loanNo}</div>
          <div class="text-[10px] text-gray-500">মঞ্জুরি: ${formatBDT(r.disbursedAmount)}</div>
        </td>
        <td class="p-3 text-right font-mono font-semibold text-gray-800">
          ${formatBDT(r.monthlyInstallment)}
        </td>
        <td class="p-3 text-center font-mono text-xs text-gray-600">
          ${r.lastPaidMonthFormatted}
        </td>
        <td class="p-3 text-center">
          <span class="px-2.5 py-1 rounded-full text-xs font-mono ${dueBadgeClass}">
            ${toBn(r.dueMonthsCount)} মাস
          </span>
        </td>
        <td class="p-3 text-center font-mono text-[11px] text-gray-700">
          ${r.duePeriodText}
        </td>
        <td class="p-3 text-right font-mono font-bold text-rose-700 text-sm">
          ${formatBDT(r.overdueAmount)}
        </td>
        <td class="p-3 text-right">
          <div class="font-mono font-bold text-xs text-emerald-950">${formatBDT(r.totalBalance)}</div>
          <div class="text-[10px] text-gray-400 font-mono">আ:${formatBDT(r.principalBalance)} | সু:${formatBDT(r.interestBalance)}</div>
          ${r.advanceBalance > 0 ? `<div class="text-[10px] text-blue-700 font-semibold">অগ্রিম জমা: ${formatBDT(r.advanceBalance)}</div>` : ''}
        </td>
        <td class="p-3 text-center">
          <div class="flex items-center justify-center space-x-1.5">
            <button onclick="openDemandLetterModal(${r.loanId})" class="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[11px] font-bold shadow-sm transition flex items-center space-x-1 cursor-pointer" title="তাগাদা পত্র প্রস্তুত ও প্রিন্ট">
              <i data-lucide="file-text" class="w-3 h-3"></i>
              <span>তাগাদা পত্র</span>
            </button>
            <button onclick="openInterPbsCollectionModal(${r.loanId})" class="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[11px] font-bold shadow-sm transition flex items-center space-x-1 cursor-pointer" title="অন্য পবিস থেকে প্রাপ্ত কিস্তির টাকা পোস্টিং">
              <i data-lucide="check" class="w-3 h-3"></i>
              <span>পোস্টিং</span>
            </button>
            <button onclick="toggleTransferredLoanSalaryDeduction(${r.loanId}, ${!r.salaryDeductionSuspended})" class="px-2.5 py-1 ${r.salaryDeductionSuspended ? 'bg-blue-700 hover:bg-blue-800' : 'bg-rose-700 hover:bg-rose-800'} text-white rounded-lg text-[11px] font-bold shadow-sm transition flex items-center space-x-1 cursor-pointer" title="${r.salaryDeductionSuspended ? 'বেতন কর্তন পুনরায় চালু করুন' : 'বেতন কর্তন স্থগিত করুন'}">
              <i data-lucide="${r.salaryDeductionSuspended ? 'play' : 'pause'}" class="w-3 h-3"></i>
              <span>${r.salaryDeductionSuspended ? 'কর্তন চালু' : 'কর্তন স্থগিত'}</span>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

function renderTransferredPbsSummary(pbsSummary) {
  const container = document.getElementById('transferredPbsSummaryContainer');
  if (!container) return;

  if (!pbsSummary || pbsSummary.length === 0) {
    container.innerHTML = `<div class="p-4 text-center text-gray-400 text-xs col-span-full">কোনো পবিসের তথ্য নেই।</div>`;
    return;
  }

  container.innerHTML = pbsSummary.map(p => {
    const safePbsName = (p.pbsName || '').replace(/'/g, "\\'");
    return `
      <div onclick="filterBySpecificPbs('${safePbsName}')" class="bg-gradient-to-br from-purple-50/60 to-white p-3.5 rounded-xl border border-purple-200/80 hover:border-purple-400 hover:shadow-md cursor-pointer transition space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="font-bold text-xs text-purple-950 truncate max-w-[170px]" title="${p.pbsName}">${p.pbsName}</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">${toBn(p.borrowerCount)} জন</span>
        </div>
        <div class="text-[11px] text-gray-600 flex justify-between">
          <span>বকেয়া কিস্তি:</span>
          <strong class="text-red-700 font-mono">${toBn(p.totalDueMonths)} মাস</strong>
        </div>
        <div class="text-[11px] text-gray-600 flex justify-between">
          <span>বকেয়া টাকা:</span>
          <strong class="text-rose-700 font-mono font-bold">${formatBDT(p.totalOverdueAmount)}</strong>
        </div>
        <div class="text-[11px] text-gray-600 flex justify-between pt-1 border-t border-purple-100">
          <span>মোট অবশিষ্ট ঋণ:</span>
          <strong class="text-emerald-900 font-mono font-semibold">${formatBDT(p.totalBalance)}</strong>
        </div>
      </div>
    `;
  }).join('');
}

function filterBySpecificPbs(pbsName) {
  const sel = document.getElementById('transferredPbsFilter');
  if (sel) {
    sel.value = pbsName;
    filterTransferredLoans();
  }
}

function filterTransferredLoans() {
  if (!transferredLoansData || !transferredLoansData.records) {
    loadTransferredLoans();
    return;
  }

  const pbsFilter = (document.getElementById('transferredPbsFilter')?.value || '').trim();
  const search = (document.getElementById('transferredSearchInput')?.value || '').trim().toLowerCase();
  const overdueOnly = document.getElementById('transferredOverdueOnlyFilter')?.checked;

  let filtered = transferredLoansData.records;

  if (pbsFilter) {
    filtered = filtered.filter(r => r.currentPostingPbs === pbsFilter);
  }

  if (overdueOnly) {
    filtered = filtered.filter(r => r.dueMonthsCount > 0);
  }

  if (search) {
    filtered = filtered.filter(r =>
      (r.empName && r.empName.toLowerCase().includes(search)) ||
      (r.empCode && r.empCode.toLowerCase().includes(search)) ||
      (r.loanNo && r.loanNo.toLowerCase().includes(search)) ||
      (r.currentPostingPbs && r.currentPostingPbs.toLowerCase().includes(search))
    );
  }

  renderTransferredLoansTable(filtered);
}

function resetTransferredLoansFilter() {
  const pbsSel = document.getElementById('transferredPbsFilter');
  const search = document.getElementById('transferredSearchInput');
  const overdueOnly = document.getElementById('transferredOverdueOnlyFilter');

  if (pbsSel) pbsSel.value = '';
  if (search) search.value = '';
  if (overdueOnly) overdueOnly.checked = false;

  loadTransferredLoans();
}

function openInterPbsCollectionModal(loanId) {
  if (!transferredLoansData || !transferredLoansData.records) {
    showToast('লোন তথ্য প্রস্তুত নেই।', 'error');
    return;
  }

  const record = transferredLoansData.records.find(r => r.loanId === loanId);
  if (!record) {
    showToast('ঋণ রেকর্ডটি পাওয়া যায়নি।', 'error');
    return;
  }

  // Populate strip
  document.getElementById('ipcLoanId').value = record.loanId;
  document.getElementById('ipcEmpName').textContent = record.empName;
  document.getElementById('ipcPostingPbs').textContent = record.currentPostingPbs;
  document.getElementById('ipcEmpCode').textContent = record.empCode;
  document.getElementById('ipcDesignation').textContent = record.designation;
  document.getElementById('ipcLoanNo').textContent = record.loanNo;
  document.getElementById('ipcMonthlyInstallment').textContent = formatBDT(record.monthlyInstallment) + ' টাকা';
  document.getElementById('ipcPrincipalBal').textContent = formatBDT(record.principalBalance);
  document.getElementById('ipcInterestBal').textContent = formatBDT(record.interestBalance);
  document.getElementById('ipcTotalBal').textContent = formatBDT(record.totalBalance);
  document.getElementById('ipcAdvanceBal').textContent = formatBDT(record.advanceBalance || 0);

  // Defaults
  document.getElementById('ipcReceiptDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('ipcVoucherNo').value = '';
  document.getElementById('ipcRemarks').value = '';
  document.getElementById('ipcRemarks').dataset.userEdited = 'false';
  document.getElementById('ipcManualPostingToggle').checked = false;
  document.getElementById('ipcManualMonthPicker').value = new Date().toISOString().slice(0, 7);
  document.getElementById('ipcManualMonthsList').replaceChildren();
  document.getElementById('ipcManualAmount').value = record.monthlyInstallment;
  addIpcManualMonth();
  toggleIpcManualPosting();

  // Populate months checklist
  currentIpcMonths = record.dueMonthsList || [];
  const checklistContainer = document.getElementById('ipcMonthsChecklist');

  if (currentIpcMonths.length === 0) {
    checklistContainer.innerHTML = `
      <div class="col-span-full text-center py-4 text-emerald-700 font-medium text-xs">
        এই ঋণে বর্তমানে কোনো বকেয়া কিস্তি নেই। তবে অগ্রিম কিস্তি হিসেবে চলতি/পরবর্তী মাস পরিশোধ করতে পারেন।
      </div>
    `;
    document.getElementById('ipcTotalAmount').value = record.monthlyInstallment;
    document.getElementById('ipcCalculatedSummaryText').textContent = '১ টি অগ্রিম কিস্তি (ঐচ্ছিক)';
    updateIpcAutoRemarks([]);
  } else {
    checklistContainer.innerHTML = currentIpcMonths.map(m => {
      return `
        <label class="flex items-center space-x-2 bg-white p-2 rounded-lg border border-gray-200 cursor-pointer hover:border-emerald-500 text-xs">
          <input type="checkbox" name="ipcMonthItem" value="${m}" checked onchange="onIpcMonthCheckboxChange()" class="rounded text-emerald-600 focus:ring-emerald-500">
          <span class="font-mono font-bold text-gray-800">${formatBengaliMonth(m)}</span>
        </label>
      `;
    }).join('');

    onIpcMonthCheckboxChange();
  }

  openModal('interPbsCollectionModal');
}

function toggleIpcManualPosting() {
  const manual = document.getElementById('ipcManualPostingToggle')?.checked || false;
  document.getElementById('ipcStandardPostingFields')?.classList.toggle('hidden', manual);
  document.getElementById('ipcManualPostingFields')?.classList.toggle('hidden', !manual);
  document.getElementById('ipcTotalAmount').required = !manual;
  document.getElementById('ipcManualAmount').required = manual;
  updateIpcAutoRemarks(manual
    ? Array.from(document.querySelectorAll('#ipcManualMonthsList [data-month]')).map(item => item.dataset.month)
    : Array.from(document.querySelectorAll('input[name="ipcMonthItem"]:checked')).map(input => input.value));
}

function addIpcManualMonth() {
  const monthPicker = document.getElementById('ipcManualMonthPicker');
  const month = monthPicker?.value;
  const monthsList = document.getElementById('ipcManualMonthsList');
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    showToast('একটি বৈধ কিস্তির মাস নির্বাচন করুন।', 'warning');
    return;
  }

  if (Array.from(monthsList.querySelectorAll('[data-month]')).some(item => item.dataset.month === month)) {
    showToast('এই মাসটি ইতিমধ্যে নির্বাচন করা হয়েছে।', 'warning');
    return;
  }

  const item = document.createElement('div');
  item.dataset.month = month;
  item.className = 'flex items-center gap-2 p-2 bg-white border border-blue-300 rounded-lg';

  const label = document.createElement('span');
  label.className = 'flex-1 text-xs font-semibold text-blue-900';
  label.textContent = formatBengaliMonth(month);
  const amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.min = '0.01';
  amountInput.step = '0.01';
  amountInput.dataset.monthAmount = '';
  amountInput.setAttribute('aria-label', `${formatBengaliMonth(month)} মাসের টাকার পরিমাণ`);
  amountInput.className = 'w-28 p-1.5 border border-gray-300 rounded text-xs font-mono text-right';
  amountInput.addEventListener('input', () => {
    item.dataset.autoSplit = 'false';
    updateIpcManualTotalFromMonthAmounts();
  });
  const amountField = document.createElement('div');
  amountField.className = 'flex items-center gap-1';
  const currencyLabel = document.createElement('span');
  currencyLabel.className = 'text-[10px] text-gray-600';
  currencyLabel.textContent = 'টাকা';
  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'text-red-600 hover:text-red-800 font-bold';
  removeButton.setAttribute('aria-label', `${formatBengaliMonth(month)} মাস সরান`);
  removeButton.textContent = '×';
  removeButton.addEventListener('click', () => {
    item.remove();
    distributeIpcManualTotal();
    if (document.getElementById('ipcManualPostingToggle')?.checked) {
      updateIpcAutoRemarks(Array.from(monthsList.querySelectorAll('[data-month]')).map(monthItem => monthItem.dataset.month));
    }
  });

  amountField.append(amountInput, currencyLabel);
  item.append(label, amountField, removeButton);
  monthsList.append(item);
  distributeIpcManualTotal();
  if (document.getElementById('ipcManualPostingToggle')?.checked) {
    updateIpcAutoRemarks(Array.from(monthsList.querySelectorAll('[data-month]')).map(monthItem => monthItem.dataset.month));
  }
}

function distributeIpcManualTotal() {
  const amountInput = document.getElementById('ipcManualAmount');
  const totalAmount = parseFloat(amountInput?.value);
  const totalCents = Number.isFinite(totalAmount) && totalAmount > 0 ? Math.round(totalAmount * 100) : 0;
  const monthItems = Array.from(document.querySelectorAll('#ipcManualMonthsList [data-month]'))
    .sort((a, b) => a.dataset.month.localeCompare(b.dataset.month));
  const basePerMonthCents = monthItems.length
    ? Math.floor(totalCents / 100 / monthItems.length) * 100
    : 0;

  monthItems.forEach((item, index) => {
    const cents = index === monthItems.length - 1
      ? totalCents - (basePerMonthCents * (monthItems.length - 1))
      : basePerMonthCents;
    item.querySelector('[data-month-amount]').value = (cents / 100).toFixed(2);
    item.dataset.autoSplit = 'true';
  });
  updateIpcManualAmountSummary();
}

function updateIpcManualTotalFromMonthAmounts() {
  const cents = Array.from(document.querySelectorAll('#ipcManualMonthsList [data-month-amount]'))
    .reduce((sum, input) => {
      const amount = parseFloat(input.value);
      return sum + (Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : 0);
    }, 0);
  document.getElementById('ipcManualAmount').value = (cents / 100).toFixed(2);
  updateIpcManualAmountSummary();
}

function updateIpcManualAmountSummary() {
  const monthItems = Array.from(document.querySelectorAll('#ipcManualMonthsList [data-month]'))
    .sort((a, b) => a.dataset.month.localeCompare(b.dataset.month));
  const summary = document.getElementById('ipcManualAmountSummary');
  if (!summary) return;

  if (monthItems.length === 0) {
    summary.textContent = 'পোস্টিংয়ের জন্য অন্তত একটি মাস যোগ করুন।';
    return;
  }

  const amounts = monthItems.map(item => {
    const amount = parseFloat(item.querySelector('[data-month-amount]').value);
    return Number.isFinite(amount) ? amount : 0;
  });
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  const totalCents = Math.round(total * 100);
  const hasRemainder = monthItems.every(item => item.dataset.autoSplit === 'true')
    && totalCents % (100 * monthItems.length) !== 0;
  const remainderMessage = hasRemainder
    ? ' ভাগের ভগ্নাংশ শেষ মাসের অঙ্কে সমন্বয় করা হয়েছে।'
    : '';
  summary.textContent = `${toBn(monthItems.length)} মাসের মোট: ${formatIpcAmount(total)} টাকা। মাসভিত্তিক অঙ্ক সম্পাদনাযোগ্য।${remainderMessage}`;
}

function updateIpcAutoRemarks(months) {
  const remarksInput = document.getElementById('ipcRemarks');
  if (!remarksInput || remarksInput.dataset.userEdited === 'true') return;
  remarksInput.value = formatIpcMonthsRange(months);
}

async function toggleTransferredLoanSalaryDeduction(loanId, suspended) {
  const record = transferredLoansData?.records?.find(r => r.loanId === loanId)
    || (state.loans || []).find(loan => loan.id === loanId);
  if (!record) {
    showToast('ঋণ রেকর্ডটি পাওয়া যায়নি।', 'error');
    return;
  }

  const action = suspended ? 'স্থগিত' : 'পুনরায় চালু';
  const employeeName = record.empName || record.emp_name;
  const loanNo = record.loanNo || record.loan_no;
  if (!await confirmWithSweetAlert(`${employeeName}-এর ঋণ নং ${loanNo}-এর বেতন কিস্তি কর্তন ${action} করবেন?`)) {
    return;
  }

  try {
    const result = await API.put('/transferred-loans/salary-deduction-suspension', {
      loanId,
      suspended
    });
    if (!result?.success) {
      showToast(result?.message || 'বেতন কর্তনের অবস্থা আপডেট করা যায়নি।', 'error');
      return;
    }
    showToast(result.message, 'success');
    if (typeof loadTransferredLoans === 'function' && transferredLoansData?.records?.some(r => r.loanId === loanId)) {
      await loadTransferredLoans();
    }
    if (typeof loadLoans === 'function') loadLoans();
  } catch (error) {
    console.error('toggleTransferredLoanSalaryDeduction error:', error);
    showToast(error.message || 'বেতন কর্তনের অবস্থা আপডেট করা যায়নি।', 'error');
  }
}

function toggleLoanSalaryDeduction(loanId, suspended) {
  toggleTransferredLoanSalaryDeduction(loanId, suspended);
}

function onIpcMonthCheckboxChange() {
  const checkboxes = document.querySelectorAll('input[name="ipcMonthItem"]:checked');
  const selectedMonths = Array.from(checkboxes).map(c => c.value);
  updateIpcAutoRemarks(document.getElementById('ipcManualPostingToggle')?.checked
    ? Array.from(document.querySelectorAll('#ipcManualMonthsList [data-month]')).map(item => item.dataset.month)
    : selectedMonths);
  const loanId = parseInt(document.getElementById('ipcLoanId')?.value, 10);
  const record = transferredLoansData?.records?.find(r => r.loanId === loanId);
  const installment = record ? record.monthlyInstallment : 0;
  const totalAmount = selectedMonths.length * installment;

  document.getElementById('ipcTotalAmount').value = totalAmount;
  document.getElementById('ipcCalculatedSummaryText').textContent =
    `${toBn(selectedMonths.length)} টি মাস নির্বাচিত | মোট কিস্তি: ${formatBDT(totalAmount)} টাকা`;

  const toggleBtn = document.getElementById('ipcToggleMonthsBtn');
  const allCheckboxes = document.querySelectorAll('input[name="ipcMonthItem"]');
  if (toggleBtn) {
    if (checkboxes.length === allCheckboxes.length) {
      toggleBtn.textContent = 'সকল নির্বাচন উঠিয়ে দিন';
    } else {
      toggleBtn.textContent = 'সকল নির্বাচন করুন';
    }
  }
}

function toggleAllIpcMonths() {
  const allCheckboxes = document.querySelectorAll('input[name="ipcMonthItem"]');
  const checked = document.querySelectorAll('input[name="ipcMonthItem"]:checked');
  const shouldCheck = checked.length < allCheckboxes.length;

  allCheckboxes.forEach(c => {
    c.checked = shouldCheck;
  });

  onIpcMonthCheckboxChange();
}

async function submitInterPbsCollection(event) {
  event.preventDefault();
  const loanId = document.getElementById('ipcLoanId').value;
  const receiptDate = document.getElementById('ipcReceiptDate').value;
  const voucherNo = document.getElementById('ipcVoucherNo').value;
  const remarks = document.getElementById('ipcRemarks').value;
  const manualPosting = document.getElementById('ipcManualPostingToggle').checked;
  const totalAmount = parseFloat(document.getElementById(manualPosting ? 'ipcManualAmount' : 'ipcTotalAmount').value);
  const checkboxes = document.querySelectorAll('input[name="ipcMonthItem"]:checked');
  const selectedMonths = manualPosting
    ? Array.from(document.querySelectorAll('#ipcManualMonthsList [data-month]'))
      .map(item => item.dataset.month)
      .sort()
    : Array.from(checkboxes).map(c => c.value);

  if (selectedMonths.length === 0 || !selectedMonths[0]) {
    showToast('কমপক্ষে একটি মাস নির্বাচন করুন।', 'warning');
    return;
  }

  if (manualPosting && selectedMonths.some(month => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month))) {
    showToast('নির্বাচিত মাসগুলোর মধ্যে একটি অবৈধ। আবার মাস নির্বাচন করুন।', 'warning');
    return;
  }

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
    showToast('সঠিক টাকার পরিমাণ প্রদান করুন।', 'warning');
    return;
  }

  const manualAmounts = manualPosting
    ? Array.from(document.querySelectorAll('#ipcManualMonthsList [data-month]'))
      .sort((a, b) => a.dataset.month.localeCompare(b.dataset.month))
      .map(item => Math.round(parseFloat(item.querySelector('[data-month-amount]').value) * 100) / 100)
    : [];

  if (manualPosting && (
    manualAmounts.length !== selectedMonths.length
    || manualAmounts.some(amount => !Number.isFinite(amount) || amount <= 0)
    || manualAmounts.reduce((sum, amount) => sum + Math.round(amount * 100), 0) !== Math.round(totalAmount * 100)
  )) {
    showToast('প্রতিটি মাসের বৈধ টাকার অঙ্ক দিন এবং মোট অঙ্কের সাথে মিলিয়ে নিন।', 'warning');
    return;
  }

  const record = transferredLoansData?.records?.find(r => r.loanId == loanId);
  if (manualPosting) {
    const monthBreakdown = selectedMonths.map((month, index) =>
        `${formatBengaliMonth(month)}: ${formatIpcAmount(manualAmounts[index])} টাকা`
      ).join(' | ');
    const excess = record ? Math.max(0, totalAmount - record.totalBalance) : 0;
    const excessNote = excess > 0
        ? ` ঋণের স্থিতির অতিরিক্ত ${formatIpcAmount(excess)} টাকা অগ্রিম জমা হবে; ভবিষ্যৎ কিস্তিতে স্বয়ংক্রিয়ভাবে সমন্বয় হবে না।`
      : '';
    const proceed = await confirmWithSweetAlert(
        `মাসভিত্তিক পোস্টিং যাচাই করুন: ${monthBreakdown}। মোট: ${formatIpcAmount(totalAmount)} টাকা।${excessNote}`,
      {
        title: 'পোস্টিং নিশ্চিত করুন',
        icon: 'question',
        confirmButtonText: 'হ্যাঁ, পোস্ট করুন',
        confirmButtonColor: '#2563eb'
      }
    );
    if (!proceed) return;
  }

  const submitBtn = document.getElementById('ipcSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin mr-1"></i> পোস্টিং হচ্ছে...`;
    if (window.lucide) lucide.createIcons();
  }

  try {
    const res = await API.post('/transferred-loans/post-collection', {
      loan_id: loanId,
      source_pbs_name: record ? record.currentPostingPbs : '',
      receipt_date: receiptDate,
      voucher_no: voucherNo,
      months: selectedMonths,
      monthly_amounts: manualAmounts,
      total_amount: totalAmount,
      manual_posting: manualPosting,
      remarks: remarks
    });

    if (res.success) {
      closeModal('interPbsCollectionModal');
      showToast(res.message || 'কিস্তি পোস্টিং সফলভাবে সম্পন্ন হয়েছে।', 'success');
      loadTransferredLoans();
      if (typeof loadLoans === 'function') loadLoans();
      if (typeof loadDashboard === 'function') loadDashboard();
    } else {
      showToast(res.message || 'পোস্টিং ব্যর্থ হয়েছে।', 'error');
    }
  } catch (err) {
    console.error('submitInterPbsCollection error:', err);
    showToast(err.message || 'পোস্টিং প্রক্রিয়া সম্পন্ন করা যায়নি।', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4 mr-1"></i> কিস্তি পোস্টিং সম্পন্ন করুন`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function openDemandLetterModal(loanId) {
  const title = document.getElementById('demandLetterModalTitle');
  if (title) title.textContent = 'সরকারি তাগাদা পত্র (Official BREB Demand Letter Preview)';
  openModal('demandLetterModal');
  const sheet = document.getElementById('demandLetterPaperSheet');
  if (sheet) {
    sheet.innerHTML = `
      <div class="text-center py-16 text-gray-400">
        <div class="w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p class="text-sm font-semibold text-gray-700">বাপবিবোর্ড প্রমিত তাগাদা পত্র তৈরি করা হচ্ছে...</p>
      </div>
    `;
  }

  try {
    const record = transferredLoansData?.records?.find(r => r.loanId === loanId);

    // Call generate-demand-letter
    const genRes = await API.post('/transferred-loans/generate-demand-letter', {
      loan_id: loanId,
      due_months_count: record ? record.dueMonthsCount : 1,
      due_period_text: record ? record.duePeriodText : '',
      total_due_amount: record ? record.overdueAmount : (record?.monthlyInstallment || 0)
    });

    if (!genRes.success) {
      if (sheet) {
        sheet.innerHTML = `<div class="p-8 text-center text-red-600">${genRes.message || 'তাগাদা পত্র তৈরি করা যায়নি।'}</div>`;
      }
      return;
    }

    // Fetch printable letter details
    const letterRes = await API.get(`/transferred-loans/demand-letter/${genRes.letterId}`);
    if (letterRes.success) {
      currentDemandLetterData = letterRes;
      renderDemandLetterPaper(letterRes);
    } else {
      if (sheet) {
        sheet.innerHTML = `<div class="p-8 text-center text-red-600">${letterRes.message}</div>`;
      }
    }
  } catch (err) {
    console.error('openDemandLetterModal error:', err);
    if (sheet) {
      sheet.innerHTML = `<div class="p-8 text-center text-red-600">${err.message || 'সার্ভার সংযোগ ত্রুটি'}</div>`;
    }
  }
}

async function openConsolidatedDemandLetter() {
  const title = document.getElementById('demandLetterModalTitle');
  if (title) title.textContent = 'সকল পবিসের সম্মিলিত তাগাদা পত্র';
  openModal('demandLetterModal');

  const sheet = document.getElementById('demandLetterPaperSheet');
  if (sheet) {
    sheet.innerHTML = `
      <div class="text-center py-16 text-gray-400">
        <div class="w-8 h-8 border-4 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p class="text-sm font-semibold text-gray-700">সকল পবিসের বকেয়া যাচাই করে সম্মিলিত তাগাদা পত্র প্রস্তুত করা হচ্ছে...</p>
      </div>
    `;
  }

  try {
    const result = await API.post('/transferred-loans/generate-consolidated-demand-letter', {});
    if (!result.success) {
      throw new Error(result.message || 'সম্মিলিত তাগাদা পত্র তৈরি করা যায়নি।');
    }
    currentDemandLetterData = result;
    renderDemandLetterPaper(result);
    showToast(result.message, 'success');
  } catch (error) {
    console.error('openConsolidatedDemandLetter error:', error);
    if (sheet) {
      sheet.innerHTML = `<div class="p-8 text-center text-red-600">${escapeHtml(error.message || 'সার্ভার সংযোগ ত্রুটি')}</div>`;
    }
    showToast(error.message || 'সম্মিলিত তাগাদা পত্র তৈরি করা যায়নি।', 'error');
  }
}

function renderDemandLetterPaper(data) {
  const sheet = document.getElementById('demandLetterPaperSheet');
  if (!sheet) return;

  if (data.consolidated) {
    renderConsolidatedDemandLetterPaper(data, sheet);
    return;
  }

  const letter = data.letter;
  const own = data.ownPbs || {};
  const target = data.targetPbs || {};
  const dueList = data.dueMonthsDetailed || [];

  const ownPbsName = own.pbs_name || 'গাজীপুর পল্লী বিদ্যুৎ সমিতি-২';
  const ownAddress = own.address || 'রাজেন্দ্রপুর, গাজীপুর';
  const agmName = own.agm_finance_name || 'মোঃ আরিফুল ইসলাম';
  const gmName = own.gm_name || 'মোল্লা মোঃ আবুল কালাম আজাদ';
  const bankName = own.bank_name || 'রূপালী ব্যাংক পিএলসি, রাজেন্দ্রপুর শাখা';
  const accountNo = own.account_no || '১০০১০০২০০১';
  const routingNo = own.routing_no || '১৯০২৬০৭৮';

  const rowsTr = dueList.map((d, i) => `
    <tr class="border-b border-gray-400">
      <td class="py-1 px-3 text-center border border-gray-400 font-mono">${toBn(i + 1)}</td>
      <td class="py-1 px-3 text-center border border-gray-400 font-bold">${d.monthFormatted}</td>
      <td class="py-1 px-3 text-right border border-gray-400 font-mono font-bold">${formatBDT(d.installment)}</td>
      <td class="py-1 px-3 text-center border border-gray-400 text-xs">${d.remarks || 'বেতন হতে অকর্তিত'}</td>
    </tr>
  `).join('');

  sheet.innerHTML = `
    <!-- Top Header -->
    ${renderPbsLetterhead(own)}

    <!-- Memo and Date Line -->
    <div class="flex justify-between items-start text-xs font-semibold pt-1">
      <div>
        <span>স্মারক নং: </span>
        <strong class="font-mono text-gray-900">${letter.memo_no}</strong>
      </div>
      <div class="text-right">
        <div>তারিখ: <strong>${toBengaliCalendarDate(letter.letter_date)}</strong></div>
        <div class="text-[11px] text-gray-600 font-mono">${data.letterDateFormatted || letter.letter_date} খ্রি:</div>
      </div>
    </div>

    <!-- Recipient -->
    <div class="text-xs space-y-0.5 pt-2">
      <p class="font-bold">প্রাপক:</p>
      <p class="font-bold text-gray-900">সিনিয়র জেনারেল ম্যানেজার / জেনারেল ম্যানেজার</p>
      <p class="font-semibold text-gray-800">${letter.target_pbs_name}</p>
      <p class="text-gray-600">${target.address || 'সংশ্লিষ্ট পবিস সদর দপ্তর'}</p>
    </div>

    <!-- Subject & Reference -->
    <div class="space-y-1 pt-1">
      <div class="text-xs font-bold text-gray-950 leading-relaxed bg-gray-50 p-2 rounded border border-gray-200">
        <span class="underline">বিষয়:</span> জনাব <strong>${letter.employee_name}</strong>, পদবী: <strong>${letter.designation}</strong> (পে আইডি: <strong>${letter.emp_code}</strong>)-এর গৃহ নির্মাণ ঋণের বকেয়া কিস্তির টাকা কর্তনপূর্বক প্রেরণ প্রসঙ্গে।
      </div>
      <div class="text-[11px] text-gray-700 pl-2">
        <span>সূত্র: অত্র পবিসের ঋণ মঞ্জুরি স্মারক নং: ${letter.sanction_no || letter.loan_no}, তারিখ: ${data.disbursementDateFormatted || '-'};</span>
      </div>
    </div>

    <!-- Letter Body -->
    <div class="text-xs text-gray-900 text-justify leading-relaxed space-y-3 pt-1">
      <p>
        মহোদয়,<br>
        উপর্যুক্ত বিষয় ও সূত্রের প্রেক্ষিতে জানানো যাচ্ছে যে, জনাব <strong>${letter.employee_name}</strong>, পদবী: <strong>${letter.designation}</strong>, অত্র পবিসে কর্মরত থাকাকালীন তাঁর অনুকূলে সর্বমোট <strong>${formatBDT(letter.disbursed_amount)}</strong> টাকা গৃহ নির্মাণ ঋণ মঞ্জুর ও বিতরণ করা হয়। পরবর্তীতে তিনি অত্র পবিস হতে বদলি হয়ে আপনার নিয়ন্ত্রণাধীন পল্লী বিদ্যুৎ সমিতিতে যোগদান করেছেন।
      </p>
      <p>
        নীতিমালা ও মঞ্জুরির শর্তানুযায়ী তাঁর বেতন-ভাতা হতে প্রতি মাসে নিয়মিত <strong>${formatBDT(letter.monthly_installment)}</strong> টাকা হারে গৃহ নির্মাণ ঋণের কিস্তি কর্তন করে অত্র পবিসের অনুকূলে প্রেরণের বিধান রয়েছে। কিন্তু অত্র পবিসের হিসাব বিবরণী পর্যালোচনায় দেখা যায় যে, বিগত <strong>${toBn(letter.due_months_count)}</strong> মাস যাবৎ (<strong>${letter.due_period_text}</strong>) উক্ত কর্মচারীর বেতন হতে কিস্তির অর্থ কর্তনপূর্বক অত্র পবিসে প্রেরণ করা হয়নি। ফলে অদ্যবধি তাঁর বকেয়া কিস্তির সর্বমোট পাওনা দাঁড়িয়েছে <strong>${formatBDT(letter.total_due_amount)}</strong> টাকা (কথায়: <strong>${letter.amount_in_words}</strong> মাত্র)।
      </p>

      <!-- Due Breakdown Table -->
      <div class="py-1">
        <p class="font-bold text-gray-800 mb-1 text-[11px]">বকেয়া কিস্তিসমূহের মাসওয়ারী বিবরণ:</p>
        <table class="w-full border-collapse border border-gray-400 text-xs text-left">
          <thead>
            <tr class="bg-gray-100 font-bold border-b border-gray-400 text-gray-800">
              <th class="py-1.5 px-3 text-center border border-gray-400 w-12">ক্র: নং</th>
              <th class="py-1.5 px-3 text-center border border-gray-400">বকেয়া কিস্তির মাস</th>
              <th class="py-1.5 px-3 text-right border border-gray-400 w-36">কিস্তির পরিমাণ (টাকা)</th>
              <th class="py-1.5 px-3 text-center border border-gray-400">মন্তব্য</th>
            </tr>
          </thead>
          <tbody>
            ${rowsTr}
          </tbody>
          <tfoot>
            <tr class="bg-gray-50 font-bold border-t-2 border-gray-800">
              <td colspan="2" class="py-1.5 px-3 text-center border border-gray-400 font-bold">সর্বমোট বকেয়া পাওনা</td>
              <td class="py-1.5 px-3 text-right border border-gray-400 font-mono text-sm font-black text-gray-950">${formatBDT(letter.total_due_amount)}</td>
              <td class="py-1.5 px-3 text-center border border-gray-400"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p>
        এমতাবস্থায়, ঋণ সমন্বয় নিশ্চিতকরণার্থে উক্ত কর্মচারীর বকেয়া কিস্তির সর্বমোট <strong>${formatBDT(letter.total_due_amount)}</strong> টাকা অবিলম্বে তাঁর মাসিক বেতন হতে কর্তনপূর্বক বিইএফটিএন (BEFTN)/এনপিএসবি (NPSB)/অনলাইন ব্যাংকিং মাধ্যমে অত্র পবিসের নিম্নোক্ত ব্যাংক হিসাব নম্বরে প্রেরণের প্রয়োজনীয় ব্যবস্থা গ্রহণের জন্য বিনীত অনুরোধ করা হলো:
      </p>

      <!-- Bank Details Box -->
      <div class="bg-gray-50 border border-gray-300 rounded p-3 text-xs space-y-1 font-mono text-gray-900 max-w-lg mx-auto">
        <div class="flex justify-between"><span>ব্যাংক ও শাখার নাম:</span> <strong>${bankName}</strong></div>
        <div class="flex justify-between"><span>হিসাবের শিরোনাম:</span> <strong>${ownPbsName}</strong></div>
        <div class="flex justify-between"><span>ব্যাংক হিসাব নং:</span> <strong class="text-emerald-950 text-sm">${accountNo}</strong></div>
        <div class="flex justify-between"><span>রাউটিং নম্বর:</span> <strong>${routingNo}</strong></div>
      </div>
    </div>

    <!-- Official PBS 2-Officer Signatures -->
    <div class="demand-letter-gm-signature pt-4 pb-2 flex justify-between items-end text-xs text-gray-900">
      <div class="w-52"></div>

      <div class="demand-letter-signature-block text-center w-52 space-y-0.5">
        <div class="border-t border-gray-700 pt-1 font-bold text-gray-950">${gmName}</div>
        <div class="text-gray-700 font-semibold">${PBS_GENERAL_MANAGER_TITLE}</div>
        <div class="text-[11px] text-gray-500">${ownPbsName}</div>
      </div>
    </div>

    <!-- Copy Forward (অনুলিপি) -->
    <div class="pt-3 border-t border-gray-300 text-[11px] text-gray-700 space-y-1">
      <p class="font-bold">অনুলিপি (সদয় অবগতি ও প্রয়োজনীয় ব্যবস্থা গ্রহণের জন্য প্রেরিত হলো):</p>
      <p class="pl-3">১। পরিচালক, পবিস নিরীক্ষা পরিদপ্তর, বাংলাদেশ পল্লী বিদ্যুতায়ন বোর্ড, ঢাকা।</p>
      <p class="pl-3">২। জনাব ${letter.employee_name}, ${letter.designation}, ${letter.target_pbs_name} — বকেয়া কিস্তির টাকা জরুরি ভিত্তিতে পরিশোধের তাগিদসহ।</p>
      <p class="pl-3">৩। অফিস কপি / মাস্টার ফাইল।</p>
    </div>
    <div class="demand-letter-agm-signature grid grid-cols-2 pt-2 text-xs text-gray-700">
      <div></div>
      <div class="demand-letter-signature-block w-52 justify-self-end space-y-0.5 text-center">
        <div class="border-t border-gray-700 pt-1 font-bold text-gray-950">${agmName}</div>
        <div class="font-semibold">${PBS_AGM_FINANCE_TITLE}</div>
        <div class="text-[11px] text-gray-500">${ownPbsName}</div>
      </div>
    </div>
  `;
}

function renderConsolidatedDemandLetterPaper(data, sheet) {
  const letter = data.letter;
  const own = data.ownPbs || {};
  const rows = data.rows || [];
  const pbsSummary = data.pbsSummary || [];
  const ownPbsName = escapeHtml(own.pbs_name || 'গাজীপুর পল্লী বিদ্যুৎ সমিতি-২');
  const ownAddress = escapeHtml(own.address || '');
  const bankName = escapeHtml(own.bank_name || '');
  const bankBranch = escapeHtml(own.bank_branch || '');
  const accountNo = escapeHtml(own.account_no || '');
  const routingNo = escapeHtml(own.routing_no || '');

  const detailRows = rows.map((row, index) => `
    <tr class="border-b border-gray-400">
      <td class="py-1 px-1 text-center border border-gray-400">${toBn(index + 1)}</td>
      <td class="py-1 px-1 border border-gray-400">${escapeHtml(row.pbsName)}</td>
      <td class="py-1 px-1 border border-gray-400">
        <strong>${escapeHtml(row.employeeName)}</strong>
        <div class="text-[10px]">${escapeHtml(row.designation)} | পে আইডি: ${escapeHtml(row.empCode)}</div>
      </td>
      <td class="py-1 px-1 text-center border border-gray-400">${escapeHtml(row.loanNo)}</td>
      <td class="py-1 px-1 text-center border border-gray-400">${escapeHtml(row.duePeriodText)}</td>
      <td class="py-1 px-1 text-center border border-gray-400">${toBn(row.dueMonthsCount)}</td>
      <td class="py-1 px-1 text-right border border-gray-400">${formatBDT(row.monthlyInstallment)}</td>
      <td class="py-1 px-1 text-right border border-gray-400 font-bold">${formatBDT(row.overdueAmount)}</td>
    </tr>
  `).join('');

  sheet.innerHTML = `
    ${renderPbsLetterhead(own)}

    <div class="flex justify-between items-start text-xs font-semibold pt-1">
      <div>
        <div>স্মারক নং: <strong class="font-mono text-gray-900">${escapeHtml(letter.memo_no)}</strong></div>
        <div class="text-[11px] text-gray-600">পত্র নং: ${escapeHtml(letter.letter_no)}</div>
      </div>
      <div class="text-right">তারিখ: <strong>${toBengaliCalendarDate(letter.letter_date)}</strong></div>
    </div>

    <div class="text-xs space-y-0.5 pt-2">
      <p class="font-bold">প্রাপক:</p>
      <p class="font-bold text-gray-900">সিনিয়র জেনারেল ম্যানেজার / জেনারেল ম্যানেজার</p>
      <p class="text-gray-700">সংশ্লিষ্ট পল্লী বিদ্যুৎ সমিতি</p>
    </div>

    <div class="space-y-1 pt-1">
      <div class="text-xs font-bold text-gray-950 leading-relaxed bg-gray-50 p-2 rounded border border-gray-200">
        <span class="underline">বিষয়:</span> অত্র পবিস হতে বদলিকৃত ঋণগ্রহীতাদের বকেয়া কিস্তি কর্তনপূর্বক প্রেরণ প্রসঙ্গে।
      </div>
      <div class="text-xs text-gray-900 text-justify leading-relaxed pt-1 space-y-2">
        <p>মহোদয়,</p>
        <p>
          অত্র পল্লী বিদ্যুৎ সমিতি হতে গৃহ নির্মাণ ঋণ গ্রহণ করে আপনাদের পবিসে কর্মরত নিম্নবর্ণিত কর্মকর্তা/কর্মচারীদের বেতন হতে ঋণের মাসিক কিস্তি কর্তন করে অত্র পবিসের অনুকূলে প্রেরণের জন্য অনুরোধ করা যাচ্ছে। হিসাব পর্যালোচনায় ${toBn(pbsSummary.length)}টি পবিসের ${toBn(rows.length)} জন ঋণগ্রহীতার মোট ${toBn(letter.total_due_installments)}টি কিস্তি, সর্বমোট <strong>${formatBDT(letter.total_due_amount)}</strong> টাকা বকেয়া পাওয়া গেছে।
        </p>
      </div>
    </div>

    <div class="py-1">
      <p class="font-bold text-gray-800 mb-1 text-[11px]">ঋণগ্রহীতাভিত্তিক বকেয়া কিস্তির বিবরণ:</p>
      <table class="w-full border-collapse border border-gray-400 text-[10px] text-left">
        <thead>
          <tr class="bg-gray-100 font-bold border-b border-gray-400">
            <th class="py-1 px-1 text-center border border-gray-400">ক্র.</th>
            <th class="py-1 px-1 border border-gray-400">পবিস</th>
            <th class="py-1 px-1 border border-gray-400">কর্মচারী / পে আইডি</th>
            <th class="py-1 px-1 text-center border border-gray-400">ঋণ নং</th>
            <th class="py-1 px-1 text-center border border-gray-400">বকেয়ার সময়</th>
            <th class="py-1 px-1 text-center border border-gray-400">কিস্তি</th>
            <th class="py-1 px-1 text-right border border-gray-400">মাসিক কিস্তি</th>
            <th class="py-1 px-1 text-right border border-gray-400">বকেয়া টাকা</th>
          </tr>
        </thead>
        <tbody>
          ${detailRows}
          <tr class="bg-gray-50 font-bold">
            <td colspan="7" class="py-1 px-1 text-right border border-gray-400">সর্বমোট বকেয়া:</td>
            <td class="py-1 px-1 text-right border border-gray-400">${formatBDT(letter.total_due_amount)}</td>
          </tr>
        </tbody>
      </table>
      <p class="text-[11px] mt-1">কথায়: <strong>${escapeHtml(letter.amount_in_words)}</strong></p>
    </div>

    <p class="text-xs text-justify">
      উল্লিখিত বকেয়া কিস্তিসমূহ সংশ্লিষ্ট কর্মকর্তা/কর্মচারীদের বেতন হতে কর্তন করে অত্র পবিসের ব্যাংক হিসাবে প্রেরণ এবং পরবর্তী মাসগুলোতেও নিয়মিত কিস্তি কর্তন নিশ্চিত করার প্রয়োজনীয় ব্যবস্থা গ্রহণের জন্য অনুরোধ করা হলো।
    </p>

    <div class="bg-gray-50 border border-gray-300 rounded p-2 text-[11px] space-y-0.5 max-w-lg mx-auto">
      <div class="flex justify-between"><span>ব্যাংক ও শাখা:</span><strong>${bankName}${bankBranch ? `, ${bankBranch}` : ''}</strong></div>
      <div class="flex justify-between"><span>হিসাবের শিরোনাম:</span><strong>${ownPbsName}</strong></div>
      <div class="flex justify-between"><span>হিসাব নম্বর:</span><strong>${accountNo}</strong></div>
      <div class="flex justify-between"><span>রাউটিং নম্বর:</span><strong>${routingNo}</strong></div>
    </div>

    <div class="demand-letter-gm-signature pt-4 pb-2 flex justify-end text-xs text-gray-900">
      <div class="demand-letter-signature-block text-center w-52 space-y-0.5">
        <div class="border-t border-gray-700 pt-1 font-bold">${escapeHtml(own.gm_name || '')}</div>
        <div class="font-semibold">${PBS_GENERAL_MANAGER_TITLE}</div>
        <div class="text-[11px] text-gray-500">${ownPbsName}</div>
      </div>
    </div>

    <div class="pt-2 border-t border-gray-300 text-[11px] text-gray-700 space-y-1">
      <p class="font-bold">অনুলিপি (সদয় অবগতি ও প্রয়োজনীয় ব্যবস্থা গ্রহণের জন্য):</p>
      <p class="pl-3">১। পরিচালক, পবিস নিরীক্ষা পরিদপ্তর, বাংলাদেশ পল্লী বিদ্যুতায়ন বোর্ড, ঢাকা।</p>
      <p class="pl-3">২। অফিস কপি / মাস্টার ফাইল।</p>
    </div>
    <div class="demand-letter-agm-signature grid grid-cols-2 pt-2 text-xs text-gray-700">
      <div></div>
      <div class="demand-letter-signature-block w-52 justify-self-end space-y-0.5 text-center">
        <div class="border-t border-gray-700 pt-1 font-bold text-gray-950">${escapeHtml(own.agm_finance_name || '')}</div>
        <div class="font-semibold">${PBS_AGM_FINANCE_TITLE}</div>
        <div class="text-[11px] text-gray-500">${ownPbsName}${ownAddress ? `, ${ownAddress}` : ''}</div>
      </div>
    </div>
  `;
}

function printDemandLetterDocument() {
  const content = document.getElementById('demandLetterPaperSheet');
  if (!content) {
    showToast('প্রিন্ট করার জন্য কোনো পত্র প্রস্তুত নেই।', 'warning');
    return;
  }

  let printFrame = document.getElementById('demandLetterPrintFrame');
  if (printFrame) {
    printFrame.remove();
  }

  printFrame = document.createElement('iframe');
  printFrame.id = 'demandLetterPrintFrame';
  printFrame.style.position = 'fixed';
  printFrame.style.right = '0';
  printFrame.style.bottom = '0';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  printFrame.style.border = '0';
  printFrame.style.visibility = 'hidden';
  document.body.appendChild(printFrame);

  const doc = printFrame.contentWindow.document;
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
      <meta charset="UTF-8">
      <title>তাগাদা পত্র - ${currentDemandLetterData?.consolidated ? 'সকল পবিস' : (currentDemandLetterData?.letter?.employee_name || 'গৃহ ঋণ')}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 15mm 18mm 15mm 18mm;
        }
        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        body {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Kalpurush", "SolaimanLipi", Helvetica, Arial, sans-serif;
          color: #000;
          background: #fff;
          font-size: 10pt;
          line-height: 1.35;
        }
        p {
          margin: 0 0 4px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 5px 0;
          font-size: 9pt;
        }
        thead { display: table-header-group; }
        tr { page-break-inside: avoid; }
        th, td {
          border: 1px solid #444;
          padding: 3px 4px;
        }
        th {
          background-color: #f3f4f6;
          font-weight: bold;
        }
        .demand-letter-gm-signature,
        .demand-letter-agm-signature {
          display: flex;
          justify-content: flex-end;
          margin-top: 4px;
          padding-top: 4px !important;
          padding-bottom: 2px !important;
          page-break-inside: avoid;
        }
        .demand-letter-gm-signature > div:first-child,
        .demand-letter-agm-signature > div:first-child {
          display: none;
        }
        .demand-letter-signature-block {
          width: 13rem;
          text-align: center;
        }
        .demand-letter-signature-block > div:first-child {
          border-top: 1px solid #374151;
          padding-top: 0.25rem;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .font-bold { font-weight: bold; }
        .font-mono { font-family: monospace; }
        .border-t { border-top: 1px solid #666; }
      </style>
    </head>
    <body>
      ${content.innerHTML}
    </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();
  }, 250);
}

function openChangePostingPbsModal(employeeId, empName, currentPbs) {
  document.getElementById('cppEmployeeId').value = employeeId;
  document.getElementById('cppEmployeeName').value = empName;

  const sel = document.getElementById('cppPostingPbsSelect');
  if (sel) {
    const list = state.otherPbsList || [];
    let optHtml = `<option value="">--- পদায়নকৃত পবিস নির্বাচন করুন ---</option>`;
    list.forEach(p => {
      optHtml += `<option value="${p.pbs_name}">${p.pbs_name}</option>`;
    });
    sel.innerHTML = optHtml;
    sel.value = currentPbs || '';
  }

  openModal('changePostingPbsModal');
}

async function submitChangePostingPbs(event) {
  event.preventDefault();
  const employeeId = document.getElementById('cppEmployeeId').value;
  const currentPostingPbs = document.getElementById('cppPostingPbsSelect').value;

  if (!currentPostingPbs) {
    showToast('অনুগ্রহ করে পদায়নকৃত পবিস নির্বাচন করুন।', 'warning');
    return;
  }

  try {
    const res = await API.put('/transferred-loans/update-posting-pbs', {
      employeeId,
      currentPostingPbs
    });

    if (res.success) {
      closeModal('changePostingPbsModal');
      showToast(res.message || 'পদায়নকৃত পবিস সফলভাবে হালনাগাদ করা হয়েছে।', 'success');
      loadTransferredLoans();
      if (typeof loadEmployees === 'function') loadEmployees();
    } else {
      showToast(res.message || 'হালনাগাদ ব্যর্থ হয়েছে।', 'error');
    }
  } catch (err) {
    console.error('submitChangePostingPbs error:', err);
    showToast(err.message || 'সার্ভার সংযোগ ত্রুটি।', 'error');
  }
}

function exportTransferredLoansExcel() {
  const pbsFilter = document.getElementById('transferredPbsFilter')?.value || '';
  const overdueOnly = document.getElementById('transferredOverdueOnlyFilter')?.checked ? 'true' : 'false';

  const token = typeof API !== 'undefined' && API.getToken ? (API.getToken() || '') : '';
  const tokenParam = token ? `token=${encodeURIComponent(token)}` : '';
  const pbsParam = pbsFilter ? `&targetPbsName=${encodeURIComponent(pbsFilter)}` : '';
  const overdueParam = `&overdueOnly=${encodeURIComponent(overdueOnly)}`;

  const url = `/api/transferred-loans/export/excel?${tokenParam}${pbsParam}${overdueParam}`;
  window.open(url, '_blank');
}

// Window Exposures for Transferred Loans & Demand Letters
window.loadTransferredLoans = loadTransferredLoans;
window.renderTransferredLoansTable = renderTransferredLoansTable;
window.renderTransferredPbsSummary = renderTransferredPbsSummary;
window.filterBySpecificPbs = filterBySpecificPbs;
window.filterTransferredLoans = filterTransferredLoans;
window.resetTransferredLoansFilter = resetTransferredLoansFilter;
window.openInterPbsCollectionModal = openInterPbsCollectionModal;
window.onIpcMonthCheckboxChange = onIpcMonthCheckboxChange;
window.toggleAllIpcMonths = toggleAllIpcMonths;
window.submitInterPbsCollection = submitInterPbsCollection;
window.openDemandLetterModal = openDemandLetterModal;
window.openConsolidatedDemandLetter = openConsolidatedDemandLetter;
window.renderDemandLetterPaper = renderDemandLetterPaper;
window.printDemandLetterDocument = printDemandLetterDocument;
window.openChangePasswordModal = openChangePasswordModal;
window.openChangePostingPbsModal = openChangePostingPbsModal;
window.submitChangePostingPbs = submitChangePostingPbs;
window.exportTransferredLoansExcel = exportTransferredLoansExcel;

// Window Exposures for Repayments Multiple Delete
window.toggleRepaymentSelection = toggleRepaymentSelection;
window.toggleAllRepaymentsSelection = toggleAllRepaymentsSelection;
window.deleteSelectedRepayments = deleteSelectedRepayments;
window.updateRepaymentSelectionUI = updateRepaymentSelectionUI;
