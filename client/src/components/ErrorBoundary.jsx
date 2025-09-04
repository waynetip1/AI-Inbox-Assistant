import React from "react";

/**
 * Catches render errors so the UI never goes blank.
 * Shows a small inline panel and lets the user continue.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err, info) {
    // Keep this console to aid debugging during dev
    console.error("UI error caught by ErrorBoundary:", err, info);
  }
  render() {
    const { err } = this.state;
    if (err) {
      return (
        <div className="mx-auto max-w-3xl p-4">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <h2 className="font-semibold text-red-700">Something went wrong.</h2>
            <p className="text-xs text-red-700 mt-1 whitespace-pre-wrap">
              {String(err?.message || err)}
            </p>
            <button
              className="mt-3 text-sm underline text-red-700"
              onClick={() => this.setState({ err: null })}
            >
              Try to continue
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
