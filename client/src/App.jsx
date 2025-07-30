import React, { useEffect, useState } from 'react';
import './App.css';

function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshotCache, setSnapshotCache] = useState({});
  const [selectedRange, setSelectedRange] = useState('1d');
  const [forceRefresh, setForceRefresh] = useState(false);

  const FIFTEEN_MINUTES = 15 * 60 * 1000;

  const toggleSidebar = () => setCollapsed(!collapsed);

  const getSessionIdFromUrl = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('session');
  };

  const fetchStats = async (range, bypassCache = false) => {
    const sessionId = getSessionIdFromUrl();
    if (!sessionId) return;

    const cached = snapshotCache[range];
    const isExpired = cached && Date.now() - cached.timestamp > FIFTEEN_MINUTES;

    if (!bypassCache && cached && !isExpired) {
      console.log(`⚡ Using cached snapshot for ${range}`);
      if (range === selectedRange) setStats(cached.stats);
      return;
    }

    if (range === selectedRange) {
      setLoading(true);
      setError('');
      setStats(null);
    }

    try {
      const res = await fetch(`${import.meta.env.VITE_API_BASE_URL}/api/stats?session=${sessionId}&range=${range}`);

      if (!res.ok) throw new Error('Failed to fetch stats');

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullText = '';

      const readAll = async () => {
        const { done, value } = await reader.read();
        if (done) {
          console.log('📦 Full streamed response:', fullText);
          const lines = fullText
            .split('\n')
            .filter(line => line.startsWith('data: '))
            .map(line => JSON.parse(line.replace('data: ', '')));
          const merged = Object.assign({}, ...lines);

          setSnapshotCache(prev => ({
            ...prev,
            [range]: {
              stats: merged.stats,
              timestamp: Date.now()
            }
          }));

          if (range === selectedRange) setStats(merged.stats);
          return;
        }

        const chunk = decoder.decode(value, { stream: true });
        console.log('📥 Streamed chunk so far:', chunk);
        fullText += chunk;
        return readAll();
      };

      await readAll();
    } catch (err) {
      console.error('❌ Fetch error:', err);
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
    const rangesToPrefetch = ['30d', '60d', '90d'];
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
      case '1d': return '1-Day Snapshot';
      case '7d': return '7-Day Snapshot';
      case '30d': return '30-Day Snapshot';
      case '60d': return '60-Day Snapshot';
      case '90d': return '90-Day Snapshot';
      case '1y': return '1-Year Snapshot';
      default: return '';
    }
  };

  const handleRangeClick = (range) => {
    setSelectedRange(range);
    setForceRefresh(false);
  };

  const handleRefresh = () => {
    setSnapshotCache(prev => {
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
    <div className="app">
      <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <button className="collapse-btn" onClick={toggleSidebar}>
          {collapsed ? '☰' : '✖'}
        </button>
        {!collapsed && (
          <>
            <div className="nav-item">📥</div>
            <div className="nav-item">📊</div>
            <div className="nav-item">⚙️</div>
            <div className="nav-item">➕</div>
          </>
        )}
      </div>

      <div className="main">
        <h1 className="page-title">📬 AI Inbox Assistant</h1>

        {/* 🔐 Login Button */}
        <div style={{ marginBottom: '16px' }}>
          <button onClick={() => {
            window.location.href = "https://ai-inbox-assistant-95gq.onrender.com/api/auth/google";
          }}>
            🔐 Login with Google
          </button>
        </div>

        <div className="card-row">
          <div className="card">
            <div className="range-button-bar">
              {['1d', '7d', '30d', '60d', '90d', '1y'].map((range) => (
                <button
                  key={range}
                  className={`range-button ${selectedRange === range ? 'active' : 'inactive'}`}
                  onClick={() => handleRangeClick(range)}
                >
                  {range === '1y' ? '1 Year' : `${range.replace('d', '')} Day`}
                </button>
              ))}
              <button
                className="refresh-button"
                onClick={handleRefresh}
                disabled={loading}
                style={{ marginLeft: '12px' }}
              >
                🔄 Refresh
              </button>
            </div>

            <h2 title={formattedTimestamp ? `Last updated: ${formattedTimestamp}` : ''}>
              📊 {getSnapshotLabel(selectedRange)}
            </h2>

            {loading ? (
              <p>Loading...</p>
            ) : error ? (
              <p style={{ color: 'red' }}>{error}</p>
            ) : stats ? (
              <div className="stats-grid">
                {Object.entries(stats).map(([key, value]) => (
                  <div key={key}>
                    <strong>{key}:</strong>{' '}
                    {typeof value === 'string' && value.startsWith('~') ? (
                      <span title="Estimated value based on first page">{value}</span>
                    ) : (
                      value
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p>No stats available.</p>
            )}
          </div>

          <div className="card">
            <h2>📈 Trends View</h2>
            <p>Coming soon...</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
