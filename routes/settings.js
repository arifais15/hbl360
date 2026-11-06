const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const db = require('../database/db');
const { authenticateToken, requireRole, requireMasterAdmin } = require('../middleware/auth');
const { logAudit } = require('../middleware/audit');

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
      callback(new Error('শুধুমাত্র PNG, JPG বা WebP লোগো আপলোড করা যাবে।'));
      return;
    }
    callback(null, true);
  }
});

function uploadLetterheadLogo(req, res, next) {
  logoUpload.single('file')(req, res, error => {
    if (error) {
      return res.status(400).json({ success: false, message: error.message || 'লোগো আপলোড করা যায়নি।' });
    }
    next();
  });
}

function normalizeBankName(value) {
  return typeof value === 'string'
    ? value.replace(/\s*লিঃ/g, ' পিএলসি').replace(/\s+/g, ' ').trim()
    : value;
}

// Get Settings & Other PBS Directory
router.get('/', authenticateToken, (req, res) => {
  try {
    const pbsSettings = db.prepare('SELECT * FROM pbs_settings WHERE id = 1').get();
    const otherPbsList = db.prepare('SELECT * FROM other_pbs WHERE is_deleted = 0 ORDER BY pbs_name ASC').all();
    const interestRules = db.prepare('SELECT * FROM interest_rules ORDER BY effective_from_date ASC').all();

    res.json({
      success: true,
      pbsSettings,
      otherPbsList,
      interestRules,
      dbPath: db.dbPath || path.resolve('database/pbs_house_loan.db'),
      dataDir: db.dataDir || path.resolve('.')
    });
  } catch (error) {
    console.error('Settings error:', error);
    res.status(500).json({ success: false, message: 'সেটিংস লোড করা যায়নি।' });
  }
});

// Update Own PBS Settings
router.put('/', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const masterAdminFields = [
      'pbs_name', 'pbs_code', 'address', 'phone', 'email',
      'bank_name', 'bank_branch', 'account_no', 'routing_no',
      'bank_advice_prepared_by_name', 'bank_advice_verified_by_name',
      'agm_finance_name', 'gm_name',
      'pbs_english_name', 'letterhead_subtitle', 'letterhead_right_title',
      'letterhead_badge_text', 'website', 'memo_no_prefix'
    ];
    const userEditableFields = [
      'bank_name', 'bank_branch', 'account_no', 'routing_no',
      'bank_advice_prepared_by_name', 'bank_advice_verified_by_name',
      'agm_finance_name', 'gm_name'
    ];
    const masterStatus = db.prepare(`
      SELECT is_master_admin
      FROM users
      WHERE id = ? AND is_active = 1 AND is_deleted = 0
    `).get(req.user.id);
    const isMasterAdmin = Boolean(masterStatus?.is_master_admin);
    const allowedFields = isMasterAdmin ? masterAdminFields : userEditableFields;
    const rejectedFields = Object.keys(req.body).filter(field => !allowedFields.includes(field));

    if (rejectedFields.length > 0) {
      return res.status(403).json({
        success: false,
        message: 'এই তথ্য পরিবর্তনের জন্য মাস্টার অ্যাডমিন অনুমতি প্রয়োজন।'
      });
    }

    const updates = allowedFields
      .filter(field => Object.prototype.hasOwnProperty.call(req.body, field))
      .map(field => [
        field,
        field === 'bank_name' ? normalizeBankName(req.body[field]) : req.body[field]
      ]);

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'সংরক্ষণের জন্য কোনো সেটিংস পাওয়া যায়নি।' });
    }

    if (updates.some(([, value]) => value !== null && typeof value !== 'string')) {
      return res.status(400).json({ success: false, message: 'পবিস সেটিংসের তথ্য সঠিক ফরম্যাটে দিন।' });
    }

    const setClause = updates.map(([field]) => `${field} = ?`).join(', ');
    db.prepare(`
      UPDATE pbs_settings
      SET ${setClause}, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(...updates.map(([, value]) => value ?? ''));

    // Auto-sync origin_pbs_name for all OWN_PBS loans
    const pbsNameUpdate = updates.find(([field]) => field === 'pbs_name');
    if (pbsNameUpdate?.[1]) {
      db.prepare(`
        UPDATE loans
        SET origin_pbs_name = ?
        WHERE loan_source_type = 'OWN_PBS'
      `).run(pbsNameUpdate[1]);
    }

    logAudit(req, 'UPDATE', 'SETTINGS', 1, 'পবিস সাধারণ তথ্য ও ব্যাংক হিসাব বিবরণী হালনাগাদ করা হয়েছে');
    res.json({ success: true, message: 'পবিস সেটিংস সফলভাবে সংরক্ষিত হয়েছে।' });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({ success: false, message: 'সেটিংস সংরক্ষণ ব্যর্থ হয়েছে।' });
  }
});

router.post('/letterhead-logo', authenticateToken, requireMasterAdmin, uploadLetterheadLogo, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'লোগো ফাইল নির্বাচন করুন।' });
    }

    const buffer = req.file.buffer;
    let extension;
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      extension = 'png';
    } else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      extension = 'jpg';
    } else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      extension = 'webp';
    } else {
      return res.status(400).json({ success: false, message: 'ফাইলটি সঠিক PNG, JPG বা WebP ছবি নয়।' });
    }

    const uploadDirectory = db.dataDir && db.dataDir !== path.join(__dirname, '..')
      ? path.join(db.dataDir, 'uploads', 'letterhead')
      : path.join(__dirname, '..', 'public', 'uploads', 'letterhead');
    fs.mkdirSync(uploadDirectory, { recursive: true });
    const fileName = `${randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(uploadDirectory, fileName), buffer, { flag: 'wx' });
    const logoUrl = `/uploads/letterhead/${fileName}`;

    db.prepare('UPDATE pbs_settings SET logo_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run(logoUrl);
    logAudit(req, 'UPDATE', 'SETTINGS', 1, 'পবিস লেটারহেডের লোগো হালনাগাদ করা হয়েছে');

    res.json({ success: true, message: 'লেটারহেডের লোগো আপলোড হয়েছে।', logo_url: logoUrl });
  } catch (error) {
    console.error('Letterhead logo upload error:', error);
    res.status(500).json({ success: false, message: 'লেটারহেডের লোগো সংরক্ষণ করা যায়নি।' });
  }
});

// Add New Other PBS
router.post('/other-pbs', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const { pbs_name, short_name, bank_name, bank_branch, account_no, routing_no, contact_person, phone, email } = req.body;

    if (!pbs_name) {
      return res.status(400).json({ success: false, message: 'পবিসের নাম প্রদান করুন।' });
    }

    const stmt = db.prepare(`
      INSERT INTO other_pbs (pbs_name, short_name, bank_name, bank_branch, account_no, routing_no, contact_person, phone, email)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      pbs_name.trim(),
      short_name ? short_name.trim() : '',
      bank_name ? normalizeBankName(bank_name.trim()) : '',
      bank_branch ? bank_branch.trim() : '',
      account_no ? account_no.trim() : '',
      routing_no ? routing_no.trim() : '',
      contact_person ? contact_person.trim() : '',
      phone ? phone.trim() : '',
      email ? email.trim() : ''
    );

    logAudit(req, 'CREATE', 'OTHER_PBS', result.lastInsertRowid, `অন্য পবিস যুক্ত করা হয়েছে: ${pbs_name}`);
    res.json({ success: true, message: 'নতুন পবিসের তথ্য সফলভাবে যুক্ত হয়েছে।', id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add other PBS error:', error);
    res.status(500).json({ success: false, message: 'পবিস সংরক্ষণ ব্যর্থ হয়েছে।' });
  }
});

// Update Other PBS
router.put('/other-pbs/:id', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const id = req.params.id;
    const { pbs_name, short_name, bank_name, bank_branch, account_no, routing_no, contact_person, phone, email } = req.body;

    db.prepare(`
      UPDATE other_pbs
      SET pbs_name = ?, short_name = ?, bank_name = ?, bank_branch = ?,
          account_no = ?, routing_no = ?, contact_person = ?, phone = ?, email = ?
      WHERE id = ?
    `).run(
      pbs_name, short_name, normalizeBankName(bank_name), bank_branch,
      account_no, routing_no, contact_person, phone, email, id
    );

    logAudit(req, 'UPDATE', 'OTHER_PBS', id, `অন্য পবিসের তথ্য হালনাগাদ: ${pbs_name}`);
    res.json({ success: true, message: 'পবিসের তথ্য সফলভাবে আপডেট করা হয়েছে।' });
  } catch (error) {
    console.error('Update other PBS error:', error);
    res.status(500).json({ success: false, message: 'তথ্য আপডেট ব্যর্থ হয়েছে।' });
  }
});

// Delete Other PBS (Soft delete)
router.delete('/other-pbs/:id', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare('SELECT pbs_name FROM other_pbs WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'পবিস পাওয়া যায়নি।' });
    }

    db.prepare('UPDATE other_pbs SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);

    logAudit(req, 'DELETE', 'OTHER_PBS', id, `অন্য পবিস মুছে ফেলা হয়েছে: ${existing.pbs_name}`);
    res.json({ success: true, message: `${existing.pbs_name} সফলভাবে মুছে ফেলা হয়েছে।` });
  } catch (error) {
    console.error('Delete other PBS error:', error);
    res.status(500).json({ success: false, message: 'পবিস মুছতে ব্যর্থ হয়েছে।' });
  }
});

// ----------------- INTEREST RULES CRUD -----------------
router.get('/interest-rules', authenticateToken, (req, res) => {
  try {
    const rules = db.prepare('SELECT * FROM interest_rules ORDER BY effective_from_date ASC').all();
    res.json({ success: true, rules });
  } catch (err) {
    console.error('Fetch interest rules error:', err);
    res.status(500).json({ success: false, message: 'সুদের হারের তালিকা আনা যায়নি।' });
  }
});

router.post('/interest-rules', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const { effective_from_date, effective_to_date, rate, rule_name, description } = req.body;
    if (!effective_from_date || rate === undefined || rate === '' || !rule_name) {
      return res.status(400).json({ success: false, message: 'কার্যকর শুরুর তারিখ, সুদের হার ও বিধির নাম আবশ্যক।' });
    }

    const parsedRate = parseFloat(rate);
    if (isNaN(parsedRate) || parsedRate < 0) {
      return res.status(400).json({ success: false, message: 'সঠিক সুদের হার প্রদান করুন।' });
    }

    const cleanToDate = (effective_to_date && effective_to_date.trim()) ? effective_to_date.trim() : null;

    const result = db.prepare(`
      INSERT INTO interest_rules (effective_from_date, effective_to_date, rate, rule_name, description, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(effective_from_date.trim(), cleanToDate, parsedRate, rule_name.trim(), description ? description.trim() : '');

    logAudit(req, 'CREATE', 'SETTINGS', result.lastInsertRowid, `নতুন সুদের হার বিধি যুক্ত: ${rule_name} (${parsedRate}%)`);
    res.json({ success: true, message: 'সুদের হার বিধি সফলভাবে সংরক্ষিত হয়েছে।' });
  } catch (err) {
    console.error('Add interest rule error:', err);
    res.status(500).json({ success: false, message: 'সুদের হার সংরক্ষণ ব্যর্থ হয়েছে।' });
  }
});

router.put('/interest-rules/:id', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const { id } = req.params;
    const { effective_from_date, effective_to_date, rate, rule_name, description, is_active } = req.body;

    const existing = db.prepare('SELECT * FROM interest_rules WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'সুদের হারের রেকর্ড পাওয়া যায়নি।' });
    }

    const parsedRate = parseFloat(rate);
    const cleanToDate = (effective_to_date && effective_to_date.trim()) ? effective_to_date.trim() : null;

    db.prepare(`
      UPDATE interest_rules
      SET effective_from_date = ?,
          effective_to_date = ?,
          rate = ?,
          rule_name = ?,
          description = ?,
          is_active = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      effective_from_date.trim(),
      cleanToDate,
      isNaN(parsedRate) ? existing.rate : parsedRate,
      rule_name.trim(),
      description !== undefined ? description.trim() : existing.description,
      is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
      id
    );

    logAudit(req, 'UPDATE', 'SETTINGS', id, `সুদের হার বিধি আপডেট: ${rule_name} (${parsedRate}%)`);
    res.json({ success: true, message: 'সুদের হার সফলভাবে হালনাগাদ করা হয়েছে।' });
  } catch (err) {
    console.error('Update interest rule error:', err);
    res.status(500).json({ success: false, message: 'সুদের হার আপডেট ব্যর্থ হয়েছে।' });
  }
});

router.delete('/interest-rules/:id', authenticateToken, requireRole(['admin', 'accounts']), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM interest_rules WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'সুদের হার পাওয়া যায়নি।' });
    }

    db.prepare('DELETE FROM interest_rules WHERE id = ?').run(id);
    logAudit(req, 'DELETE', 'SETTINGS', id, `সুদের হার বিধি মুছে ফেলা হয়েছে: ${existing.rule_name}`);
    res.json({ success: true, message: 'সুদের হার বিধি মুছে ফেলা হয়েছে।' });
  } catch (err) {
    console.error('Delete interest rule error:', err);
    res.status(500).json({ success: false, message: 'মুছে ফেলা সম্ভব হয়নি।' });
  }
});

module.exports = router;

