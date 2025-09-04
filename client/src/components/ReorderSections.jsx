import React, { useEffect, useState } from "react";
import { getSectionOrder, setSectionOrder, resetSectionOrder, DEFAULT_ORDER } from "../utils/sectionOrder.js";

/**
 * Small modal to reorder dashboard sections: snapshot, trends, analyze.
 * Accessible (Up/Down buttons), persists to localStorage.
 */
export default function ReorderSections({ className = "" }) {
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState(() => getSectionOrder());

  // Lock background scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => (document.body.style.overflow = prev || "");
  }, [open]);

  // Sync across tabs
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "aiinbox.section.order.v1") setOrder(getSectionOrder());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    const next = order.slice();
    const [item] = next.splice(idx, 1);
    next.splice(j, 0, item);
    setOrder(next);
  };

  const save = () => {
    const cleaned = setSectionOrder(order);
    setOrder(cleaned);
    setOpen(false);
    window.dispatchEvent(new CustomEvent("section-order:updated", { detail: cleaned }));
  };

  const reset = () => {
    const def = resetSectionOrder();
    setOrder(def);
    setOpen(false);
    window.dispatchEvent(new CustomEvent("section-order:updated", { detail: def }));
  };

  const labelFor = (k) => ({ snapshot: "Snapshot", trends: "Trends", analyze: "Analyze" }[k] || k);
  const iconFor = (k) => ({ snapshot: "📊", trends: "📈", analyze: "🧠" }[k] || "⬜");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50 ${className}`}
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
      >
        <span aria-hidden>↕️</span>
        Arrange
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative z-10 flex h-full w-full items-center justify-center p-2 sm:p-4">
            <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
              <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 px-4 py-3 backdrop-blur">
                <h2 className="text-base font-semibold">Arrange Sections</h2>
                <button className="rounded-md p-2 hover:bg-gray-100" onClick={() => setOpen(false)} aria-label="Close">
                  ✕
                </button>
              </div>

              <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-4 py-3">
                <p className="mb-3 text-xs text-gray-600">Choose the order sections appear on your dashboard.</p>
                <ol className="space-y-2">
                  {order.map((k, idx) => (
                    <li key={k} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
                      <span className="text-xs w-5 text-center font-medium text-gray-500">{idx + 1}</span>
                      <span className="text-lg">{iconFor(k)}</span>
                      <span className="text-sm">{labelFor(k)}</span>
                      <div className="ml-auto flex gap-2">
                        <button
                          className="rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50"
                          onClick={() => move(idx, -1)}
                          disabled={idx === 0}
                        >
                          ↑ Up
                        </button>
                        <button
                          className="rounded border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50"
                          onClick={() => move(idx, +1)}
                          disabled={idx === order.length - 1}
                        >
                          ↓ Down
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="mt-3 text-[11px] text-gray-500">Default: {DEFAULT_ORDER.join(" → ")}</p>
              </div>

              <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t bg-white/95 px-4 py-3 backdrop-blur">
                <button onClick={reset} className="rounded border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50">
                  Reset to default
                </button>
                <button onClick={save} className="rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white">
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
