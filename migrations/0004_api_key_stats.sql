-- API Key Call Statistics Table
-- Records each call to Gemini API for auditing and rate limiting purposes

CREATE TABLE IF NOT EXISTS api_key_stats (
    id TEXT PRIMARY KEY,
    api_key_hash TEXT NOT NULL,  -- SHA-256 hash of the API key (only first 8 chars shown in UI)
    api_key_prefix TEXT NOT NULL, -- First 8 characters of the key for display
    call_time TEXT NOT NULL DEFAULT (datetime('now', 'utc')),  -- UTC timestamp
    success BOOLEAN NOT NULL DEFAULT 0,
    error_message TEXT,  -- Error message if failed
    question_id TEXT,  -- The question being processed
    exam_id TEXT,  -- The exam the question belongs to
    duration_ms INTEGER,  -- How long the call took
    model_id TEXT NOT NULL DEFAULT 'gemini-3-pro-preview'
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_api_key_stats_key_hash ON api_key_stats(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_api_key_stats_call_time ON api_key_stats(call_time DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_stats_success ON api_key_stats(success);
CREATE INDEX IF NOT EXISTS idx_api_key_stats_key_prefix ON api_key_stats(api_key_prefix);

-- Composite index for date range queries
CREATE INDEX IF NOT EXISTS idx_api_key_stats_time_key ON api_key_stats(call_time, api_key_hash);
