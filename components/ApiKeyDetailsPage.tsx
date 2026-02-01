import { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';

// API base URL
const API_BASE = '/api';

interface DetailRecord {
  exam_id: string;
  exam_name: string | null;
  question_id: string;
  call_time: string;
}

interface GroupedData {
  [examName: string]: DetailRecord[];
}

export function ApiKeyDetailsPage() {
  const [searchParams] = useSearchParams();
  const [records, setRecords] = useState<DetailRecord[]>([]);
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
        
        const response = await fetch(`${API_BASE}/key-stats/details?${query.toString()}`);
        if (!response.ok) throw new Error('Failed to fetch details');
        
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

  // Group by exam name
  const grouped = records.reduce<GroupedData>((acc, record) => {
    const name = record.exam_name || 'Unknown Exam';
    if (!acc[name]) acc[name] = [];
    acc[name].push(record);
    return acc;
  }, {});

  // Sort exams by name? Or maybe by most recent activity?
  // Let's sort keys by name for stability
  const sortedExamNames = Object.keys(grouped).sort();

  return (
    <div className="api-key-details-page">
      <div className="header">
        <Link to="/key-stats" className="back-btn">
          ← 返回统计
        </Link>
        <h1>
          {prefix ? `Key: ...${prefix}` : '所有 Key'} 成功调用明细
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
          
          <div className="exams-grid">
            {sortedExamNames.map(examName => {
              const items = grouped[examName];
              // Sort questions by ID (numeric)
              const sortedItems = [...items].sort((a, b) => {
                return parseInt(a.question_id) - parseInt(b.question_id);
              });
              // Deduplicate based on question_id for clean display (though stats might have multiple calls for same Q)
              // User request: "displayed grouped by exam name, showing successfully called question numbers"
              // If there are duplicates, maybe just show unique question IDs?
              const uniqueItems = Array.from(new Map(sortedItems.map(item => [item.question_id, item])).values());
              uniqueItems.sort((a, b) => parseInt(a.question_id) - parseInt(b.question_id));

              return (
                <div key={examName} className="exam-card">
                  <h3>{examName}</h3>
                  <div className="question-list">
                    {uniqueItems.map(item => (
                      <Link
                        key={`${item.exam_id}-${item.question_id}`}
                        to={`/inspect/${item.exam_id}#question-${item.question_id}`}
                        className="q-link"
                        title={`Called at ${new Date(item.call_time + 'Z').toLocaleString()}`}
                      >
                        {item.question_id}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <style>{`
        .api-key-details-page {
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
        .exam-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 16px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }
        .exam-card h3 {
          margin: 0 0 12px 0;
          font-size: 1.1rem;
          color: #111827;
        }
        .question-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .q-link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 32px;
          height: 32px;
          border-radius: 6px;
          background: #d1fae5;
          color: #065f46;
          font-weight: 600;
          text-decoration: none;
          font-size: 0.9rem;
          transition: transform 0.1s, background 0.1s;
        }
        .q-link:hover {
          transform: scale(1.1);
          background: #a7f3d0;
        }
      `}</style>
    </div>
  );
}
