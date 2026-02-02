
import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';

// API base URL
const API_BASE = '/api';

interface LogRecord {
  id: string; // generated UUID or similar
  exam_id: string;
  exam_name: string | null;
  question_id: string;
  call_time: string;
  success: number; // 1 or 0
  error_message: string | null;
  duration_ms: number | null;
  api_key_prefix: string;
  model_id: string | null;
}

export function ApiCallLogsPage() {
  const [searchParams] = useSearchParams();
  const [records, setRecords] = useState<LogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const prefix = searchParams.get('prefix');
  const days = searchParams.get('days') || '0';

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams({ days });
        if (prefix) query.append('prefix', prefix);
        
        // We want all logs, so we don't pass 'success=true'
        // If we wanted only failures, we could pass type=failure
        
        const response = await fetch(`${API_BASE}/key-stats/details?${query.toString()}`);
        if (!response.ok) throw new Error('Failed to fetch logs');
        
        const data = await response.json();
        setRecords(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [prefix, days]);

  const formatTime = (time: string) => {
    return new Date(time + 'Z').toLocaleString('zh-CN');
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '-';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="api-logs-page">
      <div className="header">
        <Link to="/key-stats" className="back-btn">
          ← 返回统计
        </Link>
        <h1>
          {prefix ? `Key: ...${prefix}` : '所有 Key'} 调用明细
          <span className="subtitle">
            ({days === '0' ? '全部时间' : `近 ${days} 天`})
          </span>
        </h1>
      </div>

      {loading && <div className="loading">加载中...</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && (
        <div className="content">
          <p className="summary">共找到 {records.length} 条记录</p>
          
          <div className="table-container">
            <table className="logs-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>状态</th>
                  <th>Key</th>
                  <th>试卷 / 题目</th>
                  <th>耗时</th>
                  <th>模型</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record, index) => (
                  <tr key={record.id || index} className={record.success ? 'row-success' : 'row-failure'}>
                    <td className="time-cell">{formatTime(record.call_time)}</td>
                    <td>
                      <span className={`status-badge ${record.success ? 'success' : 'failure'}`}>
                        {record.success ? '成功' : '失败'}
                      </span>
                    </td>
                    <td className="key-code">...{record.api_key_prefix}</td>
                    <td>
                      {record.exam_name || record.exam_id}  
                      {record.question_id && (
                         <Link to={`/inspect/${record.exam_id}#question-${record.question_id}`} className="q-link">
                           Q{record.question_id}
                         </Link>
                      )}
                    </td>
                    <td>{formatDuration(record.duration_ms)}</td>
                    <td className="model-cell">{record.model_id || '-'}</td>
                    <td className="error-cell" title={record.error_message || ''}>
                      {record.error_message ? (
                        <span className="error-text">{record.error_message.slice(0, 50)}{record.error_message.length > 50 ? '...' : ''}</span>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        .api-logs-page {
          padding: 24px;
          max-width: 1200px;
          margin: 0 auto;
          font-family: -apple-system, system-ui, sans-serif;
        }
        .header {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 24px;
        }
        .header h1 {
          font-size: 1.5rem;
          margin: 0;
          display: flex;
          align-items: baseline;
          gap: 12px;
        }
        .subtitle {
          font-size: 1rem;
          color: #6b7280;
          font-weight: normal;
        }
        .back-btn {
          text-decoration: none;
          color: #4b5563;
          font-weight: 500;
          padding: 8px 12px;
          border-radius: 6px;
          background: #f3f4f6;
          transition: background 0.2s;
        }
        .back-btn:hover {
          background: #e5e7eb;
        }
        .table-container {
          background: white;
          border-radius: 8px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
          overflow: hidden;
          border: 1px solid #e5e7eb;
        }
        .logs-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
        }
        .logs-table th {
          background: #f9fafb;
          text-align: left;
          padding: 12px 16px;
          border-bottom: 1px solid #e5e7eb;
          color: #374151;
          font-weight: 600;
        }
        .logs-table td {
          padding: 10px 16px;
          border-bottom: 1px solid #f3f4f6;
          color: #1f2937;
        }
        .logs-table tr:hover td {
          background: #f9fafb;
        }
        .time-cell {
          color: #6b7280;
          font-size: 0.85rem;
          white-space: nowrap;
        }
        .status-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 600;
        }
        .status-badge.success {
          background: #d1fae5;
          color: #065f46;
        }
        .status-badge.failure {
          background: #fee2e2;
          color: #991b1b;
        }
        .key-code {
          font-family: 'SF Mono', Monaco, monospace;
          color: #4b5563;
        }
        .q-link {
          margin-left: 8px;
          color: #3b82f6;
          text-decoration: none;
          font-weight: 500;
        }
        .q-link:hover {
          text-decoration: underline;
        }
        .model-cell {
          color: #6b7280;
          font-size: 0.85rem;
        }
        .error-text {
          color: #ef4444;
          font-size: 0.85rem;
        }
      `}</style>
    </div>
  );
}

export default ApiCallLogsPage;
