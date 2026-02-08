-- Task Status Table for background jobs
CREATE TABLE IF NOT EXISTS task_status (
    id TEXT PRIMARY KEY,
    task_type TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL, -- 'running', 'completed', 'failed', 'paused'
    updated_at TEXT DEFAULT (datetime('now', 'utc')),
    metadata TEXT -- JSON for extra info
);
