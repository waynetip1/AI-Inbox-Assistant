// client/src/components/TimeSavedMeter.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";

/**
 * Client-only “time saved” estimator with editable weights.
 * Props:
 *  - stats: object with category counts (Promotions, Social, Updates, Forums, Spam)
 *  - range: '1d' | '7d' | '30d' | '60d' | '90d'
 */

const LS_KEY = "timeSavedWeights.v1";
const DEFAULT_WEIGHTS = Object.freeze({
  Promotions: 5,
  Social: 4,
  Updates: 3,
  Forums: 3,
  Spam: 8,
});

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function loadWeights() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_WEIGHTS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_WEIGHTS, ...parsed };
    // sanitize
    for (const k of Object.keys(merged)) {
      const v = Number(merged[k]);
      merged[k] = Number.isFinite(v) ? clamp(v, 0, 60) : DEFAULT_WEIGHTS[k];
    }
    return merged;
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

export default function TimeSavedMeter({ stats, range }) {
  const [weights, setWeights] = useState(() => loadWeights());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState(weights);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!settingsOpen) return;
    const onEsc = (e) => e.key === "Escape" && setSettingsOpen(false);
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [settingsOpen]);

  const notify = useCallback((msg) => {
    setToast(msg);
    window.clearTimeout(notify._t);
    notify._t = window.setTimeout(() => setToast(""), 1200);
  }, []);

  const items = useMemo(() => {
    if (!stats) return [];
    return [
      { key: "Promotions", label: "Promotions", count: Number(stats.Promotions ?? 0), sec: weights.Promotions, emoji: "🔔" },
      { key: "Social",     label: "Social",     count: Number(stats.Social ?? 0),     sec: weights.Social,     emoji: "👥" },
      { key: "Updates",    label: "Updates",    count: Number(stats.Updates ?? 0),    sec: weights.Updates,    emoji: "🔄" },
      { key: "Forums",     label: "Forums",     count: Number(stats.Forums ?? 0),     sec: weights.Forums,     emoji: "💬" },
      { key: "Spam",       label: "Spam",       count: Number(stats.Spam ?? 0),       sec: weights.Spam,       emoji: "🚯" },
    ];
  }, [stats, weights]);

  const totals = useMemo(() => {
    let seconds = 0;
    let per = [];
    for (const it of items) {
      const s = it.count * it.sec;
      per.push({ ...it, savedSec: s });
      seconds += s;
    }
    const minutes = Math.round(seconds / 60);
    return { seconds, minutes, per };
  }, [items]);

  const prettyRange =
    {
      "1d": "Today",
      "7d": "Last 7 days",
      "30d": "Last 30 days",
      "60d": "Last 60 days",
      "90d": "Last 90 days",
    }[range] || range;

  const openSettings = () => {
    setDraft(weights);
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    const sanitized = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, clamp(Number(v) || 0, 0, 60)])
    );
    setWeights(sanitized);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(sanitized));
    } catch {}
    setSettingsOpen(false);
    notify("Saved");
  };

  const resetDefaults = () => {
    setDraft({ ...DEFAULT_WEIGHTS });
  };

  const anyNonZero = totals.seconds > 0;

  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white/70 p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">⏱️ Estimated time saved</h4>
          <p className="text-xs text-gray-500">{prettyRange} · client-side estimate</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="text-2xl font-bold tabular-nums">
            ≈ {totals.minutes}
            <span className="ml-1 text-sm font-medium text-gray-500">min</span>
          </div>

          {/* Settings (gear) */}
          <button
            type="button"
            onClick={openSettings}
            className="ml-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            title="Adjust seconds-per-email assumptions"
            aria-haspopup="dialog"
          >
            ⚙️
          </button>
        </div>
      </div>

      {totals.seconds === 0 ? (
        <p className="mt-2 text-sm text-gray-500">
          No non-primary mail detected for this period. Nice and quiet ☺️
        </p>
      ) : (
        <>
          <button
            onClick={() => setShowBreakdown((v) => !v)}
            className="mt-3 text-xs underline text-gray-700 hover:text-gray-900"
            aria-expanded={showBreakdown}
          >
            {showBreakdown ? "Hide breakdown" : "Show breakdown"}
          </button>

          {showBreakdown && (
            <ul className="mt-2 space-y-1">
              {totals.per.map((it) => (
                <li key={it.key} className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-2">
                    <span className="text-base">{it.emoji}</span>
                    <span className="text-gray-700">{it.label}</span>
                    <span className="text-xs text-gray-500">× {it.count}</span>
                  </span>
                  <span className="tabular-nums text-gray-900">
                    {(it.savedSec / 60).toFixed(1)} min
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-3 text-[11px] leading-snug text-gray-500">
            Assumptions (per email): Promotions {weights.Promotions}s, Social {weights.Social}s, Updates {weights.Updates}s, Forums {weights.Forums}s, Spam {weights.Spam}s.
            Tweak with the gear icon. This models time you didn’t spend skimming/clearing non-primary mail.
          </p>
        </>
      )}

      {/* Tiny toast */}
      {toast && (
        <div className="mt-3">
          <span className="rounded-full bg-black px-2 py-1 text-[10px] text-white">{toast}</span>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setSettingsOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="tsm-title"
            className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:top-1/2 sm:bottom-auto sm:translate-y-[-50%] sm:rounded-2xl"
          >
            <h3 id="tsm-title" className="text-base font-semibold">
              Time Saved – Assumptions
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              Set seconds per email for each non-primary category. Values are saved on this device.
            </p>

            <form
              className="mt-4 grid grid-cols-1 gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                saveSettings();
              }}
            >
              {["Promotions", "Social", "Updates", "Forums", "Spam"].map((k) => (
                <label key={k} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                  <span className="text-sm font-medium">{k}</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={60}
                    step={1}
                    className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                    value={draft[k]}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [k]: clamp(Number(e.target.value || 0), 0, 60) }))
                    }
                    aria-label={`${k} seconds per email`}
                  />
                </label>
              ))}

              <div className="mt-1 flex items-center justify-between">
                <button
                  type="button"
                  className="text-xs text-gray-600 underline"
                  onClick={resetDefaults}
                >
                  Reset defaults
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
                    onClick={() => setSettingsOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    Save
                  </button>
                </div>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
