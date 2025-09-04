import { useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";

export default function AnalyzePanel() {
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState({ cached: 0, computed: 0, provider: "" });
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");

  const sessionId = new URLSearchParams(window.location.search).get("session") || "TEST123";

  async function callAnalyze(limit = 5) {
    setLoading(true);
    setErr("");
    try {
      const url = `${API_BASE}/api/emails/analyze?session=${encodeURIComponent(
        sessionId
      )}&limit=${limit}&q=${encodeURIComponent("is:unread newer_than:7d")}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

      const provider = res.headers.get("X-Analyze-Provider") || "";
      const cached = Number(res.headers.get("X-Analyze-Cached") || 0);
      const computed = Number(res.headers.get("X-Analyze-Computed") || 0);

      const ct = res.headers.get("Content-Type") || "";
      const body = ct.includes("application/json")
        ? await res.json()
        : { ok: false, error: await res.text() };

      setMeta({ provider, cached, computed });
      setItems(Array.isArray(body.analyzed) ? body.analyzed : []);

      if (!res.ok || body?.error) setErr(body?.error || `Analyze failed (${res.status})`);
    } catch (e) {
      setErr(e.message || "Analyze failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    // Match the other cards: full width, same radius/shadow/padding
    <div className="w-full bg-white shadow rounded-2xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">🧪 Analyze Panel</h2>
        <div className="flex items-center gap-2 text-xs">
          <span className="rounded-full bg-gray-900 text-white px-2 py-1">
            {meta.provider || "—"}
          </span>
          <span className="rounded-full bg-emerald-50 text-emerald-700 px-2 py-1">
            Cached {meta.cached}
          </span>
          <span className="rounded-full bg-amber-50 text-amber-700 px-2 py-1">
            Computed {meta.computed}
          </span>
        </div>
      </div>

      <button
        onClick={() => callAnalyze(5)}
        disabled={loading}
        className="inline-flex items-center gap-2 rounded-xl px-4 py-2 bg-black text-white hover:bg-zinc-800 disabled:opacity-60"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-4 w-4 inline-block border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
            Analyzing…
          </span>
        ) : (
          "Analyze (limit 5)"
        )}
      </button>

      {err && <div className="mt-3 text-sm text-red-600">{err}</div>}

      {items.length > 0 && (
        <ul className="space-y-2 mt-4">
          {items.map((it) => (
            <li key={it.id} className="rounded-lg border p-3 bg-white">
              <div className="text-xs text-zinc-500 mb-1">
                {it.cached ? "cached" : "computed"} · {it.id}
              </div>
              <div className="text-sm">{it.summary || it.error || "No summary"}</div>
              {Array.isArray(it.actions) && it.actions[0] && (
                <div className="mt-1 text-xs">
                  <span className="font-semibold">Suggested:</span>{" "}
                  {it.actions[0].action}
                  {it.actions[0].moveLabel ? ` → ${it.actions[0].moveLabel}` : ""}
                  {it.actions[0].reason ? ` — ${it.actions[0].reason}` : ""}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
