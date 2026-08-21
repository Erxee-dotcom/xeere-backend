'use strict';

/**
 * Firebase Auth integration (Google / Firebase ID tokens).
 *
 * The existing frontend signs users in with Firebase Auth (Google popup etc.).
 * This service verifies those ID tokens server-side so the same users can
 * authenticate against the XeeRe REST API.
 *
 * Verification only requires the Firebase *project ID* — `verifyIdToken()`
 * checks the token signature against Google's public keys, so no service
 * account is needed for auth (a service account is only required for admin
 * SDK operations such as Firestore access).
 *
 * Configure via:
 *   FIREBASE_PROJECT_ID=my-project-id           (minimum required)
 *   FIREBASE_SERVICE_ACCOUNT=<json string>      (optional — enables admin ops)
 *   GOOGLE_APPLICATION_CREDENTIALS=/path.json   (optional — alternative)
 *
 * If none of these are set, the service is "not configured" and the auth
 * endpoint returns 503 instead of failing cryptically.
 */

let app = null;
let initialized = false;

function configured() {
  return !!(
    process.env.FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS
  );
}

function getApp() {
  if (initialized) return app;
  initialized = true;

  if (!configured()) return null;

  const admin = require('firebase-admin');
  const options = {};

  if (process.env.FIREBASE_PROJECT_ID) {
    options.projectId = process.env.FIREBASE_PROJECT_ID;
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    options.credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    options.credential = admin.credential.applicationDefault();
  }

  app = admin.initializeApp(options, 'xeere');
  return app;
}

/**
 * Verify a Firebase ID token and return its decoded payload.
 * Throws an error with `status = 503` when Firebase is not configured.
 */
async function verifyIdToken(idToken) {
  const fbApp = getApp();
  if (!fbApp) {
    const err = new Error('Firebase auth is not configured on this server');
    err.status = 503;
    throw err;
  }
  return fbApp.auth().verifyIdToken(idToken);
}

module.exports = { verifyIdToken, isConfigured: configured };
