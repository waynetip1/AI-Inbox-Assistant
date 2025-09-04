import admin from "firebase-admin";

/**
 * Optional Firestore bootstrap.
 * If service-account/ADC is missing, we DO NOT provide a db instance (db=null),
 * and routes should skip Firestore usage.
 */

function normalizePrivateKey(key) {
  if (!key) return key;
  let k = key.replace(/\\n/g, "\n");
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) {
    k = k.slice(1, -1);
  }
  return k;
}

const projectId   = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || "";
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
const privateKey  = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || "");
const hasServiceAccount = Boolean(projectId && clientEmail && privateKey);
const hasADC = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_CLOUD_PROJECT);

let initialized = false;
if (!admin.apps.length) {
  try {
    if (hasServiceAccount) {
      admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });
      console.log("[firebaseAdmin] Initialized with service account.");
      initialized = true;
    } else if (hasADC) {
      admin.initializeApp(); // Application Default Credentials
      console.log("[firebaseAdmin] Initialized with ADC.");
      initialized = true;
    } else {
      console.warn("[firebaseAdmin] Firestore disabled (no credentials detected).");
    }
  } catch (e) {
    console.warn("[firebaseAdmin] Initialization failed; Firestore disabled:", e.message);
  }
}

let db = null;
if (initialized) {
  try {
    db = admin.firestore();
  } catch (e) {
    console.warn("[firebaseAdmin] firestore() unavailable; disabling Firestore:", e.message);
    db = null;
  }
}

const Timestamp = admin.firestore?.Timestamp || { now: () => ({ toMillis: () => Date.now() }) };
const canUseFirestore = Boolean(db);

export { admin, db, Timestamp, canUseFirestore };
export default { admin, db, Timestamp, canUseFirestore };
