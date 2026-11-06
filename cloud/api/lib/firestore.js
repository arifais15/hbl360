const { applicationDefault, cert, getApps, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const COLLECTIONS = Object.freeze([
  'audit_logs',
  'bank_advices',
  'consolidated_demand_letters',
  'demand_letters',
  'employees',
  'interest_provisions',
  'interest_rules',
  'loans',
  'other_pbs',
  'pbs_settings',
  'remittances',
  'repayments',
  'users'
]);

function readServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    return null;
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw);
  } catch (error) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT must contain valid JSON.', { cause: error });
  }

  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is missing required service-account fields.');
  }

  return serviceAccount;
}

function createFirestore() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error('FIREBASE_PROJECT_ID must be configured.');
  }

  const serviceAccount = readServiceAccount();
  if (serviceAccount && serviceAccount.project_id !== projectId) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT project_id does not match FIREBASE_PROJECT_ID.');
  }

  const appOptions = serviceAccount
    ? { credential: cert(serviceAccount), projectId }
    : { credential: applicationDefault(), projectId };
  const app = getApps().find(existing => existing.name === 'hbl360-cloud')
    || initializeApp(appOptions, 'hbl360-cloud');

  return getFirestore(app);
}

let firestore;

function getDb() {
  if (!firestore) {
    firestore = createFirestore();
  }
  return firestore;
}

function collection(name) {
  if (!COLLECTIONS.includes(name)) {
    throw new Error(`Unknown cloud data collection: ${name}`);
  }

  return getDb().collection(`hbl360_cloud_${name}`);
}

module.exports = { COLLECTIONS, collection, getDb };
