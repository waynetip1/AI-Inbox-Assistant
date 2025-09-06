import React, { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
function getSessionIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return sp.get("session") || "TEST123";
}
function cx(...xs){ return xs.filter(Boolean).join(" "); }

export default function CasaMessagePicker() {
  // Search fields
  const [fromQ, setFromQ] = useState("");
  const [toQ, setToQ] = useState("");
  const [subjectQ, setSubjectQ] = useState("");

  // Quick Picks
  const [qpUnread, setQpUnread] = useState(false);
  const [qpUpdates, setQpUpdates] = useState(false);
  const [qpSent, setQpSent] = useState(false);

  // Window + page size
  const [newerThan, setNewerThan] = useState("7d");
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState([]); // start empty — no pre-delivered messages

  // Single-selection (radio)
  const [selectedId, setSelectedId] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [modalItem, setModalItem] = useState(null);
  const [awaitingCopy, setAwaitingCopy] = useState(false);
  const [hint, setHint] = useState("");
  const copyWatcherCleanup = useRef(null);

  const session = getSessionIdFromUrl();

  async function runSearch(e) {
    e?.preventDefault?.();
    setErr(""); setResults([]); setSelectedId(""); setLoading(true);
    try {
      const url = new URL(`${API_BASE}/api/emails/search`);
      url.searchParams.set("session", session);
      if (fromQ.trim()) url.searchParams.set("from", fromQ.trim());
      if (toQ.trim()) url.searchParams.set("to", toQ.trim());
      if (subjectQ.trim()) url.searchParams.set("subject", subjectQ.trim());
      url.searchParams.set("newer_than", newerThan);
      url.searchParams.set("limit", String(Math.max(1, Math.min(limit, 50))));
      if (qpUnread) url.searchParams.set("qp_unread", "1");
      if (qpUpdates) url.searchParams.set("qp_updates", "1");
      if (qpSent) url.searchParams.set("qp_sent", "1");

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (res.status === 401) {
        const j = await res.json().catch(() => null);
        if (j?.error === "NO_SESSION") {
          window.location.href = `${API_BASE}/auth/google?session=${encodeURIComponent(session)}`;
          return;
        }
      }
      const json = await res.json();
      if (!res.ok || !json?.ok) throw new Error(json?.message || `Search failed (${res.status})`);
      const rows = Array.isArray(json.results) ? [...json.results] : [];
      rows.sort((a, b) => (new Date(a.date || 0)) - (new Date(b.date || 0))); // oldest → newest
      setResults(rows);
    } catch (e) {
      setErr(e.message || "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  // NO auto-search on mount anymore

  function openModalForSelected() {
    if (!selectedId) return;
    const r = results.find(x => x.id === selectedId);
    setModalItem(r || null);
    setShowModal(!!r);
    setAwaitingCopy(false);
    setHint("");
    if (copyWatcherCleanup.current) { copyWatcherCleanup.current(); copyWatcherCleanup.current = null; }
  }

  function dispatchReset(item) {
    window.dispatchEvent(new CustomEvent("reply-assistant:reset", {
      detail: { reason: "newMessage", messageId: item?.id || "" }
    }));
  }

  function dispatchSeedAndFocus(item) {
    dispatchReset(item);
    const seed = {
      to: item.from?.email || "",
      subject: item.subject || "",
      threadId: item.threadId || "",
      messageId: item.id || "",
    };
    window.dispatchEvent(new CustomEvent("reply-assistant:seed", { detail: seed }));
    window.dispatchEvent(new CustomEvent("reply-assistant:focus"));
  }

  function scrollToAssistant() {
    const anchor = document.getElementById("reply-assistant");
    if (anchor) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function startOpenAndAwaitCopy() {
    if (!modalItem) return;
    dispatchSeedAndFocus(modalItem);
    setAwaitingCopy(true);
    setHint("Opened in Gmail. Copy the message there, return here, and we’ll paste & draft automatically.");
    window.open(modalItem.gmailUrl, "_blank", "noopener,noreferrer");

    const deadline = Date.now() + 90_000;
    let done = false;

    const tryClipboardOnce = async () => {
      if (done) return;
      if (Date.now() > deadline) { setHint("Timed out waiting for clipboard. Paste manually or click “Paste & Draft Now”."); cleanup(); return; }
      try {
        const txt = (await navigator.clipboard.readText?.()) || "";
        if (txt.trim().length >= 10) {
          window.dispatchEvent(new CustomEvent("reply-assistant:pasteText", { detail: { text: txt.trim() } }));
          window.dispatchEvent(new CustomEvent("reply-assistant:compose", { detail: { style: "professional" } }));
          done = true;
          setShowModal(false);
          setAwaitingCopy(false);
          cleanup();
          scrollToAssistant();
          return;
        }
        setHint("Didn’t detect text on the clipboard yet. Copy in Gmail, then come back.");
      } catch {
        setHint("Browser blocked clipboard read. Use “Paste & Draft Now” or paste manually in the assistant.");
      }
    };

    const onFocus = () => tryClipboardOnce();
    const onVisibility = () => { if (document.visibilityState === "visible") tryClipboardOnce(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    const cleanup = () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      copyWatcherCleanup.current = null;
    };
    copyWatcherCleanup.current = cleanup;
  }

  async function pasteAndDraftNow() {
    if (!modalItem) return;
    try {
      const txt = (await navigator.clipboard.readText?.()) || "";
      if (txt.trim().length >= 10) {
        dispatchSeedAndFocus(modalItem);
        window.dispatchEvent(new CustomEvent("reply-assistant:pasteText", { detail: { text: txt.trim() } }));
        window.dispatchEvent(new CustomEvent("reply-assistant:compose", { detail: { style: "professional" } }));
        setShowModal(false);
        setAwaitingCopy(false);
        scrollToAssistant();
      } else {
        setHint("Clipboard is empty or too short. Copy the message in Gmail, then try again.");
      }
    } catch {
      setHint("Clipboard was blocked. Choose “Just Use in Reply Assistant” and paste manually.");
    } finally {
      if (copyWatcherCleanup.current) { copyWatcherCleanup.current(); copyWatcherCleanup.current = null; }
    }
  }

  function modalJustUse() {
    if (!modalItem) return;
    dispatchSeedAndFocus(modalItem);
    setShowModal(false);
    setAwaitingCopy(false);
    if (copyWatcherCleanup.current) { copyWatcherCleanup.current(); copyWatcherCleanup.current = null; }
    scrollToAssistant();
  }

  useEffect(() => () => { if (copyWatcherCleanup.current) copyWatcherCleanup.current(); }, []);

  return (
    <section className="bg-white shadow rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold">🔎 CASA-safe Message Picker</h2>
        <div className="text-xs text-gray-500">Metadata only — no message bodies.</div>
      </div>

      {/* Quick Picks */}
      <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" className="h-4 w-4" checked={qpUnread} onChange={(e)=>setQpUnread(e.target.checked)} />
          Unread
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" className="h-4 w-4" checked={qpUpdates} onChange={(e)=>setQpUpdates(e.target.checked)} />
          Updates
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" className="h-4 w-4" checked={qpSent} onChange={(e)=>setQpSent(e.target.checked)} />
          Sent (replied)
        </label>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1">
            <span className="text-gray-600">Newer than</span>
            <select value={newerThan} onChange={(e)=>setNewerThan(e.target.value)} className="rounded-md border border-gray-200 px-2 py-1 text-sm">
              <option value="1d">1d</option><option value="3d">3d</option><option value="7d">7d</option>
              <option value="14d">14d</option><option value="30d">30d</option><option value="90d">90d</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-gray-600">Show</span>
            <select value={limit} onChange={(e)=>setLimit(Number(e.target.value))} className="rounded-md border border-gray-200 px-2 py-1 text-sm">
              <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>
            </select>
          </label>
          <button type="button" onClick={()=>setLimit(l => Math.max(1, Math.min(50, l + 10)))} className="rounded-md border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50">More</button>
          <button type="button" onClick={()=>setLimit(l => Math.max(1, l - 10))} className="rounded-md border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50">Less</button>
        </div>
      </div>

      {/* Search fields */}
      <form onSubmit={runSearch} className="grid grid-cols-1 md:grid-cols-12 gap-2 mb-3">
        <input value={fromQ} onChange={(e)=>setFromQ(e.target.value)} className="md:col-span-3 rounded-lg border border-gray-200 px-2 py-1 text-sm" placeholder="From (name or email)" aria-label="From" />
        <input value={toQ} onChange={(e)=>setToQ(e.target.value)} className="md:col-span-3 rounded-lg border border-gray-200 px-2 py-1 text-sm" placeholder="To (name or email)" aria-label="To" />
        <input value={subjectQ} onChange={(e)=>setSubjectQ(e.target.value)} className="md:col-span-4 rounded-lg border border-gray-200 px-2 py-1 text-sm" placeholder="Subject contains…" aria-label="Subject" />
        <button type="submit" disabled={loading} className="md:col-span-2 rounded-lg bg-indigo-600 text-white text-sm px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-60" title="Search">{loading ? "…" : "Search"}</button>
      </form>

      {err && <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">{err}</div>}

      {/* Results */}
      <div className="overflow-auto border border-gray-200 rounded-xl">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="w-10 px-2 py-2 text-left">●</th>
              <th className="px-2 py-2 text-left">From</th>
              <th className="px-2 py-2 text-left">Subject</th>
              <th className="px-2 py-2 text-left">Date</th>
              <th className="w-40 px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-500">{loading ? "Searching…" : "No results — try a search."}</td></tr>
            ) : results.map(r => {
              const checked = selectedId === r.id;
              const from = r.from?.name ? `${r.from.name} <${r.from.email}>` : (r.from?.email || "—");
              const when = r.date ? new Date(r.date).toLocaleString() : "—";
              return (
                <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-2 py-2 align-middle">
                    <input
                      type="radio"
                      name="casa-row"
                      className="h-4 w-4"
                      checked={checked}
                      onChange={()=>setSelectedId(r.id)}
                      aria-label={`Choose ${r.subject || "(no subject)"}`}
                    />
                  </td>
                  <td className="px-2 py-2 align-middle"><div className="truncate max-w-[240px]" title={from}>{from}</div></td>
                  <td className="px-2 py-2 align-middle"><div className="truncate max-w-[360px]" title={r.subject || "(no subject)"}>{r.subject || <span className="text-gray-400">(no subject)</span>}</div></td>
                  <td className="px-2 py-2 align-middle text-gray-600 whitespace-nowrap">{when}</td>
                  <td className="px-2 py-2 align-middle text-right">
                    {/* NEW: Use in Reply Assistant to the LEFT of Open */}
                    <button
                      type="button"
                      onClick={()=>{ setSelectedId(r.id); setModalItem(r); setShowModal(true); }}
                      className="mr-2 rounded-md bg-emerald-600 text-white px-2 py-1 text-xs hover:bg-emerald-700"
                      title="Seed & draft with AI"
                    >
                      Use in Reply Assistant
                    </button>
                    <button
                      type="button"
                      onClick={()=>window.open(r.gmailUrl, "_blank", "noopener,noreferrer")}
                      className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs hover:bg-gray-50"
                      title="Open in Gmail"
                    >
                      ↗ Open
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && modalItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={()=>setShowModal(false)} />
          <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white shadow-xl border border-gray-200 p-4">
            <h3 className="text-base font-semibold mb-2">Use in Reply Assistant</h3>
            <div className="text-sm mb-3">
              <div className="font-medium truncate" title={modalItem.subject || "(no subject)"}>{modalItem.subject || "(no subject)"}</div>
              <div className="text-gray-600 truncate" title={modalItem.from?.email || ""}>From: {modalItem.from?.name ? `${modalItem.from.name} <${modalItem.from.email}>` : (modalItem.from?.email || "—")}</div>
              <div className="text-gray-600">Date: {modalItem.date ? new Date(modalItem.date).toLocaleString() : "—"}</div>
            </div>
            <ol className="list-decimal pl-5 text-sm text-gray-700 space-y-1 mb-3">
              <li>We’ll open the message in Gmail — copy the body there.</li>
              <li>Return to this tab and we’ll paste & draft the reply automatically (when permitted).</li>
              <li>If you don’t copy anything, the Original box stays blank — paste manually.</li>
            </ol>

            {awaitingCopy && (
              <div className="mb-2 text-xs rounded-lg border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2">
                {hint || "Waiting for clipboard…"}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              {!awaitingCopy && (
                <button
                  type="button"
                  onClick={startOpenAndAwaitCopy}
                  className="rounded-md bg-emerald-600 text-white px-3 py-1.5 text-sm hover:bg-emerald-700"
                  title="Open Gmail and wait for your copy"
                >
                  Open & Await Copy
                </button>
              )}
              {awaitingCopy && (
                <button
                  type="button"
                  onClick={pasteAndDraftNow}
                  className="rounded-md bg-emerald-600 text-white px-3 py-1.5 text-sm hover:bg-emerald-700"
                  title="Try to read clipboard now"
                >
                  Paste & Draft Now
                </button>
              )}
              <button
                type="button"
                onClick={()=>window.open(modalItem.gmailUrl, "_blank", "noopener,noreferrer")}
                className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
              >
                ↗ Open in Gmail
              </button>
              <button
                type="button"
                onClick={()=>{ modalJustUse(); }}
                className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-sm hover:bg-indigo-700"
                title="Seed & focus assistant (no auto-paste)"
              >
                Just Use in Reply Assistant
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
