import React, { useEffect, useRef, useState, useMemo } from "react";
import "./index.css";
import AnalyzePanel from "./components/AnalyzePanel.jsx";
import PendingStatus from "./components/PendingStatus.jsx";
import TopSenders from "./components/TopSenders.jsx";
import TimeSavedMeter from "./components/TimeSavedMeter.jsx";
import TileLabel from "./components/TileLabel.jsx";

import CustomizeSnapshot from "./components/CustomizeSnapshot.jsx";
import ReorderSections from "./components/ReorderSections.jsx";
import { getSnapshotPrefs } from "./utils/snapshotPrefs.js";
import { getSectionOrder } from "./utils/sectionOrder.js";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

import { Line, Doughnut } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ArcElement,
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  ArcElement
);

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000";
const FIFTEEN_MINUTES = 15 * 60 * 1000;

// 🔒 Feature flag to avoid hitting an endpoint that may not exist yet
const USAGE_ENABLED = (import.meta.env.VITE_USAGE_ENABLED || "false").toLowerCase() === "true";

function getSessionIdFromUrl() {
  const sp = new URLSearchParams(window.location.search);
  return sp.get("session") || "TEST123";
}
function rangeLabel(r) {
  return { "1d": "1-Day", "7d": "7-Day", "30d": "30-Day", "60d": "60-Day", "90d": "90-Day" }[r] || r;
}

function InsightChips({ insights }) {
  if (!insights) return null;
  const items = [];
  if (insights.trend) {
    const t = insights.trend;
    items.push(`Trend: ${t.dir} ${t.pct}%`);
  }
  if (insights.peak) items.push(`Peak: ${insights.peak.date} • ${insights.peak.total}`);
  if (insights.quiet) items.push(`Quiet: ${insights.quiet.date} • ${insights.quiet.total}`);
  if (Array.isArray(insights.spikes) && insights.spikes.length > 0) {
    items.push(`Spikes: ${insights.spikes.length}`);
  }
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {items.map((txt, i) => (
        <span
          key={i}
          className="text-[11px] rounded-full border border-indigo-200 bg-indigo-50 text-indigo-800 px-2 py-0.5"
        >
          {txt}
        </span>
      ))}
    </div>
  );
}


function App() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const statsReqRef = useRef(0);
  const trendsReqRef = useRef(0);
  const [apiDown, setApiDown] = useState(false);
  const [apiStatus, setApiStatus] = useState("");

  const [stats, setStats] = useState(null);
  const [snapshotMeta, setSnapshotMeta] = useState(null);
  const [snapshotQueries, setSnapshotQueries] = useState(null);
  const [selectedRange, setSelectedRange] = useState("1d");
  const [snapshotCache, setSnapshotCache] = useState({});
  const [trendsData, setTrendsData] = useState(null);

  const [isSnapshotLoading, setIsSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState("");
  const [isTrendsLoading, setIsTrendsLoading] = useState(false);
  const [trendsError, setTrendsError] = useState("");

  const [usage, setUsage] = useState({ ok: false });
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageApiSuppressed, setUsageApiSuppressed] = useState(!USAGE_ENABLED); // off by default

  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeMeta, setAnalyzeMeta] = useState({ cached: 0, computed: 0 });
  const [analyzed, setAnalyzed] = useState([]);
  const [analyzeError, setAnalyzeError] = useState("");

  const [forceRefresh, setForceRefresh] = useState(false);
  const [exactScan, setExactScan] = useState(false);

  const [toast, setToast] = useState("");

  // preferences (tiles + user labels)
  const [visibleIds, setVisibleIds] = useState(() => getSnapshotPrefs().visible);
  const [userLabels, setUserLabels] = useState(() => getSnapshotPrefs().userLabels || []);
  // layout order
  const [sectionOrder, setSectionOrderState] = useState(() => getSectionOrder());

  const DEFAULT_EXACT_RANGES = new Set(["1d", "7d"]);
  const keyMapForMeta = {
    Inbox: "inbox",
    Unread: "unread",
    StarredImportant: "starredImportant",
    Spam: "spam",
    Sent: "sent",
    Drafts: "drafts",
    Promotions: "promotions",
    Social: "social",
    Updates: "updates",
    Forums: "forums",
    StarredOnly: "starred",
  };

  function decorateValueForApprox(labelKey, value, meta) {
    const set = new Set(meta?.saturatedKeys || []);
    const mKey = keyMapForMeta[labelKey];
    if (mKey && set.has(mKey) && meta?.estimated && !meta?.exact) {
      return `${value}+`;
    }
    return value;
  }

  useEffect(() => {
    const onPrefs = (e) => {
      const p = e.detail || getSnapshotPrefs();
      setVisibleIds(p.visible || []);
      setUserLabels(p.userLabels || []);
    };
    const onOrder = (e) => setSectionOrderState(e.detail || getSectionOrder());
    window.addEventListener("snapshot-prefs:updated", onPrefs);
    window.addEventListener("section-order:updated", onOrder);
    return () => {
      window.removeEventListener("snapshot-prefs:updated", onPrefs);
      window.removeEventListener("section-order:updated", onOrder);
    };
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setIsMenuOpen(false);
    }
    function onEsc(e) {
      if (e.key === "Escape") setIsMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [isMenuOpen]);

  async function apiFetch(input, init) {
    try {
      const res = await fetch(input, init);
      if (apiDown) setApiDown(false);
      if (res.status === 401) {
        let payload = {};
        try {
          if ((res.headers.get("Content-Type") || "").includes("application/json")) {
            payload = await res.clone().json();
          }
        } catch { }
        if (payload?.error === "NO_SESSION") {
          const sid = getSessionIdFromUrl();
          window.location.href = `${API_BASE}/auth/google?session=${encodeURIComponent(sid)}`;
        }
      }
      return res;
    } catch (e) {
      setApiDown(true);
      setApiStatus("Backend unreachable at " + API_BASE);
      throw e;
    }
  }

  async function pingHealth() {
    try {
      const r = await fetch(`${API_BASE}/health`, { cache: "no-store" });
      const ok = r.ok && (await r.json())?.ok;
      setApiDown(!ok);
      setApiStatus(ok ? "API OK" : "API responded but not OK");
    } catch {
      setApiDown(true);
      setApiStatus("Backend unreachable at " + API_BASE);
    }
  }
  useEffect(() => {
    pingHealth();
    const id = setInterval(() => {
      if (apiDown) pingHealth();
    }, 15000);
    return () => clearInterval(id);
  }, [apiDown]);

  async function fetchUsage() {
    if (usageApiSuppressed) return; // don't call if disabled
    const sid = getSessionIdFromUrl();
    if (!sid) return;
    setUsageLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/usage?session=${encodeURIComponent(sid)}`);
      if (res.status === 404) {
        // Not implemented yet — stop future calls for this session
        setUsageApiSuppressed(true);
        setUsage({ ok: false });
        return;
      }
      const ct = res.headers.get("Content-Type") || "";
      const json = ct.includes("application/json") ? await res.json() : null;
      setUsage(json?.ok ? json : { ok: false });
    } catch {
      setUsage({ ok: false });
    } finally {
      setUsageLoading(false);
    }
  }

  const fetchStats = async (range, opts = {}) => {
    const { exact = false, skipCache = false } = opts;
    const sid = getSessionIdFromUrl();
    if (!sid) return;

    const myReqId = ++statsReqRef.current;   // <-- mark this request as the latest

    const cached = snapshotCache[range];
    const isExpired = cached && Date.now() - cached.timestamp > FIFTEEN_MINUTES;
    if (!skipCache && cached && !isExpired && !forceRefresh && (!exact || cached?.meta?.exact)) {
      // Only apply cached if still the latest request for this range
      if (statsReqRef.current === myReqId) {
        setStats(cached.stats);
        setSnapshotMeta(cached.meta || null);
        setSnapshotQueries(cached.queries || null);
      }
      return;
    }

    setIsSnapshotLoading(true);
    setSnapshotError("");

    try {
      const wantExact = exact || DEFAULT_EXACT_RANGES.has(range);
      const url = `${API_BASE}/api/stats?session=${encodeURIComponent(sid)}&range=${encodeURIComponent(range)}${wantExact ? "&exact=true" : ""
        }`;

      const res = await apiFetch(url, { cache: "no-store" });  // <-- avoid 304 races
      if (!res.ok) throw new Error(`Failed (${res.status})`);

      const json = await res.json();

      // If another request started after this one (or user switched range), bail out
      if (statsReqRef.current !== myReqId || selectedRange !== range) return;

      if (json?.totals) {
        const normalized = {
          Inbox: json.totals.inbox ?? 0,
          Unread: json.totals.unread ?? 0,
          StarredImportant: json.totals.starredImportant ?? 0,
          Spam: json.totals.spam ?? 0,
          Sent: json.totals.sent ?? 0,
          Drafts: json.totals.drafts ?? 0,
          Personal: json.totals.personal ?? 0,
          Promotions: json.totals.promotions ?? 0,
          Social: json.totals.social ?? 0,
          Updates: json.totals.updates ?? 0,
          Forums: json.totals.forums ?? 0,
          StarredOnly: json.totals.starred ?? 0,
        };

        setSnapshotCache((prev) => ({
          ...prev,
          [range]: { stats: normalized, meta: json.meta || null, queries: json.queries || null, timestamp: Date.now() },
        }));

        setStats(normalized);
        setSnapshotMeta(json.meta || null);
        setSnapshotQueries(json.queries || null);
      } else {
        setStats(null);
        setSnapshotMeta(null);
        setSnapshotQueries(null);
      }
    } catch {
      if (statsReqRef.current === myReqId) {
        setSnapshotError(apiDown ? "Backend offline — retry after it comes back." : "Could not load stats.");
      }
    } finally {
      if (statsReqRef.current === myReqId) {
        setIsSnapshotLoading(false);
        setForceRefresh(false);
      }
    }
  };
  const fetchTrends = async (range) => {
    const sid = getSessionIdFromUrl();
    if (!sid) return;

    const myReqId = ++trendsReqRef.current;

    setIsTrendsLoading(true);
    setTrendsError("");

    try {
      const res = await apiFetch(
        `${API_BASE}/api/trends?session=${encodeURIComponent(sid)}&range=${encodeURIComponent(range)}`,
        { cache: "no-store" }  // avoid cached 304 races
      );
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const json = await res.json();

      if (trendsReqRef.current !== myReqId || selectedRange !== range) return; // stale
      if (json?.ok) setTrendsData(json);
    } catch {
      if (trendsReqRef.current === myReqId) {
        setTrendsError(apiDown ? "Backend offline — retry after it comes back." : "Could not load trends.");
      }
    } finally {
      if (trendsReqRef.current === myReqId) setIsTrendsLoading(false);
    }
  };


  async function runAnalyze(limit = 5) {
    const sid = getSessionIdFromUrl();
    if (!sid) return;
    setAnalyzeLoading(true);
    setAnalyzeError("");
    try {
      const url = `${API_BASE}/api/emails/analyze?session=${encodeURIComponent(
        sid
      )}&limit=${limit}&q=${encodeURIComponent("is:unread newer_than:7d")}`;
      const res = await apiFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const cached = Number(res.headers.get("X-Analyze-Cached") || 0);
      const computed = Number(res.headers.get("X-Analyze-Computed") || 0);
      const ct = res.headers.get("Content-Type") || "";
      const body = ct.includes("application/json") ? await res.json() : { ok: false, error: await res.text() };
      setAnalyzeMeta({ cached, computed });
      setAnalyzed(Array.isArray(body.analyzed) ? body.analyzed : []);
      if (!res.ok || body?.error) setAnalyzeError(body?.error || `Analyze failed (${res.status})`);
      if (computed > 0 && USAGE_ENABLED) fetchUsage();
    } catch {
      setAnalyzeError(apiDown ? "Backend offline — retry after it comes back." : "Analyze failed.");
    } finally {
      setAnalyzeLoading(false);
    }
  }

  useEffect(() => {
    const wantsExact = DEFAULT_EXACT_RANGES.has(selectedRange);
    fetchStats(selectedRange, { exact: wantsExact });
    fetchTrends(selectedRange);
  }, [selectedRange, forceRefresh]);


  useEffect(() => {
    if (USAGE_ENABLED) fetchUsage(); // only call if explicitly enabled
  }, []);

  const handleRefresh = () => {
    setForceRefresh(true);
    if (USAGE_ENABLED) fetchUsage();
  };

  const lastUpdated = snapshotCache[selectedRange]?.timestamp;
  const formattedTimestamp = lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : null;

  const isOneDay = selectedRange === "1d";
  const shouldShowLine = trendsData?.daily?.length > 0 && !isOneDay;
  const lineData = useMemo(
    () =>
      shouldShowLine
        ? {
          labels: trendsData.daily.map((d) => String(d.date).replace("ΓÇô", "–")),
          datasets: [
            {
              label: "Total Emails",
              data: trendsData.daily.map((d) => d.total),
              borderColor: "rgb(59,130,246)",
              backgroundColor: "rgba(59,130,246,0.25)",
              fill: true,
            },
            {
              label: "Read",
              data: trendsData.daily.map((d) => d.read),
              borderColor: "rgb(34,197,94)",
              backgroundColor: "rgba(34,197,94,0.25)",
              fill: true,
            },
            {
              label: "Unread",
              data: trendsData.daily.map((d) => d.unread),
              borderColor: "rgb(239,68,68)",
              backgroundColor: "rgba(239,68,68,0.25)",
              fill: true,
            },
          ],
        }
        : null,
    [shouldShowLine, trendsData]
  );

  const donutData = useMemo(() => {
    if (!isOneDay || !stats) return null;
    const vals = [
      stats.Personal ?? 0,
      stats.Promotions ?? 0,
      stats.Social ?? 0,
      stats.Updates ?? 0,
      stats.Forums ?? 0,
    ];
    const total = vals.reduce((a, b) => a + b, 0);
    if (total === 0) return null;

    return {
      labels: ["Primary", "Promotions", "Social", "Updates", "Forums"],
      datasets: [
        {
          label: "Today",
          data: vals,
          backgroundColor: [
            "rgba(59,130,246,0.6)",
            "rgba(234,179,8,0.6)",
            "rgba(168,85,247,0.6)",
            "rgba(34,197,94,0.6)",
            "rgba(99,102,241,0.6)",
          ],
          borderColor: [
            "rgb(59,130,246)",
            "rgb(234,179,8)",
            "rgb(168,85,247)",
            "rgb(34,197,94)",
            "rgb(99,102,241)",
          ],
          borderWidth: 1,
        },
      ],
    };
  }, [isOneDay, stats]);

  const inferScope = (q = "") => {
    if (q.includes("in:inbox")) return "Inbox";
    if (q.includes("in:sent")) return "Sent";
    if (q.includes("in:spam")) return "Spam";
    if (q.includes("in:drafts")) return "Drafts";
    return "Mailbox";
  };
  const extractWindow = (inboxQ = "") => inboxQ.replace(/\bin:\S+\s*/g, "").trim();
  const orParens = (s) => `(${s})`;

  const queriesForTiles = useMemo(() => {
    const q = snapshotQueries || {};
    const windowPart = extractWindow(q.inbox || "");
    const withWin = (base, extra = "") => [base, windowPart, extra].filter(Boolean).join(" ").trim();

    return {
      Inbox: q.inbox || "",
      Unread: q.unread || withWin("in:inbox", "is:unread"),
      StarredImportant: q.starredImportant || withWin("in:inbox", orParens("is:starred OR is:important")),
      Spam: q.spam || withWin("in:spam"),
      Sent: q.sent || withWin("in:sent"),
      Drafts: q.drafts || withWin("in:drafts"),
      Personal:
        q.personal || withWin("in:inbox", "-category:promotions -category:social -category:updates -category:forums"),
      Promotions: q.promotions || withWin("in:inbox", "category:promotions"),
      Social: q.social || withWin("in:inbox", "category:social"),
      Updates: q.updates || withWin("in:inbox", "category:updates"),
      Forums: q.forums || withWin("in:inbox", "category:forums"),
      StarredOnly: q.starred || withWin("in:inbox", "is:starred"),
    };
  }, [snapshotQueries, selectedRange]);

  const showToast = (msg) => {
    setToast(msg);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(""), 1400);
  };

  const openInGmail = (query) => {
    if (!query) {
      showToast("No search for this tile");
      return;
    }
    const url = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(query)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  function MetricTile({ icon, label, labelShort, value, title, query }) {
    const touchTimer = useRef(null);
    const handleTouchStart = () => {
      if (!query) return;
      touchTimer.current = window.setTimeout(async () => {
        try {
          await navigator.clipboard.writeText(query);
          showToast("Copied Gmail search");
        } catch { }
      }, 520);
    };
    const clearTouch = () => {
      if (touchTimer.current) {
        window.clearTimeout(touchTimer.current);
        touchTimer.current = null;
      }
    };
    const handleContextMenu = async (e) => {
      if (!query) return;
      e.preventDefault();
      if (e.shiftKey) {
        openInGmail(query);
        return;
      }
      try {
        await navigator.clipboard.writeText(query);
        showToast("Copied Gmail search");
      } catch { }
    };

    return (
      <li
        className="relative w-full rounded-xl border border-gray-200 p-2.5 md:p-3 pb-6 md:pb-7 pr-8 md:pr-9 flex flex-col items-start gap-1.5 min-h-[64px] md:min-h-[72px] cursor-help group"
        title={title}
        aria-label={title}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={clearTouch}
        onTouchCancel={clearTouch}
        onTouchMove={clearTouch}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openInGmail(query);
          }}
          className="absolute right-2 bottom-2 rounded-md border border-gray-200 bg-white/90 px-2 py-0.5 text-[10px] text-gray-700 shadow-sm hover:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
          title={`Open in Gmail: ${label}`}
          aria-label={`Open in Gmail: ${label}`}
        >
          ↗ Open
        </button>

        <div className="flex items-center gap-2 w-full">
          <div className="text-xl leading-none shrink-0">{icon}</div>
          <TileLabel label={label} short={labelShort} />
        </div>
        <div className="mt-0.5 text-xl md:text-2xl font-semibold leading-none">{value}</div>
      </li>
    );
  }

  const shouldShow = (key) => visibleIds.includes(key);

  const buildCore = useMemo(() => {
    if (!stats) return [];
    const q = queriesForTiles;
    const rows = [
      { key: "Inbox", label: "Inbox", icon: "📥", value: stats.Inbox ?? 0, title: (q.Inbox ? `Gmail search: ${q.Inbox}\nScope: ${inferScope(q.Inbox)}` : null) || "Total emails received in Inbox.", query: q.Inbox },
      { key: "Unread", label: "Unread", icon: "✉️", value: stats.Unread ?? 0, title: (q.Unread ? `Gmail search: ${q.Unread}\nScope: ${inferScope(q.Unread)}` : null) || "Unread in Inbox.", query: q.Unread },
      { key: "StarredImportant", label: "Starred / Important", icon: "⭐", value: stats.StarredImportant ?? 0, title: (q.StarredImportant ? `Gmail search: ${q.StarredImportant}\nScope: ${inferScope(q.StarredImportant)}` : null) || "Starred or Important in Inbox.", query: q.StarredImportant },
      { key: "Spam", label: "Spam / Junk", icon: "🗑️", value: stats.Spam ?? 0, title: (q.Spam ? `Gmail search: ${q.Spam}\nScope: ${inferScope(q.Spam)}` : null) || "Spam folder messages.", query: q.Spam },
      { key: "Sent", label: "Sent", icon: "📤", value: stats.Sent ?? 0, title: (q.Sent ? `Gmail search: ${q.Sent}\nScope: ${inferScope(q.Sent)}` : null) || "Messages in Sent.", query: q.Sent },
      { key: "Drafts", label: "Drafts", icon: "📝", value: stats.Drafts ?? 0, title: (q.Drafts ? `Gmail search: ${q.Drafts}\nScope: ${inferScope(q.Drafts)}` : null) || "Draft messages.", query: q.Drafts },
    ];
    return rows.filter((r) => shouldShow(r.key));
  }, [stats, queriesForTiles, visibleIds]);

  const buildCats = useMemo(() => {
    if (!stats) return [];
    const q = queriesForTiles;
    const personalExplain = [
      "Calculated: Inbox − (Promotions + Social + Updates + Forums).",
      q.Inbox ? `Inbox: ${q.Inbox}` : "",
      q.Promotions ? `Promotions: ${q.Promotions}` : "",
      q.Social ? `Social: ${q.Social}` : "",
      q.Updates ? `Updates: ${q.Updates}` : "",
      q.Forums ? `Forums: ${q.Forums}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const rows = [
      { key: "Personal", label: "Primary / Personal", labelShort: "Primary", icon: "👤", value: stats.Personal ?? 0, title: personalExplain || (q.Personal ? `Gmail search: ${q.Personal}\nScope: ${inferScope(q.Personal)}` : "") || "Primary category estimated from Inbox minus other categories.", query: q.Personal },
      { key: "Promotions", label: "Promotions", labelShort: "Promo", icon: "🔔", value: stats.Promotions ?? 0, title: (q.Promotions ? `Gmail search: ${q.Promotions}\nScope: ${inferScope(q.Promotions)}` : null) || "Inbox, category:promotions", query: q.Promotions },
      { key: "Social", label: "Social", icon: "👥", value: stats.Social ?? 0, title: (q.Social ? `Gmail search: ${q.Social}\nScope: ${inferScope(q.Social)}` : null) || "Inbox, category:social", query: q.Social },
      { key: "Updates", label: "Updates", icon: "🔄", value: stats.Updates ?? 0, title: (q.Updates ? `Gmail search: ${q.Updates}\nScope: ${inferScope(q.Updates)}` : null) || "Inbox, category:updates", query: q.Updates },
      { key: "Forums", label: "Forums", icon: "💬", value: stats.Forums ?? 0, title: (q.Forums ? `Gmail search: ${q.Forums}\nScope: ${inferScope(q.Forums)}` : null) || "Inbox, category:forums", query: q.Forums },
      { key: "StarredOnly", label: "Starred (Inbox)", labelShort: "Starred", icon: "⭐", value: stats.StarredOnly ?? 0, title: (q.StarredOnly ? `Gmail search: ${q.StarredOnly}\nScope: ${inferScope(q.StarredOnly)}` : null) || "Inbox, is:starred", query: q.StarredOnly },
    ];
    return rows.filter((r) => shouldShow(r.key));
  }, [stats, queriesForTiles, visibleIds]);

  const labelTiles = useMemo(() => {
    if (!Array.isArray(userLabels) || userLabels.length === 0) return [];
    const windowPart = extractWindow(queriesForTiles.Inbox || "");
    const mkQuery = (name) => {
      const needsQuotes = /\s/.test(name);
      const labelFrag = needsQuotes ? `label:"${name}"` : `label:${name}`;
      return ["in:inbox", windowPart, labelFrag].filter(Boolean).join(" ").trim();
    };
    return userLabels.map((name) => ({
      key: `LBL::${name}`,
      label: name,
      icon: "🏷️",
      value: "–",
      title: `Gmail search: ${mkQuery(name)}\nScope: Inbox`,
      query: mkQuery(name),
    }));
  }, [userLabels, queriesForTiles, selectedRange]);

  const runExactScan = async () => {
    try {
      setExactScan(true);
      await fetchStats(selectedRange, { exact: true, skipCache: true });
    } finally {
      setExactScan(false);
    }
  };

  const SectionHeaderActions = ({ visible }) => (!visible ? null : <ReorderSections />);

  const SnapshotSection = ({ isTop }) => (
    <section>
      <div className="bg-white shadow rounded-2xl p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">📊 {rangeLabel(selectedRange)} Snapshot</h2>
          <div className="flex items-center gap-2">
            <CustomizeSnapshot />
            <SectionHeaderActions visible={isTop} />
            {formattedTimestamp && <p className="text-xs text-gray-500">Updated {formattedTimestamp}</p>}
            {snapshotMeta ? (() => {
  const isExact   = snapshotMeta?.exact === true;
  const isPartial = !isExact && Array.isArray(snapshotMeta?.saturatedKeys) && snapshotMeta.saturatedKeys.length > 0;
  const note      = snapshotMeta?.note || (isExact
                    ? "Exact counts across pages."
                    : isPartial
                      ? "Exact scan ran but hit safety caps — counts are lower bounds."
                      : "Fast estimate with label filters.");

  return (
    <>
      <span
        className={
          "text-[10px] rounded-full border px-2 py-0.5 " +
          (isExact
            ? "bg-emerald-50 text-emerald-800 border-emerald-200"
            : isPartial
              ? "bg-sky-50 text-sky-800 border-sky-200"
              : "bg-amber-50 text-amber-800 border-amber-200")
        }
        title={note}
      >
        {isExact ? "Exact" : isPartial ? "Partial exact" : "Approximate"}
      </span>

      {!isSnapshotLoading && (
        <button
          onClick={runExactScan}
          className={
            "text-xs underline " +
            (isExact ? "text-emerald-700 hover:text-emerald-800"
                     : "text-amber-700 hover:text-amber-800")
          }
          title={`Run exact scan for ${rangeLabel(selectedRange)}`}
        >
          {isExact ? "Re-run exact" : "Run exact scan"}
        </button>
      )}
    </>
  );
})() : null}

          </div>
        </div>

        {isSnapshotLoading ? (
          <PendingStatus label={exactScan ? "Running exact scan…" : "Fetching snapshot…"} variant="bar" />
        ) : snapshotError ? (
          <p className="text-red-500">{snapshotError}</p>
        ) : stats ? (
          <>
            <h3 className="text-xs font-semibold text-gray-500 mb-2">Core snapshot</h3>
            <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 md:gap-3 lg:gap-4 mb-4">
              {buildCore.map((m) => (
                <MetricTile key={m.key} icon={m.icon} label={m.label} labelShort={m.labelShort} value={decorateValueForApprox(m.key, m.value, snapshotMeta)} title={m.title} query={m.query} />
              ))}
            </ul>

            <h3 className="text-xs font-semibold text-gray-500 mb-2">By category & tags</h3>
            <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 md:gap-3 lg:gap-4 mb-4">
              {buildCats.map((m) => (
                <MetricTile key={m.key} icon={m.icon} label={m.label} labelShort={m.labelShort} value={decorateValueForApprox(m.key, m.value, snapshotMeta)} title={m.title} query={m.query} />
              ))}
            </ul>

            {labelTiles.length > 0 && (
              <>
                <h3 className="text-xs font-semibold text-gray-500 mb-2">Your labels</h3>
                <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 md:gap-3 lg:gap-4 mb-2">
                  {labelTiles.map((m) => (
                    <MetricTile key={m.key} icon={m.icon} label={m.label} labelShort={m.label} value={m.value} title={m.title} query={m.query} />
                  ))}
                </ul>
                <p className="text-[10px] text-gray-500 mb-2">Label counts coming soon.</p>
              </>
            )}

            <TimeSavedMeter stats={stats} range={selectedRange} />

            <p className="mt-2 text-[10px] text-gray-500">
              Tip: <span className="font-medium">Tap ↗ to open</span>. Long-press a tile to copy its Gmail search.
              (Desktop: right-click → copy, Shift+right-click → open.)
            </p>
          </>
        ) : (
          <p className="text-gray-500">No data available.</p>
        )}
      </div>
    </section>
  );

  const TrendsSection = ({ isTop }) => (
    <section>
      <div className="bg-white shadow rounded-2xl p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold">📈 Trends ({rangeLabel(selectedRange)})</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{isOneDay ? "Today’s category split" : "Totals over time"}</span>
            <SectionHeaderActions visible={isTop} />
          </div>
        </div>

        {isTrendsLoading ? (
          <PendingStatus label="Building trends…" variant="bar" />
        ) : trendsError ? (
          <p className="text-red-500">{trendsError}</p>
        ) : isOneDay ? (
          donutData ? (
            <>
              <div className="h-64">
                <Doughnut
                  data={donutData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: "65%",
                    plugins: { legend: { position: "right" } },
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Today’s split by Gmail categories. Unread per category is estimated proportionally.
              </p>
            </>
          ) : (
            <p className="text-gray-500">No data for today.</p>
          )
        ) : shouldShowLine ? (
          <>
          <InsightChips insights={trendsData?.insights} />
          <div className="h-72">
            <Line
              data={lineData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: "top" } },
                interaction: { intersect: false, mode: "index" },
                scales: { x: { ticks: { autoSkip: true, maxTicksLimit: 12 } } },
              }}
            />
          </div>
          </>
        ) : (
          <p className="text-gray-500">No trends data available.</p>
        )}

        <TopSenders className="mt-6" range={selectedRange} />
      </div>
    </section>
  );

  const AnalyzeSection = ({ isTop }) => (
    <section>
      {isTop && (
        <div className="mb-2 flex justify-end">
          <ReorderSections />
        </div>
      )}
      <AnalyzePanel />
    </section>
  );

  const sectionsMap = {
    snapshot: (isTop) => <SnapshotSection key="snapshot" isTop={isTop} />,
    trends: (isTop) => <TrendsSection key="trends" isTop={isTop} />,
    analyze: (isTop) => <AnalyzeSection key="analyze" isTop={isTop} />,
  };

  const orderedSections = sectionOrder.map((k, i) => sectionsMap[k]?.(i === 0)).filter(Boolean);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-100 text-gray-900">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur border-b">
          <div className="mx-auto max-w-6xl px-4 py-3">
            <div className="grid grid-cols-[auto,1fr,auto] items-center gap-2">
              <div className="relative" ref={menuRef}>
                <button
                  aria-haspopup="menu"
                  aria-expanded={isMenuOpen}
                  onClick={() => setIsMenuOpen((v) => !v)}
                  className="inline-flex items-center rounded-md border bg-white px-2 py-1 text-xs hover:bg-gray-50"
                  title="Menu"
                >
                  ☰ Menu
                </button>
                {isMenuOpen && (
                  <>
                    <div
                      role="menu"
                      className="absolute left-0 mt-2 w-48 rounded-lg border border-gray-200 bg-white shadow-lg z-50"
                    >
                      <button
                        role="menuitem"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={() => {
                          setForceRefresh(true);
                          setIsMenuOpen(false);
                        }}
                      >
                        🔄 Refresh data
                      </button>
                      <button
                        role="menuitem"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={() => {
                          const sid = getSessionIdFromUrl();
                          window.location.href = `${API_BASE}/auth/google?session=${encodeURIComponent(sid)}`;
                        }}
                      >
                        🔐 Re-authenticate (Google)
                      </button>
                      <button
                        role="menuitem"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={() => window.open(`${API_BASE}/health`, "_blank")}
                      >
                        ❤️ Open /health
                      </button>
                      <button
                        role="menuitem"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        onClick={() => window.open(`${API_BASE}/api/debug/session`, "_blank")}
                      >
                        🛠 Debug session
                      </button>
                    </div>
                    <button
                      aria-hidden="true"
                      className="fixed inset-0 z-40 cursor-default"
                      onClick={() => setIsMenuOpen(false)}
                      tabIndex={-1}
                      style={{ background: "transparent" }}
                    />
                  </>
                )}
              </div>

              <h1 className="text-2xl font-bold text-center whitespace-nowrap overflow-hidden text-ellipsis">
                📬 AI Inbox Assistant
              </h1>

              <div className="justify-self-end flex items-center gap-2">
                <span className="text-xs text-gray-500">Provider</span>
                <span className="text-xs rounded-full bg-gray-900 text-white px-2 py-1">Gemini</span>
                <span className="text-xs text-gray-500">Daily</span>
                <span className="text-xs rounded-full bg-white border px-2 py-1 min-w-[64px] text-center">
                  {usageLoading ? "…" : usage?.ok ? `${usage.used}/${usage.limit}` : "0/30"}
                </span>
              </div>
            </div>
          </div>
        </header>

        {apiDown && (
          <div className="bg-red-50 border-b border-red-200">
            <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
              <div className="text-sm text-red-800">⚠️ Backend offline. {apiStatus}</div>
              <div className="flex items-center gap-2">
                <a href={`${API_BASE}/health`} target="_blank" rel="noreferrer" className="text-sm underline">
                  Open /health
                </a>
                <button
                  onClick={pingHealth}
                  className="text-sm px-3 py-1 rounded bg-red-600 text-white hover:bg-red-500"
                >
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="mx-auto max-w-6xl px-4 py-6">
          <p className="text-center text-gray-500 mb-6">Session ID: {getSessionIdFromUrl()}</p>

          <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
            {["1d", "7d", "30d", "60d", "90d"].map((r) => (
              <button
                key={r}
                className={`px-3 py-1 rounded ${selectedRange === r ? "bg-purple-600 text-white" : "bg-gray-200"}`}
                onClick={() => setSelectedRange(r)}
                disabled={apiDown}
              >
                {r}
              </button>
            ))}
            <button
              className="px-3 py-1 bg-amber-500 text-white rounded disabled:opacity-60"
              onClick={handleRefresh}
              disabled={apiDown}
            >
              🔄 Refresh
            </button>
          </div>

          <div className="space-y-6">{orderedSections}</div>
        </main>

        {toast && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
            <div className="rounded-full bg-black text-white text-xs px-3 py-2 shadow">{toast}</div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

export default App;
