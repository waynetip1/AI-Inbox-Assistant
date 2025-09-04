// client/src/components/TrendsView.jsx
import React, { useEffect, useMemo, useState } from "react";
import { Line } from "react-chartjs-2";
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
} from "chart.js";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

/**
 * Props:
 * - session: string (required)
 * - range: '1d' | '7d' | '30d' | '60d' | '90d' (required)
 */
export default function TrendsView({ session, range }) {
  // NOTE: backend returns { daily: [{ date, total, read, unread }], meta: { partial, notes } }
  const [points, setPoints] = useState([]); // [{ date, total, read, unread }]
  const [meta, setMeta] = useState({ partial: false, notes: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(
          `/api/trends?session=${encodeURIComponent(session)}&range=${encodeURIComponent(range)}`
        );
        if (!res.ok) {
          const t = await res.text();
          throw new Error(t || `Failed to load trends (${res.status})`);
        }
        const json = await res.json();
        if (!cancelled) {
          const list = Array.isArray(json.daily) ? json.daily : [];
          setPoints(list);
          setMeta({
            partial: Boolean(json?.meta?.partial),
            notes: json?.meta?.notes || "",
          });
        }
      } catch (e) {
        if (!cancelled) setErr(e.message || "Failed to load trends.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (session) load();
    return () => {
      cancelled = true;
    };
  }, [session, range]);

  const labels = useMemo(() => points.map((p) => p.date), [points]);

  const chartData = useMemo(
    () => ({
      labels,
      datasets: [
        {
          label: "Total",
          data: points.map((p) => p.total ?? 0),
          tension: 0.3,
          pointRadius: 2,
          fill: true,
        },
        {
          label: "Read",
          data: points.map((p) => p.read ?? 0),
          tension: 0.3,
          pointRadius: 2,
          fill: true,
        },
        {
          label: "Unread",
          data: points.map((p) => p.unread ?? 0),
          tension: 0.3,
          pointRadius: 2,
          fill: true,
        },
      ],
    }),
    [labels, points]
  );

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: "top" },
        title: { display: true, text: `Email Trends — ${range}` },
        tooltip: { mode: "index", intersect: false },
      },
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { ticks: { autoSkip: true, maxTicksLimit: 10 } },
        y: { beginAtZero: true, grace: "5%" },
      },
    }),
    [range]
  );

  return (
    <section className="w-full">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Trends</h2>
          <p className="text-sm text-gray-500">
            Showing chart for <span className="font-medium">{range}</span>
            {range !== "1d" ? " (visual only)" : " (with detail table)"}
          </p>
        </div>

        {/* Pending / partial badge */}
        {meta.partial && !loading && (
          <span
            className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"
            title={meta.notes || "Partial results within time budget"}
          >
            ● Pending
          </span>
        )}
      </div>

      {loading && (
        <div className="w-full rounded-xl border border-gray-200 p-4 text-sm text-gray-600">
          Loading trends…
        </div>
      )}

      {err && !loading && (
        <div className="w-full rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {err}
        </div>
      )}

      {!loading && !err && (
        <>
          <div className="relative h-64 w-full rounded-2xl border border-gray-100 p-2">
            <Line data={chartData} options={chartOptions} />
          </div>

          {/* Meta notes (optional, subtle) */}
          {meta.notes && (
            <p className="mt-2 text-xs text-gray-500">
              {meta.notes}
            </p>
          )}

          {/* Table is shown ONLY for 1d */}
          {range === "1d" && (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-gray-100">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-4 py-2">Date/Time</th>
                    <th className="px-4 py-2">Total</th>
                    <th className="px-4 py-2">Read</th>
                    <th className="px-4 py-2">Unread</th>
                  </tr>
                </thead>
                <tbody>
                  {points.length === 0 && (
                    <tr>
                      <td className="px-4 py-3 text-gray-500" colSpan={4}>
                        No data.
                      </td>
                    </tr>
                  )}
                  {points.map((p, idx) => (
                    <tr
                      key={`${p.date}-${idx}`}
                      className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}
                    >
                      <td className="px-4 py-2 font-medium">{p.date}</td>
                      <td className="px-4 py-2">{p.total ?? 0}</td>
                      <td className="px-4 py-2">{p.read ?? 0}</td>
                      <td className="px-4 py-2">{p.unread ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
