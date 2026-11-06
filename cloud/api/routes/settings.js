const express = require('express');
const { authenticateToken, requireRole } = require('../lib/auth');
const { collection } = require('../lib/firestore');
const { allocateId, getDb, getRecord, listRecords, writeAudit } = require('../lib/records');

const router = express.Router();
const staffRoles = ['admin', 'accounts'];
const masterFields = [
  'pbs_name', 'pbs_code', 'address', 'phone', 'email', 'bank_name', 'bank_branch',
  'account_no', 'routing_no', 'bank_advice_prepared_by_name', 'bank_advice_verified_by_name',
  'agm_finance_name', 'gm_name', 'pbs_english_name', 'letterhead_subtitle',
  'letterhead_right_title', 'letterhead_badge_text', 'website', 'memo_no_prefix'
];
const userFields = [
  'bank_name', 'bank_branch', 'account_no', 'routing_no',
  'bank_advice_prepared_by_name', 'bank_advice_verified_by_name', 'agm_finance_name', 'gm_name'
];

function normalizeBankName(value) {
  return typeof value === 'string'
    ? value.replace(/\s*লিঃ/g, ' পিএলসি').replace(/\s+/g, ' ').trim()
    : value;
}

function settingsDefaults() {
  return {
    pbs_name: 'পল্লী বিদ্যুৎ সমিতি',
    pbs_code: '',
    address: '',
    pbs_english_name: '',
    letterhead_subtitle: 'বাংলাদেশ পল্লী বিদ্যুতায়ন বোর্ড',
    letterhead_right_title: 'সদর দপ্তর',
    letterhead_badge_text: '',
    website: '',
    logo_url: '',
    memo_no_prefix: '',
    phone: '',
    email: '',
    bank_name: '',
    bank_branch: '',
    account_no: '',
    routing_no: '',
    bank_advice_prepared_by_name: '',
    bank_advice_verified_by_name: '',
    agm_finance_name: '',
    agm_finance_title: 'সহকারী মহাব্যবস্থাপক (অর্থ-হিসাব)',
    dgm_name: '',
    dgm_title: 'উপ-মহাব্যবস্থাপক (সদর দপ্তর)',
    gm_name: '',
    gm_title: 'সিনিয়র জেনারেল ম্যানেজার'
  };
}

router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const [settings, otherPbsList, interestRules] = await Promise.all([
      getRecord('pbs_settings', 'default'),
      listRecords('other_pbs'),
      listRecords('interest_rules')
    ]);
    res.json({
      success: true,
      pbsSettings: { id: 'default', ...settingsDefaults(), ...(settings || {}) },
      otherPbsList: otherPbsList.sort((left, right) => String(left.pbs_name || '').localeCompare(String(right.pbs_name || ''))),
      interestRules: interestRules.sort((left, right) => String(left.effective_from_date || '').localeCompare(String(right.effective_from_date || ''))),
      edition: 'cloud-firestore'
    });
  } catch (error) {
    next(error);
  }
});

router.put('/', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const allowed = req.user.isMasterAdmin ? masterFields : userFields;
    const rejected = Object.keys(req.body || {}).filter(field => !allowed.includes(field));
    if (rejected.length) {
      return res.status(403).json({ success: false, message: 'এই তথ্য পরিবর্তনের জন্য মাস্টার অ্যাডমিন অনুমতি প্রয়োজন।' });
    }
    const updates = {};
    for (const field of allowed) {
      if (Object.hasOwn(req.body, field)) {
        const value = field === 'bank_name' ? normalizeBankName(req.body[field]) : req.body[field];
        if (value !== null && typeof value !== 'string') {
          return res.status(400).json({ success: false, message: 'পবিস সেটিংসের তথ্য সঠিক ফরম্যাটে দিন।' });
        }
        updates[field] = value ?? '';
      }
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ success: false, message: 'সংরক্ষণের জন্য কোনো সেটিংস পাওয়া যায়নি।' });
    }
    updates.updated_at = new Date().toISOString();
    const settingsRef = collection('pbs_settings').doc('default');
    await getDb().runTransaction(async transaction => {
      const loans = updates.pbs_name
        ? await transaction.get(collection('loans').where('loan_source_type', '==', 'OWN_PBS').limit(450))
        : null;
      transaction.set(settingsRef, { ...settingsDefaults(), ...updates }, { merge: true });
      for (const loan of loans?.docs || []) {
        transaction.update(loan.ref, { origin_pbs_name: updates.pbs_name, updated_at: updates.updated_at });
      }
    });
    await writeAudit(req.user, 'UPDATE', 'SETTINGS', 'default', 'PBS settings updated');
    res.json({ success: true, message: 'পবিস সেটিংস সফলভাবে সংরক্ষিত হয়েছে।' });
  } catch (error) {
    next(error);
  }
});

router.post('/other-pbs', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (typeof body.pbs_name !== 'string' || !body.pbs_name.trim()) {
      return res.status(400).json({ success: false, message: 'পবিসের নাম প্রদান করুন।' });
    }
    const pbsName = body.pbs_name.trim();
    const existing = await collection('other_pbs').where('pbs_name', '==', pbsName).limit(10).get();
    if (existing.docs.some(document => document.get('is_deleted') !== true)) {
      return res.status(400).json({ success: false, message: 'এই পবিসের নাম ইতিমধ্যে রয়েছে।' });
    }
    const id = await allocateId('other_pbs');
    const now = new Date().toISOString();
    const pbs = {
      pbs_name: pbsName,
      short_name: String(body.short_name || '').trim(),
      bank_name: normalizeBankName(String(body.bank_name || '').trim()),
      bank_branch: String(body.bank_branch || '').trim(),
      account_no: String(body.account_no || '').trim(),
      routing_no: String(body.routing_no || '').trim(),
      contact_person: String(body.contact_person || '').trim(),
      phone: String(body.phone || '').trim(),
      email: String(body.email || '').trim(),
      is_deleted: false,
      created_at: now
    };
    await collection('other_pbs').doc(id).create(pbs);
    await writeAudit(req.user, 'CREATE', 'OTHER_PBS', id, `Other PBS added: ${pbsName}`);
    res.json({ success: true, message: 'নতুন পবিসের তথ্য সফলভাবে যুক্ত হয়েছে।', id });
  } catch (error) {
    next(error);
  }
});

router.put('/other-pbs/:id', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const pbs = await getRecord('other_pbs', req.params.id);
    if (!pbs) {
      return res.status(404).json({ success: false, message: 'পবিসের তথ্য পাওয়া যায়নি।' });
    }
    const fields = ['pbs_name', 'short_name', 'bank_name', 'bank_branch', 'account_no', 'routing_no', 'contact_person', 'phone', 'email'];
    const update = {};
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        if (typeof req.body[field] !== 'string') {
          return res.status(400).json({ success: false, message: 'পবিসের তথ্য সঠিকভাবে দিন।' });
        }
        update[field] = field === 'bank_name' ? normalizeBankName(req.body[field]) : req.body[field].trim();
      }
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: 'হালনাগাদের জন্য কোনো তথ্য পাওয়া যায়নি।' });
    }
    update.updated_at = new Date().toISOString();
    await collection('other_pbs').doc(pbs.id).update(update);
    await writeAudit(req.user, 'UPDATE', 'OTHER_PBS', pbs.id, `Other PBS updated: ${update.pbs_name || pbs.pbs_name}`);
    res.json({ success: true, message: 'পবিসের তথ্য সফলভাবে হালনাগাদ হয়েছে।' });
  } catch (error) {
    next(error);
  }
});

router.delete('/other-pbs/:id', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const pbs = await getRecord('other_pbs', req.params.id);
    if (!pbs) {
      return res.status(404).json({ success: false, message: 'পবিসের তথ্য পাওয়া যায়নি।' });
    }
    await collection('other_pbs').doc(pbs.id).update({
      is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.username
    });
    await writeAudit(req.user, 'DELETE', 'OTHER_PBS', pbs.id, `Other PBS deleted: ${pbs.pbs_name}`);
    res.json({ success: true, message: 'পবিসের তথ্য মুছে ফেলা হয়েছে।' });
  } catch (error) {
    next(error);
  }
});

router.get('/interest-rules', authenticateToken, async (req, res, next) => {
  try {
    const rules = await listRecords('interest_rules');
    rules.sort((left, right) => String(left.effective_from_date || '').localeCompare(String(right.effective_from_date || '')));
    res.json({ success: true, rules });
  } catch (error) {
    next(error);
  }
});

router.post('/interest-rules', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.effective_from_date || !body.rule_name || !Number.isFinite(Number(body.rate)) || Number(body.rate) < 0 || Number(body.rate) > 100) {
      return res.status(400).json({ success: false, message: 'সুদের বিধির তারিখ, নাম এবং সঠিক হার প্রদান করুন।' });
    }
    const id = await allocateId('interest_rules');
    const now = new Date().toISOString();
    await collection('interest_rules').doc(id).create({
      effective_from_date: String(body.effective_from_date),
      effective_to_date: body.effective_to_date || null,
      rate: Number(body.rate),
      rule_name: String(body.rule_name).trim(),
      description: String(body.description || ''),
      is_active: body.is_active !== false,
      created_at: now,
      updated_at: now
    });
    await writeAudit(req.user, 'CREATE', 'INTEREST_RULE', id, `Interest rule created: ${body.rule_name}`);
    res.json({ success: true, message: 'নতুন সুদের হার বিধি যুক্ত হয়েছে।', id });
  } catch (error) {
    next(error);
  }
});

router.put('/interest-rules/:id', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const rule = await getRecord('interest_rules', req.params.id);
    if (!rule) {
      return res.status(404).json({ success: false, message: 'সুদের বিধি পাওয়া যায়নি।' });
    }
    const fields = ['effective_from_date', 'effective_to_date', 'rate', 'rule_name', 'description', 'is_active'];
    const update = Object.fromEntries(fields.filter(field => Object.hasOwn(req.body, field)).map(field => [field, req.body[field]]));
    if (update.rate !== undefined) {
      update.rate = Number(update.rate);
      if (!Number.isFinite(update.rate) || update.rate < 0 || update.rate > 100) {
        return res.status(400).json({ success: false, message: 'সুদের হার সঠিকভাবে দিন।' });
      }
    }
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: 'হালনাগাদের জন্য কোনো তথ্য পাওয়া যায়নি।' });
    }
    update.updated_at = new Date().toISOString();
    await collection('interest_rules').doc(rule.id).update(update);
    await writeAudit(req.user, 'UPDATE', 'INTEREST_RULE', rule.id, `Interest rule updated: ${update.rule_name || rule.rule_name}`);
    res.json({ success: true, message: 'সুদের বিধি হালনাগাদ হয়েছে।' });
  } catch (error) {
    next(error);
  }
});

router.delete('/interest-rules/:id', authenticateToken, requireRole(staffRoles), async (req, res, next) => {
  try {
    const rule = await getRecord('interest_rules', req.params.id);
    if (!rule) {
      return res.status(404).json({ success: false, message: 'সুদের বিধি পাওয়া যায়নি।' });
    }
    await collection('interest_rules').doc(rule.id).update({
      is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: req.user.username
    });
    await writeAudit(req.user, 'DELETE', 'INTEREST_RULE', rule.id, `Interest rule deleted: ${rule.rule_name}`);
    res.json({ success: true, message: 'সুদের বিধি মুছে ফেলা হয়েছে।' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
