-- Migration to enforce UTC default timestamps by recreating tables
-- This works around SQLite limitations for altering default values

PRAGMA foreign_keys = OFF;

-- 1. Recreate 'exams' table with UTC defaults
ALTER TABLE exams RENAME TO exams_old;

CREATE TABLE exams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    page_count INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'utc')),
    updated_at TEXT DEFAULT (datetime('now', 'utc'))
);

CREATE INDEX idx_exams_name ON exams(name);
CREATE INDEX idx_exams_timestamp ON exams(timestamp DESC);

-- Copy data (preserving existing timestamps as-is)
INSERT INTO exams SELECT id, name, timestamp, page_count, created_at, updated_at FROM exams_old;

DROP TABLE exams_old;

-- 2. Recreate 'sync_history' table with UTC defaults
ALTER TABLE sync_history RENAME TO sync_history_old;

CREATE TABLE sync_history (
    id TEXT PRIMARY KEY,
    sync_time INTEGER NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('push', 'pull', 'full_sync')),
    file_names TEXT NOT NULL,
    file_count INTEGER NOT NULL,
    success BOOLEAN NOT NULL DEFAULT 1,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now', 'utc'))
);

CREATE INDEX idx_sync_history_sync_time ON sync_history(sync_time DESC);

-- Copy data
INSERT INTO sync_history SELECT id, sync_time, action_type, file_names, file_count, success, error_message, created_at FROM sync_history_old;

DROP TABLE sync_history_old;

PRAGMA foreign_keys = ON;
