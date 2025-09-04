// server/persist.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default dev dir: <repo>/.sessions ; in prod prefer /tmp
const DEFAULT_DIR =
  process.env.SESSIONS_DIR ||
  (process.env.NODE_ENV === "production"
    ? "/tmp/ai-inbox-sessions"
    : path.join(__dirname, "..", ".sessions"));

function ensureDir(dir = DEFAULT_DIR) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore mkdir races
  }
  return dir;
}

function sessionPath(sessionId, dir = DEFAULT_DIR) {
  return path.join(dir, `${sessionId}.json`);
}

/** Save tokens + user to disk (dev convenience; do not commit ./.sessions) */
export function saveSessionToDisk(sessionId, payload) {
  const dir = ensureDir();
  const fp = sessionPath(sessionId, dir);
  const data = {
    version: 1,
    savedAt: new Date().toISOString(),
    ...payload,
  };
  fs.writeFileSync(fp, JSON.stringify(data, null, 2), "utf-8");
}

/** Remove persisted session */
export function deleteSessionFromDisk(sessionId) {
  const fp = sessionPath(sessionId);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
}

/** List persisted IDs (dev only) */
export function listPersistedSessions() {
  const dir = ensureDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.basename(f, ".json"));
}

/** Attempt to rehydrate a session from disk into memory */
export async function rehydrateSession(sessionStore, sessionId) {
  const fp = sessionPath(sessionId);
  if (!fs.existsSync(fp)) return null;

  const raw = JSON.parse(fs.readFileSync(fp, "utf-8"));
  if (!raw?.tokens) return null;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials(raw.tokens);

  sessionStore[sessionId] = {
    oauth2Client,
    tokens: raw.tokens,
    user: raw.user || null,
    daily: raw.daily || null,
  };

  return sessionStore[sessionId];
}
