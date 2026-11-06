# HBL360 Cloud Edition

This is the separate online edition. The root-level SQLite server and Windows executable remain the offline PC edition and are not changed by this cloud branch.

The cloud edition starts with an empty, namespaced Firestore data set. It does not import, synchronize, or overwrite the local SQLite database. Its server uses the Firebase Admin SDK, so service-account credentials must remain server-side and must never be added to client code or committed.

## Current status

This branch is an active, incomplete migration, not a production-ready replacement for the offline application.

The cloud API currently includes authentication and role checks, employee and loan CRUD, PBS settings, repayments (including batch and multi-month posting/reversal), interest provisions, bank-advice/remittance workflows, basic employee/loan/remittance reports, recycle-bin listing/restoration, and audit-log polling for the browser UI. The cloud build copies the offline UI into the Vercel output and disables its SQLite-era offline API cache fallback.

The following offline workflows still need cloud parity: transferred-loan collection and demand-letter workflows, the full report/ledger set and Excel exports/import templates, and broader coverage of restore/delete behavior. Cloud API integration tests currently verify route mounting and authentication, but do not exercise Firestore transactions against an emulator. Read helpers currently cap collection reads at 1,000 records, and write batches are intentionally capped to stay under Firestore transaction limits. The browser notices audited changes by polling every five seconds; this is not Firestore snapshot streaming.

Do not deploy this branch for operational financial records until the remaining workflows are migrated, Firestore-backed behavior is tested, authorization and transaction paths are reviewed, and the intended Firebase project/service-account configuration is verified.

## Local API development

1. Copy `.env.example` to `.env`.
2. Set `FIREBASE_SERVICE_ACCOUNT` to the service-account JSON for the intended Firebase project. Keep `.env` private.
3. Set a random `JWT_SECRET` of at least 32 bytes.
4. Set a unique `CLOUD_ADMIN_USERNAME` and a `CLOUD_ADMIN_PASSWORD` of at least 12 characters.
5. Run `npm install` and `npm start`.

The first successful admin login creates the bootstrap admin in the `hbl360_cloud_users` collection. Existing Firestore collections and security rules are not modified by the application code.

## Vercel

Create a separate Vercel project for this edition and set its Root Directory to `cloud`. Configure the same environment variables in Vercel's encrypted project settings. Set `FIREBASE_PROJECT_ID` to the Firebase project that owns the Firestore database and use a least-privilege service account where possible.

The Vercel deployment is not ready for production use until the full app migration is completed.
