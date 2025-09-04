// client/src/components/TileLabel.jsx
import React from "react";

/**
 * Snapshot tile label with responsive short/full versions.
 * Props:
 *  - label: full text (e.g., "Primary / Personal")
 *  - short: short text used on small screens (e.g., "Primary")
 */
export default function TileLabel({ label, short }) {
  return (
     <span className="tile-label block text-gray-600 leading-snug text-[11px] sm:text-[12px]">
      {/* Mobile: short, single line */}
      <span className="sm:hidden whitespace-nowrap truncate">{short || label}</span>
      {/* Desktop/tablet: full, allow natural wrapping */}
      <span className="hidden sm:block whitespace-normal">{label}</span>
    </span>
  );
}
