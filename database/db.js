const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

function resolveDataDir() {
  if (process.env.PBS_DATA_DIR) {
    return path.resolve(process.env.PBS_DATA_DIR);
  }

  const isPackaged = __dirname.includes('caxa') || process.execPath.includes('caxa');
  if (isPackaged) {
    let hostDir = null;
    try {
      if (process.ppid) {
        const { execSync } = require('child_process');
        const parentPath = execSync(`powershell -NoProfile -Command "(Get-Process -Id ${process.ppid} -ErrorAction SilentlyContinue).Path"`, { timeout: 3000, encoding: 'utf8' }).trim();
        if (parentPath && fs.existsSync(parentPath)) {
          hostDir = path.dirname(parentPath);
        }
      }
    } catch (_) {}

    if (!hostDir && process.cwd() && !process.cwd().includes('caxa')) {
      hostDir = process.cwd();
    }

    if (hostDir) {
      return hostDir;
    }
  }

  return path.dirname(__dirname);
}

const dbDir = resolveDataDir();
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'pbs_house_loan.db');

// If target database does not exist, copy packaged template if available
if (!fs.existsSync(dbPath)) {
  const bundledDbPath = path.join(__dirname, 'pbs_house_loan.db');
  if (fs.existsSync(bundledDbPath) && bundledDbPath !== dbPath) {
    try {
      fs.copyFileSync(bundledDbPath, dbPath);
      console.log(`[Database] Bundled database seed copied to: ${dbPath}`);
    } catch (err) {
      console.warn(`[Database] Seed database copy note: ${err.message}`);
    }
  }
}

const db = new Database(dbPath);
db.dataDir = dbDir;
db.dbDir = dbDir;
db.dbPath = dbPath;

// Enable WAL mode for high concurrency and resilience
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initSchema() {
  db.exec(`
    -- PBS System Settings (নিজস্ব পবিস সম্পর্কিত তথ্য)
    CREATE TABLE IF NOT EXISTS pbs_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pbs_name TEXT NOT NULL DEFAULT 'পল্লী বিদ্যুৎ সমিতি',
      pbs_code TEXT DEFAULT '',
      address TEXT DEFAULT '',
      pbs_english_name TEXT DEFAULT '',
      letterhead_subtitle TEXT DEFAULT 'বাংলাদেশ পল্লী বিদ্যুতায়ন বোর্ড',
      letterhead_right_title TEXT DEFAULT 'সদর দপ্তর',
      letterhead_badge_text TEXT DEFAULT '',
      website TEXT DEFAULT '',
      logo_url TEXT DEFAULT '',
      memo_no_prefix TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      bank_name TEXT DEFAULT '',
      bank_branch TEXT DEFAULT '',
      account_no TEXT DEFAULT '',
      routing_no TEXT DEFAULT '',
      bank_advice_prepared_by_name TEXT DEFAULT '',
      bank_advice_verified_by_name TEXT DEFAULT '',
      agm_finance_name TEXT DEFAULT '',
      agm_finance_title TEXT DEFAULT 'সহকারী মহাব্যবস্থাপক (অর্থ-হিসাব)',
      dgm_name TEXT DEFAULT '',
      dgm_title TEXT DEFAULT 'উপ-মহাব্যবস্থাপক (সদর দপ্তর)',
      gm_name TEXT DEFAULT '',
      gm_title TEXT DEFAULT 'সিনিয়র জেনারেল ম্যানেজার',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Directory of Other PBSs (অন্যান্য পল্লী বিদ্যুৎ সমিতিসমূহের তথ্য ও ব্যাংক হিসাব)
    CREATE TABLE IF NOT EXISTS other_pbs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pbs_name TEXT NOT NULL UNIQUE,
      short_name TEXT,
      bank_name TEXT,
      bank_branch TEXT,
      account_no TEXT,
      routing_no TEXT,
      contact_person TEXT,
      phone TEXT,
      email TEXT,
      is_deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      deleted_by TEXT
    );

    -- Employees (কর্মকর্তা ও কর্মচারীগণ)
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      designation TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT 'জেনারেল/প্রশাসন',
      mobile TEXT,
      email TEXT,
      joining_date DATE,
      current_posting_pbs TEXT DEFAULT 'নিজস্ব পবিস',
      is_active INTEGER DEFAULT 1,
      is_deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      deleted_by TEXT
    );

    -- Users for Authentication & RBAC (লগইন ব্যবহারকারী)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'accounts', 'employee')),
      employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
      is_active INTEGER DEFAULT 1,
      is_deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      deleted_by TEXT
    );

    -- House Loans (গৃহ নির্মাণ ঋণ)
    -- Multi-loan per employee supported!
    CREATE TABLE IF NOT EXISTS loans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_no TEXT NOT NULL UNIQUE,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      loan_lot_name TEXT DEFAULT '১ম বরাদ্দ/লট',
      loan_source_type TEXT NOT NULL CHECK(loan_source_type IN ('OWN_PBS', 'OTHER_PBS')),
      origin_pbs_id INTEGER REFERENCES other_pbs(id) ON DELETE SET NULL,
      origin_pbs_name TEXT NOT NULL,
      sanction_no TEXT,
      sanction_date DATE NOT NULL,
      disbursement_date DATE NOT NULL,
      sanction_amount REAL NOT NULL,
      disbursed_amount REAL NOT NULL,
      monthly_installment REAL NOT NULL,
      salary_deduction_suspended INTEGER NOT NULL DEFAULT 0,
      interest_rate REAL NOT NULL, -- 8.0 for pre-2020-01-01, 7.0 for post-2020-01-01
      is_interest_applicable INTEGER NOT NULL DEFAULT 1, -- 1 for OWN_PBS, 0 for OTHER_PBS
      principal_balance REAL NOT NULL,
      interest_balance REAL NOT NULL DEFAULT 0.0,
      total_principal_paid REAL NOT NULL DEFAULT 0.0,
      total_interest_paid REAL NOT NULL DEFAULT 0.0,
      advance_balance REAL NOT NULL DEFAULT 0.0,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'CLOSED')),
      remarks TEXT,
      is_deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      deleted_by TEXT
    );

    -- Monthly Deductions / Repayments from Salary (বেতন থেকে কিস্তি কর্তন)
    CREATE TABLE IF NOT EXISTS repayments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL REFERENCES loans(id),
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      deduction_month TEXT NOT NULL, -- YYYY-MM e.g. 2024-05
      deduction_date DATE NOT NULL,
      voucher_no TEXT,
      total_amount REAL NOT NULL,
      principal_paid REAL NOT NULL DEFAULT 0.0,
      interest_paid REAL NOT NULL DEFAULT 0.0,
      advance_paid REAL NOT NULL DEFAULT 0.0,
      previous_principal_balance REAL NOT NULL,
      new_principal_balance REAL NOT NULL,
      previous_interest_balance REAL NOT NULL,
      new_interest_balance REAL NOT NULL,
      repayment_method TEXT DEFAULT 'SALARY_DEDUCTION',
      collection_batch_id TEXT,
      remittance_status TEXT DEFAULT 'NOT_APPLICABLE' CHECK(remittance_status IN ('NOT_APPLICABLE', 'PENDING', 'REMITTED')),
      bank_advice_id INTEGER REFERENCES bank_advices(id) ON DELETE SET NULL,
      principal_posting TEXT,
      interest_posting TEXT,
      remarks TEXT,
      is_deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      deleted_by TEXT
    );

    -- Monthly Interest Provision (মাসিক সুদ প্রভিশন)
    -- Applicable only for OWN_PBS loans
    CREATE TABLE IF NOT EXISTS interest_provisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_id INTEGER NOT NULL REFERENCES loans(id),
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      provision_month TEXT NOT NULL, -- YYYY-MM
      provision_date DATE NOT NULL,
      applied_rate REAL NOT NULL,
      principal_amount_on_date REAL NOT NULL,
      interest_amount REAL NOT NULL,
      previous_interest_balance REAL NOT NULL,
      new_interest_balance REAL NOT NULL,
      is_deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      deleted_by TEXT,
      UNIQUE(loan_id, provision_month)
    );

    -- Bank Advices & Remittance Letters (ব্যাংক অ্যাডভাইস এবং পবিসকে অবহিতকরণ পত্র)
    CREATE TABLE IF NOT EXISTS bank_advices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      advice_no TEXT NOT NULL UNIQUE,
      memo_no TEXT NOT NULL,
      advice_date DATE NOT NULL,
      target_pbs_id INTEGER REFERENCES other_pbs(id),
      target_pbs_name TEXT NOT NULL,
      target_bank_name TEXT NOT NULL,
      target_bank_branch TEXT NOT NULL,
      target_account_no TEXT NOT NULL,
      target_routing_no TEXT,
      from_bank_name TEXT NOT NULL,
      from_account_no TEXT NOT NULL,
      deduction_month TEXT NOT NULL, -- e.g. YYYY-MM or Period Range
      from_date DATE,
      to_date DATE,
      period_text TEXT,
      total_amount REAL NOT NULL,
      amount_in_words TEXT NOT NULL,
      employee_count INTEGER NOT NULL DEFAULT 1,
      remarks TEXT,
      status TEXT DEFAULT 'COMPLETED' CHECK(status IN ('DRAFT', 'COMPLETED', 'CANCELLED')),
      is_deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME,
      deleted_by TEXT
    );

    -- Audit Trail / Log Report (সম্পূর্ণ অডিট লগ)
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL, -- CREATE, UPDATE, DELETE, RESTORE, PROVISION, DEDUCTION, LOGIN
      entity_type TEXT NOT NULL, -- LOAN, EMPLOYEE, REPAYMENT, PROVISION, BANK_ADVICE, SETTINGS
      entity_id INTEGER,
      details TEXT,
      ip_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Demand Letters for Transferred Employees Overdue Installments (বদলিকৃত কর্মচারীদের বকেয়া কিস্তির তাগাদা পত্র)
    CREATE TABLE IF NOT EXISTS demand_letters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      letter_no TEXT NOT NULL UNIQUE,
      memo_no TEXT NOT NULL,
      letter_date DATE NOT NULL,
      target_pbs_name TEXT NOT NULL,
      target_pbs_id INTEGER REFERENCES other_pbs(id),
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      employee_name TEXT NOT NULL,
      emp_code TEXT NOT NULL,
      designation TEXT,
      loan_id INTEGER NOT NULL REFERENCES loans(id),
      loan_no TEXT NOT NULL,
      disbursed_amount REAL NOT NULL,
      monthly_installment REAL NOT NULL,
      due_months_count INTEGER NOT NULL,
      due_period_text TEXT NOT NULL,
      total_due_amount REAL NOT NULL,
      amount_in_words TEXT NOT NULL,
      principal_balance REAL NOT NULL,
      interest_balance REAL NOT NULL DEFAULT 0.0,
      remarks TEXT,
      status TEXT DEFAULT 'ISSUED' CHECK(status IN ('ISSUED', 'SETTLED', 'CANCELLED')),
      is_deleted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      deleted_at DATETIME,
      deleted_by TEXT
    );

    CREATE TABLE IF NOT EXISTS consolidated_demand_letters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      letter_no TEXT NOT NULL UNIQUE,
      memo_no TEXT NOT NULL,
      letter_date DATE NOT NULL,
      total_due_amount REAL NOT NULL,
      total_due_installments INTEGER NOT NULL,
      pbs_count INTEGER NOT NULL,
      employee_count INTEGER NOT NULL,
      amount_in_words TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT,
      is_deleted INTEGER DEFAULT 0
    );

    -- Unique partial index: Prevent duplicate active deductions for the same loan in the same month
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_repayment_per_loan_month
    ON repayments (loan_id, deduction_month)
    WHERE is_deleted = 0;
  `);

  // Safe migrations for repayments table posting columns
  const pbsSettingsColumns = db.prepare('PRAGMA table_info(pbs_settings)').all();
  const letterheadColumns = [
    ['pbs_english_name', "TEXT DEFAULT ''"],
    ['letterhead_subtitle', "TEXT DEFAULT 'বাংলাদেশ পল্লী বিদ্যুতায়ন বোর্ড'"],
    ['letterhead_right_title', "TEXT DEFAULT 'সদর দপ্তর'"],
    ['letterhead_badge_text', "TEXT DEFAULT ''"],
    ['website', "TEXT DEFAULT ''"],
    ['logo_url', "TEXT DEFAULT ''"],
    ['memo_no_prefix', "TEXT DEFAULT '২৭.১২.৬১০০.৫৪২.০১.০২৪'"],
    ['bank_advice_prepared_by_name', "TEXT DEFAULT ''"],
    ['bank_advice_verified_by_name', "TEXT DEFAULT ''"]
  ];
  for (const [columnName, columnDefinition] of letterheadColumns) {
    if (!pbsSettingsColumns.some(column => column.name === columnName)) {
      db.exec(`ALTER TABLE pbs_settings ADD COLUMN ${columnName} ${columnDefinition}`);
    }
  }

  db.exec(`
    UPDATE pbs_settings
    SET bank_name = replace(bank_name, 'লিঃ', 'পিএলসি')
    WHERE bank_name LIKE '%লিঃ%';
    UPDATE other_pbs
    SET bank_name = replace(bank_name, 'লিঃ', 'পিএলসি')
    WHERE bank_name LIKE '%লিঃ%';
    UPDATE bank_advices
    SET target_bank_name = replace(target_bank_name, 'লিঃ', 'পিএলসি'),
        from_bank_name = replace(from_bank_name, 'লিঃ', 'পিএলসি')
    WHERE target_bank_name LIKE '%লিঃ%' OR from_bank_name LIKE '%লিঃ%';
  `);

  const loanColumns = db.prepare('PRAGMA table_info(loans)').all();
  if (!loanColumns.some(column => column.name === 'salary_deduction_suspended')) {
    db.exec('ALTER TABLE loans ADD COLUMN salary_deduction_suspended INTEGER NOT NULL DEFAULT 0');
  }
  if (!loanColumns.some(column => column.name === 'opening_balance_as_of')) {
    db.exec('ALTER TABLE loans ADD COLUMN opening_balance_as_of DATE');
  }
  if (!loanColumns.some(column => column.name === 'advance_balance')) {
    db.exec('ALTER TABLE loans ADD COLUMN advance_balance REAL NOT NULL DEFAULT 0.0');
  }

  const repaymentColumns = db.prepare('PRAGMA table_info(repayments)').all();
  if (!repaymentColumns.some(column => column.name === 'advance_paid')) {
    db.exec('ALTER TABLE repayments ADD COLUMN advance_paid REAL NOT NULL DEFAULT 0.0');
  }
  if (!repaymentColumns.some(column => column.name === 'collection_batch_id')) {
    db.exec('ALTER TABLE repayments ADD COLUMN collection_batch_id TEXT');
  }

  try {
    db.exec("ALTER TABLE repayments ADD COLUMN principal_posting TEXT");
  } catch(e) {}
  try {
    db.exec("ALTER TABLE repayments ADD COLUMN interest_posting TEXT");
  } catch(e) {}

  // Initialize Default Settings if not exists
  const existingSettings = db.prepare('SELECT id FROM pbs_settings WHERE id = 1').get();
  if (!existingSettings) {
    db.prepare(`
      INSERT INTO pbs_settings (id) VALUES (1)
    `).run();
  }

  // Pre-seed Admin and Accounts users
  const adminUser = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminUser) {
    const salt = bcrypt.genSaltSync(10);
    const adminHash = bcrypt.hashSync('admin123', salt);
    const accountsHash = bcrypt.hashSync('accounts123', salt);

    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role)
      VALUES ('admin', ?, 'প্রধান সিস্টেম অ্যাডমিনিস্ট্রেটর', 'admin')
    `).run(adminHash);

    db.prepare(`
      INSERT INTO users (username, password_hash, full_name, role)
      VALUES ('accounts', ?, 'হিসাব শাখা (অর্থ ও হিসাব)', 'accounts')
    `).run(accountsHash);
  }

}

initSchema();

module.exports = db;
