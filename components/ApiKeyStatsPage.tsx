/**
 * API Key Statistics Dashboard
 * 
 * Displays call statistics for each API key used by the pro-analysis server.
 * Shows success/failure counts, average duration, and filtering by time range.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';

// API base URL
const API_BASE = '/api';

interface KeyStats {
  api_key_prefix: string;
  total_calls: number;
  success_count: number;
  failure_count: number;
  avg_duration_ms: number | null;
  last_call_time: string | null;
}

interface StatsResponse {
  keys: KeyStats[];
  totals: {
    total_calls: number;
    success_count: number;
    failure_count: number;
    avg_duration_ms: number | null;
  };
  days_filter: number;
}

type TimeRange = 0 | 7 | 30;

export function ApiKeyStatsPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>(0);
  
  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    
    try {
      const url = `${API_BASE}/key-stats${timeRange > 0 ? `?days=${timeRange}` : ''}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch stats: ${response.status}`);
      }
      
      const data = await response.json();
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [timeRange]);
  
  useEffect(() => {
    fetchStats();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);
  
  const getSuccessRate = (success: number, total: number): string => {
    if (total === 0) return '0.0';
    return ((success / total) * 100).toFixed(1);
  };
  
  const formatDuration = (ms: number | null) => {
    if (ms === null) return '-';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };
  
  const formatTime = (time: string | null) => {
    if (!time) return '-';
    return new Date(time + 'Z').toLocaleString('zh-CN');
  };
  
  const timeRangeLabel = (range: TimeRange) => {
    switch (range) {
      case 0: return '全部时间';
      case 7: return '近7天';
      case 30: return '近30天';
      default: return '全部';
    }
  };

  return (
    <div className="api-key-stats-page">
      <div className="stats-header">
        <div className="flex items-center gap-4">
          <Link to="/" className="back-btn" title="返回主应用">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <h1>🔑 API Key 调用统计</h1>
        </div>
        <div className="controls">
          <div className="time-range-buttons">
            {([0, 7, 30] as TimeRange[]).map((range) => (
              <button
                key={range}
                className={`time-btn ${timeRange === range ? 'active' : ''}`}
                onClick={() => setTimeRange(range)}
              >
                {timeRangeLabel(range)}
              </button>
            ))}
          </div>
          <button className="refresh-btn" onClick={fetchStats} disabled={loading}>
            {loading ? '加载中...' : '🔄 刷新'}
          </button>
        </div>
      </div>
      
      {error && (
        <div className="error-banner">
          ⚠️ {error}
        </div>
      )}
      
      {stats && (
        <>
          {/* Summary Cards */}
          <div className="summary-cards">
            <div className="stat-card total">
              <div className="stat-value">{stats.totals.total_calls.toLocaleString()}</div>
              <div className="stat-label">总调用次数</div>
            </div>
            <div className="stat-card success">
              <div className="stat-value">{stats.totals.success_count.toLocaleString()}</div>
              <div className="stat-label">成功次数</div>
            </div>
            <div className="stat-card failure">
              <div className="stat-value">{stats.totals.failure_count.toLocaleString()}</div>
              <div className="stat-label">失败次数</div>
            </div>
            <div className="stat-card rate">
              <div className="stat-value">
                {getSuccessRate(stats.totals.success_count, stats.totals.total_calls)}%
              </div>
              <div className="stat-label">成功率</div>
            </div>
            <div className="stat-card duration">
              <div className="stat-value">{formatDuration(stats.totals.avg_duration_ms)}</div>
              <div className="stat-label">平均耗时</div>
            </div>
          </div>
          
          {/* Per-Key Table */}
          <div className="keys-table-container">
            <h2>各 Key 统计明细</h2>
            {stats.keys.length === 0 ? (
              <div className="empty-state">
                暂无调用记录
              </div>
            ) : (
              <table className="keys-table">
                <thead>
                  <tr>
                    <th>Key (后4位)</th>
                    <th>总调用</th>
                    <th>成功</th>
                    <th>失败</th>
                    <th>成功率</th>
                    <th>平均耗时</th>
                    <th>最后调用</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.keys.map((key) => (
                    <tr key={key.api_key_prefix}>
                      <td className="key-prefix">
                        <code>{key.api_key_prefix}...</code>
                      </td>
                      <td>{key.total_calls.toLocaleString()}</td>
                      <td className="success-cell">{key.success_count.toLocaleString()}</td>
                      <td className="failure-cell">{key.failure_count.toLocaleString()}</td>
                      <td>
                        <span className={`rate-badge ${
                          parseFloat(getSuccessRate(key.success_count, key.total_calls)) >= 90 ? 'good' :
                          parseFloat(getSuccessRate(key.success_count, key.total_calls)) >= 70 ? 'ok' : 'bad'
                        }`}>
                          {getSuccessRate(key.success_count, key.total_calls)}%
                        </span>
                      </td>
                      <td>{formatDuration(key.avg_duration_ms)}</td>
                      <td className="time-cell">{formatTime(key.last_call_time)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          
          <div className="stats-footer">
            <span>数据每30秒自动刷新</span>
            <span>当前筛选: {timeRangeLabel(timeRange)}</span>
          </div>
        </>
      )}
      
      <style>{`
        .api-key-stats-page {
          padding: 24px;
          max-width: 1200px;
          margin: 0 auto;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .stats-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          flex-wrap: wrap;
          gap: 16px;
        }
        
        .stats-header h1 {
          margin: 0;
          font-size: 1.5rem;
          color: #1a1a2e;
        }

        .back-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 40px;
          height: 40px;
          background: white;
          border: 1px solid #d1d5db;
          border-radius: 10px;
          color: #4b5563;
          transition: all 0.2s;
          text-decoration: none;
        }

        .back-btn:hover {
          background: #f3f4f6;
          color: #1a1a2e;
          transform: translateX(-2px);
        }
        
        .controls {
          display: flex;
          gap: 16px;
          align-items: center;
        }
        
        .time-range-buttons {
          display: flex;
          gap: 8px;
        }
        
        .time-btn {
          padding: 8px 16px;
          border: 1px solid #d1d5db;
          background: white;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }
        
        .time-btn:hover {
          background: #f3f4f6;
        }
        
        .time-btn.active {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border-color: transparent;
        }
        
        .refresh-btn {
          padding: 8px 16px;
          background: #10b981;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.2s;
        }
        
        .refresh-btn:hover:not(:disabled) {
          background: #059669;
        }
        
        .refresh-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
        
        .error-banner {
          background: #fef2f2;
          border: 1px solid #fecaca;
          color: #dc2626;
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 24px;
        }
        
        .summary-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 16px;
          margin-bottom: 32px;
        }
        
        .stat-card {
          background: white;
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          border: 1px solid #e5e7eb;
        }
        
        .stat-card .stat-value {
          font-size: 2rem;
          font-weight: 700;
          color: #1f2937;
        }
        
        .stat-card .stat-label {
          color: #6b7280;
          font-size: 0.875rem;
          margin-top: 4px;
        }
        
        .stat-card.total .stat-value { color: #3b82f6; }
        .stat-card.success .stat-value { color: #10b981; }
        .stat-card.failure .stat-value { color: #ef4444; }
        .stat-card.rate .stat-value { color: #8b5cf6; }
        .stat-card.duration .stat-value { color: #f59e0b; }
        
        .keys-table-container {
          background: white;
          border-radius: 12px;
          padding: 24px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          border: 1px solid #e5e7eb;
        }
        
        .keys-table-container h2 {
          margin: 0 0 16px 0;
          font-size: 1.125rem;
          color: #374151;
        }
        
        .empty-state {
          text-align: center;
          padding: 48px;
          color: #9ca3af;
        }
        
        .keys-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .keys-table th,
        .keys-table td {
          padding: 12px 16px;
          text-align: left;
          border-bottom: 1px solid #e5e7eb;
        }
        
        .keys-table th {
          background: #f9fafb;
          font-weight: 600;
          color: #374151;
          font-size: 0.875rem;
        }
        
        .keys-table tbody tr:hover {
          background: #f9fafb;
        }
        
        .key-prefix code {
          background: #f3f4f6;
          padding: 4px 8px;
          border-radius: 4px;
          font-family: 'SF Mono', Monaco, monospace;
          font-size: 0.875rem;
        }
        
        .success-cell { color: #10b981; }
        .failure-cell { color: #ef4444; }
        
        .rate-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
        }
        
        .rate-badge.good {
          background: #d1fae5;
          color: #065f46;
        }
        
        .rate-badge.ok {
          background: #fef3c7;
          color: #92400e;
        }
        
        .rate-badge.bad {
          background: #fee2e2;
          color: #991b1b;
        }
        
        .time-cell {
          font-size: 0.875rem;
          color: #6b7280;
        }
        
        .stats-footer {
          display: flex;
          justify-content: space-between;
          margin-top: 16px;
          font-size: 0.75rem;
          color: #9ca3af;
        }
        
        @media (max-width: 768px) {
          .stats-header {
            flex-direction: column;
            align-items: flex-start;
          }
          
          .keys-table-container {
            overflow-x: auto;
          }
          
          .keys-table {
            min-width: 700px;
          }
        }
      `}</style>
    </div>
  );
}

export default ApiKeyStatsPage;
