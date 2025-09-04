import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_TILES,
  TILE_GROUPS,
  getSnapshotPrefs,
  setSnapshotPrefs,
  resetSnapshotPrefs,
  DEFAULT_PREFS,
} from "../utils/snapshotPrefs.js";

/**
 * Customize which snapshot tiles are visible.
 * Includes a "Gmail labels" section where users can add/remove/check labels by name.
 * Now viewport-safe: sticky header/footer and internal scroll so it's fully visible on desktop & mobile.
 */
export default function CustomizeSnapshot({ className = "" }) {
  const [open, setOpen] = useState(false);
  const [visibleSet, setVisibleSet] = useState(() => new Set(getSnapshotPrefs().visible));
  const [labelInput, setLabelInput] = useState("");
  const [userLabels, setUserLabels] = useState(() => getSnapshotPrefs().userLabels || []);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev || "";
    };
  }, [open]);

  // Sync across tabs
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "aiinbox.snapshot.prefs.v1") {
        const p = getSnapshotPrefs();
        setVisibleSet(new Set(p.visible));
        setUserLabels(p.userLabels || []);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const allIds = useMemo(() => ALL_TILES.map((t) => t.id), []);
  const coreIds = TILE_GROUPS.core;
  const catIds = TILE_GROUPS.categories;

  const allChecked = visibleSet.size === allIds.length;
  const noneChecked = visibleSet.size === 0;
  const coreCheckedCount = coreIds.filter((id) => visibleSet.has(id)).length;
  const catCheckedCount = catIds.filter((id) => visibleSet.has(id)).length;

  const toggle = (id) => {
    const next = new Set(visibleSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setVisibleSet(next);
  };
  const setGroup = (ids, visible) => {
    const next = new Set(visibleSet);
    ids.forEach((id) => (visible ? next.add(id) : next.delete(id)));
    setVisibleSet(next);
  };

  // === Label helpers ===
  function addLabelFromInput() {
    const raw = labelInput.trim();
    if (!raw) return;
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const next = new Set(userLabels);
    parts.forEach((p) => next.add(p));
    setUserLabels(Array.from(next));
    setLabelInput("");
  }
  function removeLabel(name) {
    setUserLabels((prev) => prev.filter((s) => s !== name));
  }
  function clearLabels() {
    setUserLabels([]);
  }

  const save = () => {
    const payload = setSnapshotPrefs(Array.from(visibleSet), userLabels);
    setVisibleSet(new Set(payload.visible));
    setUserLabels(payload.userLabels || []);
    setOpen(false);
    window.dispatchEvent(new CustomEvent("snapshot-prefs:updated", { detail: payload }));
  };
  const resetAll = () => {
    const payload = resetSnapshotPrefs();
    setVisibleSet(new Set(payload.visible));
    setUserLabels(payload.userLabels || []);
    setOpen(false);
    window.dispatchEvent(new CustomEvent("snapshot-prefs:updated", { detail: payload }));
  };
  const applyDefaults = () => {
    setVisibleSet(new Set(DEFAULT_PREFS.visible));
    setUserLabels([]);
  };
  const selectAll = () => setVisibleSet(new Set(allIds));

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50 ${className}`}
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        aria-controls="customize-snapshot-modal"
      >
        <span aria-hidden>⚙️</span>
        Customize
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          {/* Overlay */}
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          {/* Centering wrapper with small padding for tiny screens */}
          <div className="relative z-10 flex h-full w-full items-center justify-center p-2 sm:p-4">
            {/* Dialog container */}
            <div
              role="dialog"
              aria-modal="true"
              id="customize-snapshot-modal"
              className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
            >
              {/* Sticky header */}
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 px-4 py-3 backdrop-blur">
                <h2 className="text-base font-semibold">Customize Snapshot</h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md p-2 hover:bg-gray-100"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {/* Scrollable content area */}
              <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-4 py-3">
                <p className="mb-3 text-xs text-gray-600">
                  Choose which tiles appear. Preferences are saved on this device only.
                </p>

                {/* Global quick actions */}
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    onClick={selectAll}
                    className="rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    Select all
                  </button>
                  <button
                    onClick={applyDefaults}
                    className="rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50"
                  >
                    Reset to defaults
                  </button>
                </div>

                {/* Core snapshot group */}
                <TileGroup
                  title="Core snapshot tiles"
                  ids={coreIds}
                  count={`${coreCheckedCount}/${coreIds.length}`}
                  onShowAll={() => setGroup(coreIds, true)}
                  onHideAll={() => setGroup(coreIds, false)}
                  visibleSet={visibleSet}
                  onToggle={toggle}
                />

                {/* Categories group */}
                <TileGroup
                  title="Categories & tags tiles"
                  ids={catIds}
                  count={`${catCheckedCount}/${catIds.length}`}
                  onShowAll={() => setGroup(catIds, true)}
                  onHideAll={() => setGroup(catIds, false)}
                  visibleSet={visibleSet}
                  onToggle={toggle}
                />

                {/* Gmail labels group */}
                <fieldset className="mb-2 rounded-xl border border-gray-200 p-3">
                  <legend className="px-1 text-[13px] font-medium text-gray-700">Gmail labels</legend>

                  <LabelAdder
                    value={labelInput}
                    onChange={setLabelInput}
                    onAdd={addLabelFromInput}
                    canClear={userLabels.length > 0}
                    onClear={clearLabels}
                  />

                  {userLabels.length === 0 ? (
                    <p className="mt-2 text-[11px] text-gray-500">
                      Add any label from the left column in Gmail. Example:{" "}
                      <code className="bg-gray-100 px-1 rounded">Job Applications</code>
                    </p>
                  ) : (
                    <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {userLabels.map((name) => (
                        <li key={name}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50">
                            <span className="h-4 w-4 rounded-sm border border-gray-300 bg-indigo-600" aria-hidden />
                            <span className="text-sm truncate">{name}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeLabel(name);
                              }}
                              className="ml-auto rounded px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-100"
                              title="Remove label"
                            >
                              Remove
                            </button>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </fieldset>
              </div>

              {/* Sticky footer */}
              <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t bg-white/95 px-4 py-3 backdrop-blur">
                <div className="text-[11px] text-gray-500">
                  {allChecked
                    ? "All selected"
                    : noneChecked
                    ? "None selected (Inbox will remain visible)"
                    : `${visibleSet.size} of ${allIds.length} tiles selected`}{" "}
                  · {userLabels.length} labels
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={resetAll}
                    className="rounded border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
                  >
                    Reset All
                  </button>
                  <button
                    onClick={save}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TileGroup({ title, ids, count, onShowAll, onHideAll, visibleSet, onToggle }) {
  return (
    <fieldset className="mb-4 rounded-xl border border-gray-200 p-3">
      <legend className="px-1 text-[13px] font-medium text-gray-700">{title}</legend>

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onShowAll}
          className="rounded border border-gray-200 px-2 py-1 text-[11px] hover:bg-gray-50"
        >
          Show all
        </button>
        <button
          type="button"
          onClick={onHideAll}
          className="rounded border border-gray-200 px-2 py-1 text-[11px] hover:bg-gray-50"
        >
          Hide all
        </button>
        <span className="text-[11px] text-gray-500">{count} selected</span>
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ids.map((id) => {
          const t = ALL_TILES.find((x) => x.id === id);
          const checked = visibleSet.has(id);
          return (
            <li key={id}>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50">
                <input
                  type="checkbox"
                  className="mt-[3px] h-4 w-4 accent-indigo-600"
                  checked={checked}
                  onChange={() => onToggle(id)}
                />
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm">{t?.label || id}</span>
                  {t?.desc && (
                    <span className="mt-0.5 text-[11px] text-gray-500">
                      <code className="rounded bg-gray-100 px-1 py-[1px] text-[10px]">{t?.short || id}</code>
                      <span className="ml-2">{t.desc}</span>
                    </span>
                  )}
                </div>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function LabelAdder({ value, onChange, onAdd, canClear, onClear }) {
  const inputRef = useRef(null);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      onAdd();
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder='Add label (e.g., "Job Applications")'
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <button
        type="button"
        onClick={onAdd}
        className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500"
      >
        Add
      </button>
      {canClear && (
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-gray-200 px-3 py-2 text-xs hover:bg-gray-50"
          title="Remove all labels"
        >
          Clear
        </button>
      )}
    </div>
  );
}
