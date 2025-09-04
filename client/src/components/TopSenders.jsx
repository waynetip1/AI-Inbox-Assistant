import React, { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, API_BASE, abortApi } from "../api.js";

function getSessionIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return sp.get("session") || "TEST123";
}

export default function TopSenders({ range = "1d", className = "" }) {
  const [loading, setLoading] = useState(false);
  const [senders, setSenders] = useState([]);
  const [meta, setMeta] = useState({ sampled: 0, scanned: 0, limited: false, note: "" });
  const [error, setError] = useState("");

  // Stable URL per (session, range) so deduper can do its job.
  const url = useMemo(() => {
    const sid = getSessionIdFromUrl();
    const u = new URL(`${API_BASE}/api/senders`);
    u.searchParams.set("session", sid);
    u.searchParams.set("range", range);
    u.searchParams.set("limit", "8");
    u.searchParams.set("sample", "200");
    return u.toString();
  }, [range]);

  // Track the latest request to ignore stale responses.
  const reqIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const myReqId = ++reqIdRef.current;

    setLoading(true);
    setError("");

    (async () => {
      try {
        const res = await apiFetch(url);
        const ct = res.headers.get("Content-Type") || "";
        const data = ct.includes("application/json") ? await res.json() : { ok: false };
        if (cancelled || reqIdRef.current !== myReqId) return;

        if (data?.ok) {
          setSenders(Array.isArray(data.senders) ? data.senders : []);
          setMeta({
            sampled: data.sampled || 0,
            scanned: data.scanned || 0,
            limited: !!data.limited,
            note: data.note || "",
          });
        } else {
          setSenders([]);
          setMeta({ sampled: 0, scanned: 0, limited: false, note: "" });
          setError(data?.error || "Could not load top senders.");
        }
      } catch (e) {
        if (cancelled || reqIdRef.current !== myReqId) return;
        setError("Could not load top senders.");
        setSenders([]);
      } finally {
        if (!cancelled && reqIdRef.current === myReqId) setLoading(false);
      }
    })();

    // Cleanup: abort any in-flight identical request (optional; safe)
    return () => {
      cancelled = true;
      abortApi(`GET ${url}`);
    };
  }, [url]);

  return (
    <div className={className}>
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          Top senders
          {meta.sampled ? (
            <span className="ml-2 text-[10px] text-gray-500 rounded-full border px-2 py-0.5">
              sampled {meta.sampled}
            </span>
          ) : null}
        </h3>

        {loading ? (
          <p className="text-xs text-gray-500 mt-2">Loading...</p>
        ) : error ? (
          <p className="text-xs text-red-600 mt-2">{error}</p>
        ) : senders.length === 0 ? (
          <p className="text-xs text-gray-500 mt-2">No senders to show.</p>
        ) : (
          <>
            <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-2">
              {senders.map((s, i) => (
                <span
                  key={`${s.sender}-${i}`}
                  className="inline-flex items-center gap-2 rounded-full bg-white border px-3 py-1 text-xs shadow-sm shrink-0"
                  title={`${s.sender} • ${s.count}`}
                >
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-gray-700 font-semibold">
                    {String(s.sender).trim().charAt(0).toUpperCase() || "?"}
                  </span>
                  <span className="text-gray-800 whitespace-nowrap">{s.sender}</span>
                  <span className="ml-1 text-[10px] text-gray-500">{s.count}</span>
                </span>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-gray-500">
              Top senders computed from a sampled subset for speed on Free tier. Counts approximate the distribution.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
