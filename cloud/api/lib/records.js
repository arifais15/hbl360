const { collection, getDb } = require('./firestore');

async function listRecords(name, { includeDeleted = false, limit = 1000 } = {}) {
  const snapshot = await collection(name).limit(limit).get();
  return snapshot.docs
    .map(document => ({ id: document.id, ...document.data() }))
    .filter(record => includeDeleted || record.is_deleted !== true)
    .sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
}

async function getRecord(name, id) {
  const snapshot = await collection(name).doc(String(id)).get();
  return snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function writeAudit(user, action, entity, entityId, details) {
  const auditRef = collection('audit_logs').doc();
  await auditRef.create({
    user_id: user.id,
    username: user.username,
    user_role: user.role,
    action,
    entity,
    entity_id: String(entityId),
    details: String(details || ''),
    ip_address: '',
    created_at: new Date().toISOString()
  });
}

async function setInTransaction(transaction, name, id, data, { merge = false } = {}) {
  const reference = collection(name).doc(String(id));
  transaction.set(reference, data, { merge });
  return reference;
}

async function allocateId(name) {
  return collection(name).doc().id;
}

module.exports = {
  allocateId,
  getRecord,
  listRecords,
  setInTransaction,
  writeAudit,
  getDb
};
