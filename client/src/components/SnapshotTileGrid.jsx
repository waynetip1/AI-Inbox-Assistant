import React, { useEffect, useMemo, useState } from "react";
import { getSnapshotPrefs } from "../utils/snapshotPrefs.js";

/**
 * SnapshotTileGrid
 * Generic tile grid that respects snapshot visibility preferences.
 *
 * Props:
 * - tiles: Array<{ id, label, value, note?, href?, onCopyQuery?, badge? }>
 * - renderTileBody?: (tile) => ReactNode // optional custom body (e.g., donut/mini chart)
 * - className?: string
 *
 * Notes:
 * - Right-click copies the query if onCopyQuery is provided.
 * - Long-press hint remains to match current UX.
 */
export default function SnapshotTileGrid({ tiles = [], renderTileBody, className = "" }) {
  const [visibleIds, setVisibleIds] = useState(() => getSnapshotPrefs().visible);

  // Listen for prefs updates dispatched by the CustomizeSnapshot modal
  useEffect(() => {
    const handler = (e) => {
      setVisibleIds(e.detail?.visible || getSnapshotPrefs().visible);
    };
    window.addEventListener("snapshot-prefs:updated", handler);
    return () => window.removeEventListener("snapshot-prefs:updated", handler);
  }, []);

  const visibleTiles = useMemo(() => {
    if (!Array.isArray(tiles) || tiles.length === 0) return [];
    const allow = new Set(visibleIds);
    // Always ensure at least Inbox shows if user somehow hid all
    const filtered = tiles.filter(t => allow.has(t.id));
    if (filtered.length > 0) return filtered;

    const inbox = tiles.find(t => t.id === "inbox");
    return inbox ? [inbox] : tiles.slice(0, 1); // last-resort: show first tile
  }, [tiles, visibleIds]);

  return (
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${className}`}>
      {visibleTiles.map((tile) => (
        <Tile key={tile.id} tile={tile} renderTileBody={renderTileBody} />
      ))}
    </div>
  );
}

function Tile({ tile, renderTileBody }) {
  const { label, value, note, href, onCopyQuery, badge } = tile;

  function handleContextMenu(e) {
    if (!onCopyQuery) return;
    e.preventDefault();
    const q = onCopyQuery();
    if (q) {
      navigator.clipboard?.writeText(q).catch(() => {});
    }
  }

  return (
    <div
      className="group relative rounded-2xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md"
      onContextMenu={handleContextMenu}
      title="Right-click to copy query • Long-press on mobile"
    >
      {/* top-right badge (exact/approx etc) */}
      {badge && (
        <span className="absolute right-2 top-2 rounded-md bg-gray-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          {badge}
        </span>
      )}

      <div className="flex items-baseline justify-between">
        <div className="text-sm text-gray-500">{label}</div>
        {href && (
          <a
            className="text-xs text-indigo-600 opacity-0 transition-opacity group-hover:opacity-100"
            href={href}
            rel="noopener noreferrer"
            target="_blank"
          >
            ↗ Open
          </a>
        )}
      </div>

      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {note && <div className="mt-1 text-xs text-gray-500">{note}</div>}

      {/* custom body (donut/mini chart) goes here when provided */}
      {renderTileBody ? <div className="mt-3">{renderTileBody(tile)}</div> : null}
    </div>
  );
}
