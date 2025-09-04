// client/src/components/PendingStatus.jsx
import React from "react";
import clsx from "clsx";

/**
 * Reusable pending indicator for API calls.
 *
 * Props:
 * - label: string (required) — main message, e.g., "Fetching snapshot…"
 * - sublabel: string (optional) — smaller help text, e.g., "This can take ~10–20s"
 * - variant: "spinner" | "bar" (default "spinner") — visual style
 * - progress: number 0–100 (optional) — when provided with variant="bar", shows a determinate bar
 * - className: string (optional) — extra wrapper classes
 */
export default function PendingStatus({
  label,
  sublabel,
  variant = "spinner",
  progress,
  className,
}) {
  const isDeterminate = typeof progress === "number" && progress >= 0 && progress <= 100;

  return (
    <div
      className={clsx(
        "w-full rounded-2xl border border-gray-200 bg-white/70 backdrop-blur p-4 sm:p-5 shadow-sm",
        "dark:border-gray-800 dark:bg-gray-900/60",
        className
      )}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-4">
        {/* Icon / motion */}
        {variant === "spinner" ? (
          <div className="shrink-0">
            <svg
              className="animate-spin h-6 w-6"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                className="opacity-25"
                fill="none"
              />
              <path
                d="M22 12a10 10 0 00-10-10"
                stroke="currentColor"
                strokeWidth="4"
                className="opacity-75"
                fill="none"
                strokeLinecap="round"
              />
            </svg>
          </div>
        ) : (
          <div className="w-24 shrink-0">
            {/* Progress bar shell */}
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              {isDeterminate ? (
                <div
                  className="h-2 rounded-full bg-indigo-500 transition-[width] duration-300"
                  style={{ width: `${progress}%` }}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress)}
                  role="progressbar"
                />
              ) : (
                <div className="relative h-2 w-full">
                  <div className="absolute inset-0 animate-[progress_1.2s_ease-in-out_infinite] bg-indigo-500 rounded-full" />
                  <style>{`
                    @keyframes progress {
                      0%   { transform: translateX(-100%); width: 35%; }
                      50%  { transform: translateX(20%);   width: 65%; }
                      100% { transform: translateX(100%);  width: 35%; }
                    }
                  `}</style>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Text */}
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {label}
          </div>
          {sublabel ? (
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {sublabel}
            </div>
          ) : null}
        </div>
      </div>

      {/* Subtle shimmer skeleton row (optional visual polish) */}
      <div className="mt-4 space-y-2">
        <div className="h-2 w-5/6 rounded bg-gray-200 dark:bg-gray-800 animate-pulse" />
        <div className="h-2 w-3/5 rounded bg-gray-200 dark:bg-gray-800 animate-pulse" />
      </div>
    </div>
  );
}
