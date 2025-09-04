// LocalStorage helpers for arranging main sections on the dashboard.

export const DEFAULT_ORDER = ["snapshot", "trends", "analyze"];
const LS_KEY = "aiinbox.section.order.v1";

/**
 * Read the saved section order, falling back to DEFAULT_ORDER.
 * Filters out unknown keys and de-duplicates.
 */
export function getSectionOrder() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_ORDER.slice();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return DEFAULT_ORDER.slice();

    // sanitize: only known keys, unique, preserve order
    const known = new Set(["snapshot", "trends", "analyze"]);
    const cleaned = [];
    for (const k of arr) {
      if (known.has(k) && !cleaned.includes(k)) cleaned.push(k);
    }
    // ensure any missing known keys are appended to the end
    for (const k of DEFAULT_ORDER) if (!cleaned.includes(k)) cleaned.push(k);
    return cleaned;
  } catch {
    return DEFAULT_ORDER.slice();
  }
}

export function setSectionOrder(order) {
  const known = new Set(["snapshot", "trends", "analyze"]);
  const cleaned = [];
  for (const k of order) if (known.has(k) && !cleaned.includes(k)) cleaned.push(k);
  for (const k of DEFAULT_ORDER) if (!cleaned.includes(k)) cleaned.push(k);
  localStorage.setItem(LS_KEY, JSON.stringify(cleaned));
  return cleaned;
}

export function resetSectionOrder() {
  localStorage.removeItem(LS_KEY);
  return DEFAULT_ORDER.slice();
}
