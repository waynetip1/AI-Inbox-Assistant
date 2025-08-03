import React, { useEffect, useRef, useState } from 'react';
import './index.css';

function App() {
  const [collapsed, setCollapsed] = useState(
    typeof window !== 'undefined' && window.innerWidth < 768
  );
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshotCache, setSnapshotCache] = useState({});
  const [selectedRange, setSelectedRange] = useState('1d');
  const [forceRefresh, setForceRefresh] = useState(false);

  const sidebarRef = useRef(null);
  const FIFTEEN_MINUTES = 15 * 60 * 1000;
  const isMobile = () =>
    typeof window !== 'undefined' && window.innerWidth < 768;

  const toggleSidebar = () => setCollapsed(!collapsed);

  // Close sidebar when clicking outside (mobile only)
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        isMobile() &&
        !collapsed &&
        sidebarRef.current &&
        !sidebarRef.current.contains(event.target) &&
        !event.target.closest('#mobileMenuButton')
      ) {
        setCollapsed(true);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [collapsed]);

  const getSessionIdFromUrl = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('session');
  };

  const fetchStats = async (range, bypassCache = false) => {
    const sessionId = getSessionIdFromUrl();
    if (!sessionId) return;

    const cached = snapshotCache[range];
    const isExpired =
      cached && Date.now() - cached.timestamp > FIFTEEN_MINUTES;

    if (!bypassCache && cached && !isExpired) {
      if (range === selectedRange) setStats(cached.stats);
      return;
    }

    if (range === selectedRange) {
      setLoading(true);
      setError('');
      setStats(null);
    }

    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_BASE_URL}/api/stats?session=${sessionId}&range=${range}`
      );

      if (!res.ok) throw new Error('Failed to fetch stats');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullText = '';

      const readAll = async () => {
        const { done, value } = await reader.read();
        if (done) {
          const lines = fullText
            .split('\n')
            .filter((line) => line.startsWith('data: '))
            .map((line) => JSON.parse(line.replace('data: ', '')));
          const merged = Object.assign({}, ...lines);

          setSnapshotCache((prev) => ({
            ...prev,
            [range]: {
              stats: merged.stats,
              timestamp: Date.now(),
            },
          }));

          if (range === selectedRange) setStats(merged.stats);
          return;
        }

        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        return readAll();
      };

      await readAll();
    } catch (err) {
      if (range === selectedRange) setError('Could not load stats.');
    } finally {
      if (range === selectedRange) setLoading(false);
      setForceRefresh(false);
    }
  };

  useEffect(() => {
    fetchStats(selectedRange, forceRefresh);
  }, [selectedRange, forceRefresh]);

  useEffect(() => {
    const rangesToPrefetch = ['30d', '60d', '90d', '1y'];
    const sessionId = getSessionIdFromUrl();
    if (!sessionId) return;

    rangesToPrefetch.forEach((range, i) => {
      setTimeout(() => {
        fetchStats(range, false);
      }, 1000 + i * 500);
    });
  }, []);

  const getSnapshotLabel = (range) => {
    switch (range) {
      case '1d':
        return '1-Day Snapshot';
      case '7d':
        return '7-Day Snapshot';
      case '30d':
        return '30-Day Snapshot';
      case '60d':
        return '60-Day Snapshot';
      case '90d':
        return '90-Day Snapshot';
      case '1y':
        return '1-Year Snapshot';
      default:
        return '';
    }
  };

  const handleRangeClick = (range) => {
    setSelectedRange(range);
    setForceRefresh(false);
  };

  const handleRefresh = () => {
    setSnapshotCache((prev) => {
      const updated = { ...prev };
      delete updated[selectedRange];
      return updated;
    });
    setForceRefresh(true);
  };

  const lastUpdated = snapshotCache[selectedRange]?.timestamp;
  const formattedTimestamp = lastUpdated
    ? new Date(lastUpdated).toLocaleTimeString()
    : null;

  return (
    <div className="flex h-screen bg-gray-100 text-gray-900 relative">
      {/* Mobile toggle button */}
      {isMobile() && (
        <button
          id="mobileMenuButton"
          onClick={toggleSidebar}
          className="fixed top-4 left-4 z-[100] bg-indigo-700 text-white p-2 rounded shadow-md hover:bg-indigo-600 transition-all duration-200"
        >
          {collapsed ? '☰' : '✖'}
        </button>
      )}

      {/* Sidebar overlay for mobile */}
      {!collapsed && isMobile() && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          onClick={() => setCollapsed(true)}
        ></div>
      )}

      {/* Sidebar */}
      <div
        ref={sidebarRef}
        className={`
          ${isMobile() ? 'fixed' : 'relative'}
          top-0 left-0 h-full z-50
          transform transition-all duration-300 ease-in-out
          ${isMobile()
            ? collapsed
              ? '-translate-x-full opacity-0'
              : 'translate-x-0 opacity-100'
            : ''}
          ${collapsed && !isMobile() ? 'w-16' : !isMobile() ? 'w-40 sm:w-56' : 'w-56'}
          bg-gradient-to-b from-indigo-900 to-slate-900 text-white
          flex flex-col p-3
          shadow-lg border-r border-slate-800
        `}
      >
        {!collapsed && isMobile() && <div className="h-14" />}

        {!collapsed && (
          <>
            <div className="p-2 hover:bg-indigo-700 rounded cursor-pointer">📥</div>
            <div className="p-2 hover:bg-indigo-700 rounded cursor-pointer">📊</div>
            <div className="p-2 hover:bg-indigo-700 rounded cursor-pointer">⚙️</div>
            <div className="p-2 hover:bg-indigo-700 rounded cursor-pointer">➕</div>
          </>
        )}
      </div>

      {/* Main content */}
      <div
        className={`flex-1 overflow-y-auto transition-all duration-300
          ${collapsed && !isMobile() ? 'sm:ml-20' : !isMobile() ? 'sm:ml-56' : ''}
          ${isMobile() ? 'pt-16 px-8' : 'p-8'}
        `}
      >
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-6 text-center">
          📬 AI Inbox Assistant
        </h1>

        {/* Login */}
        <div className="mb-6 text-center">
          <button
            onClick={() => {
              window.location.href = `${import.meta.env.VITE_API_BASE_URL}/auth/google`;
            }}
            className="px-5 py-2 bg-indigo-500 hover:bg-indigo-400 text-white rounded shadow transition-all duration-200"
          >
            🔐 Login with Google
          </button>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Stats */}
          <div className="bg-white rounded-xl shadow-lg p-8">
            <div className="flex flex-wrap gap-2 mb-4">
              {['1d', '7d', '30d', '60d', '90d', '1y'].map((range) => (
                <button
                  key={range}
                  className={`px-3 py-1 rounded transition-all duration-200 ${
                    selectedRange === range
                      ? 'bg-indigo-500 text-white'
                      : 'bg-gray-200 hover:bg-gray-300'
                  }`}
                  onClick={() => handleRangeClick(range)}
                >
                  {range === '1y' ? '1 Year' : `${range.replace('d', '')} Day`}
                </button>
              ))}
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-white rounded transition-all duration-200"
              >
                🔄 Refresh
              </button>
            </div>

            <h2
              className="text-lg font-semibold mb-3 text-gray-800 relative group cursor-help"
            >
              📊 {getSnapshotLabel(selectedRange)}
              {formattedTimestamp && (
                <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1 w-max bg-gray-800 text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                  Last updated: {formattedTimestamp}
                </span>
              )}
            </h2>

            {loading ? (
              <p className="text-gray-500">Loading...</p>
            ) : error ? (
              <p className="text-red-500">{error}</p>
            ) : stats ? (
              <div className="grid grid-cols-2 gap-4">
                {Object.entries(stats).map(([key, value]) => (
                  <div key={key} className="text-gray-700">
                    <strong>{key}:</strong>{' '}
                    {typeof value === 'string' && value.startsWith('~') ? (
                      <span className="relative group cursor-help">
                        {value}
                        <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1 w-max bg-gray-800 text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                          Estimated value based on first page
                        </span>
                      </span>
                    ) : (
                      value
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No stats available.</p>
            )}
          </div>

          {/* Trends */}
          <div className="bg-white rounded-xl shadow-lg p-8">
            <h2 className="text-lg font-semibold mb-3 text-gray-800">
              📈 Trends View
            </h2>
            <p className="text-gray-500">Coming soon...</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
