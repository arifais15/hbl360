# HBL360 Cloud Edition

This is the separate online edition. The root-level SQLite server and Windows executable remain the offline PC edition and are not changed by this cloud branch.

The cloud edition starts with an empty, namespaced Firestore data set. It does not import, synchronize, or overwrite the local SQLite database. Its server uses the Firebase Admin SDK, so service-account credentials must remain server-side and must never be added to client code or committed.

## Current status

The cloud API foundation currently includes a health check, a bootstrap administrator login, and authenticated identity/role checks. The existing loan-management API and user interface have not yet been migrated. Do not deploy this branch for operational financial records until the remaining API routes, authorization checks, Firestore transactions, real-time updates, and migration tests are complete.

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
