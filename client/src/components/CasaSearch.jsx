import React, { useMemo, useState } from "react";

/**
 * CasaSearch.jsx
 * CASA-safe Gmail metadata search (no bodies).
 *
 * Props:
 * - onChoose: (seed: { to: string, subject: string, threadId: string }) => void
 *
 * Notes:
 * - Uses backend GET /api/emails/search which returns metadata-only results.
 * - "Open in Gmail" deep-links to the thread; "Use in Reply Assistant" pre-fills the draft seed.
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

export default function CasaSearch({ onChoose }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [newer, setNewer] = useState("7d");
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);

  const session = useMemo(() => {
    const sp = new URLSearchParams(window.location.search);
    return sp.get("session") || "TEST123";
  }, []);

  async function runSearch() {
    setErr("");
    setLoading(true);
    setRows([]);
    const params = new URLSearchParams({
      session,
      limit: String(Math.max(1, Math.min(parseInt(limit || 20, 10), 50))),
    });
    if (from.trim()) params.set("from", from.trim());
    if (to.trim()) params.set("to", to.trim());
    if (subject.trim()) params.set("subject", subject.trim());
    if (newer) params.set("newer_than", newer);

    try {
      const res = await fetch(`${API_BASE}/api/emails/search?` + params.toString(), {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error || "Search failed");
      setRows(Array.isArray(data.results) ? data.results : []);
    } catch (e) {
      setErr(e.message || "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mb-6">
      <div className="bg-white shadow rounded-2xl p-4">
        <h3 className="text-lg font-semibold mb-2">CASA-safe message picker</h3>
        <p className="text-sm text-gray-500 mb-3">
          Search by metadata only (no bodies). Pick a message to open in Gmail and prefill the Reply Assistant.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">From</span>
            <input
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="alice@example.com"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">To</span>
            <input
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="you@example.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>

          <label className="block md:col-span-3">
            <span className="text-sm font-medium text-gray-700">Subject contains</span>
            <input
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="invoice, onboarding, meeting..."
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Newer than</span>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              value={newer}
              onChange={(e) => setNewer(e.target.value)}
            >
              <option value="1d">1 day</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">Limit</span>
            <input
              type="number"
              min={1}
              max={50}
              className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-500"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
            />
          </label>

          <div className="block self-end">
            <button
              type="button"
              onClick={runSearch}
              disabled={loading}
              className="w-full rounded-xl bg-indigo-600 text-white px-4 py-2 text-sm shadow hover:bg-indigo-700 disabled:opacity-60"
            >
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
        </div>

        {err && <div className="mt-3 text-sm text-red-600">{err}</div>}

        <div className="mt-4 overflow-x-auto">
          {rows.length === 0 && !loading ? (
            <p className="text-sm text-gray-500">No results yet.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="pb-2 pr-4">From</th>
                  <th className="pb-2 pr-4">Subject</th>
                  <th className="pb-2 pr-4">Date</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2 pr-4">
                      {r.from?.name ? `${r.from.name} ` : ""}
                      <span className="text-gray-600">&lt;{r.from?.email || "unknown"}&gt;</span>
                    </td>
                    <td className="py-2 pr-4">{r.subject || "(no subject)"}</td>
                    <td className="py-2 pr-4">{fmtDate(r.date)}</td>
                    <td className="py-2 space-x-2">
                      <button
                        type="button"
                        className="rounded-md border border-gray-200 px-2 py-1 hover:bg-gray-50"
                        onClick={() => window.open(r.gmailUrl, "_blank", "noopener,noreferrer")}
                        title="Open in Gmail"
                      >
                        ↗ Open
                      </button>
                      <button
                        type="button"
                        className="rounded-md bg-indigo-600 text-white px-2 py-1 hover:bg-indigo-700"
                        title="Prefill Reply Assistant"
                        onClick={() => {
                          const seed = {
                            to: r.from?.email || "",
                            subject: r.subject || "",
                            threadId: r.threadId || "",
                          };
                          onChoose?.(seed);
                          window.open(r.gmailUrl, "_blank", "noopener,noreferrer");
                        }}
                      >
                        Use in Reply Assistant
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="mt-3 text-[11px] text-gray-500">
          We only use Gmail metadata (headers like From/To/Subject/Date). No message bodies are downloaded.
        </p>
      </div>
    </div>
  );
}
