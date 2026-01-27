CREATE TABLE IF NOT EXISTS sync_history (
    id TEXT PRIMARY KEY,
    sync_time INTEGER NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('push', 'pull', 'full_sync')),
    file_names TEXT NOT NULL,  -- JSON array of file names
    file_count INTEGER NOT NULL,
    success BOOLEAN NOT NULL DEFAULT 1,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_history_sync_time ON sync_history(sync_time DESC);
