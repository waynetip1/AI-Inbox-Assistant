/* eslint-disable jsdoc/require-jsdoc */
// Local, per-device snapshot tile preferences with schema versioning.

const STORAGE_KEY = "aiinbox.snapshot.prefs.v1"; // keep key; we'll migrate inside

// IMPORTANT: IDs match your existing App.jsx tile keys.
export const ALL_TILES = [
  // Core snapshot
  { id: "Inbox", label: "Inbox", short: "Inbox", desc: "All mail routed to Inbox during the window." },
  { id: "Unread", label: "Unread", short: "Unread", desc: "Inbox messages not yet marked as read." },
  { id: "StarredImportant", label: "Starred / Important", short: "⭐/!", desc: "Inbox items marked Starred or Important." },
  { id: "Spam", label: "Spam / Junk", short: "Spam", desc: "Messages in the Spam folder." },
  { id: "Sent", label: "Sent", short: "Sent", desc: "Messages you sent during the window." },
  { id: "Drafts", label: "Drafts", short: "Drafts", desc: "Saved, unsent drafts." },

  // Categories & tags
  { id: "Personal", label: "Primary / Personal", short: "Primary", desc: "Inbox minus Promotions/Social/Updates/Forums (estimated Primary)." },
  { id: "Promotions", label: "Promotions", short: "Promo", desc: "Marketing & deals categorized by Gmail." },
  { id: "Social", label: "Social", short: "Social", desc: "Social network notifications categorized by Gmail." },
  { id: "Updates", label: "Updates", short: "Updates", desc: "Transactional updates categorized by Gmail." },
  { id: "Forums", label: "Forums", short: "Forums", desc: "Group/forum messages categorized by Gmail." },
  { id: "StarredOnly", label: "Starred (Inbox)", short: "Starred", desc: "Only Starred items inside Inbox." },
];

// Group definitions used by the customization UI
export const TILE_GROUPS = {
  core: ["Inbox", "Unread", "StarredImportant", "Spam", "Sent", "Drafts"],
  categories: ["Personal", "Promotions", "Social", "Updates", "Forums", "StarredOnly"],
};

// v2 adds userLabels (string[]) while preserving visible tile prefs
export const DEFAULT_PREFS = {
  v: 2,
  visible: [
    "Inbox",
    "Unread",
    "StarredImportant",
    // Spam hidden by default for Free tier noise reduction
    "Sent",
    "Drafts",
    "Personal",
    "Promotions",
    "Social",
    "Updates",
    // (Forums, StarredOnly off by default)
  ],
  userLabels: [], // e.g., ["Job Applications", "Receipts"]
};

function parseSafe(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function migrateToV2(parsed) {
  // parsed may be v1 or invalid; coerce to v2 shape
  const known = new Set(ALL_TILES.map((t) => t.id));
  const visible = Array.isArray(parsed?.visible)
    ? parsed.visible.filter((id) => known.has(id))
    : [...DEFAULT_PREFS.visible];

  const safeVisible = visible.length ? visible : ["Inbox"];
  const hidden = ALL_TILES.map((t) => t.id).filter((id) => !safeVisible.includes(id));

  // carry over any userLabels if already present; else default []
  const userLabels = Array.isArray(parsed?.userLabels)
    ? parsed.userLabels.filter((s) => typeof s === "string" && s.trim())
    : [];

  return { v: 2, visible: safeVisible, hidden, userLabels };
}

export function getSnapshotPrefs() {
  if (typeof window === "undefined") return { ...DEFAULT_PREFS };
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? parseSafe(raw) : null;

  if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PREFS };

  // If not v2, migrate on read (write-back happens on set/reset/save)
  if (parsed.v !== 2) return migrateToV2(parsed);

  // validate v2
  const known = new Set(ALL_TILES.map((t) => t.id));
  const visible = Array.isArray(parsed.visible) ? parsed.visible.filter((id) => known.has(id)) : [];
  const safeVisible = visible.length ? visible : ["Inbox"];
  const hidden = ALL_TILES.map((t) => t.id).filter((id) => !safeVisible.includes(id));
  const userLabels = Array.isArray(parsed.userLabels)
    ? parsed.userLabels.filter((s) => typeof s === "string" && s.trim())
    : [];

  return { v: 2, visible: safeVisible, hidden, userLabels };
}

export function setSnapshotPrefs(nextVisible, nextUserLabels) {
  const known = new Set(ALL_TILES.map((t) => t.id));
  const filteredVis = (nextVisible || []).filter((id) => known.has(id));
  const safeVisible = filteredVis.length ? filteredVis : ["Inbox"];
  const hidden = ALL_TILES.map((t) => t.id).filter((id) => !safeVisible.includes(id));

  const userLabels =
    Array.isArray(nextUserLabels) ? nextUserLabels.filter((s) => typeof s === "string" && s.trim()) : [];

  const payload = { v: 2, visible: safeVisible, hidden, userLabels };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }
  return payload;
}

export function resetSnapshotPrefs() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  const hidden = ALL_TILES.map((t) => t.id).filter((id) => !DEFAULT_PREFS.visible.includes(id));
  return { v: 2, visible: [...DEFAULT_PREFS.visible], hidden, userLabels: [] };
}
