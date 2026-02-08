-- D1 Database Schema for Exam Records
-- This schema mirrors the ExamRecord interface from types.ts

-- Main exams table - stores exam metadata
CREATE TABLE IF NOT EXISTS exams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    page_count INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now', 'utc')),
    updated_at TEXT DEFAULT (datetime('now', 'utc'))
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_exams_name ON exams(name);
CREATE INDEX IF NOT EXISTS idx_exams_timestamp ON exams(timestamp DESC);

-- Raw pages table - stores page data with detections
-- Separated to handle large data more efficiently
CREATE TABLE IF NOT EXISTS raw_pages (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    data_url TEXT NOT NULL,  -- Base64 encoded image
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    detections TEXT NOT NULL DEFAULT '[]',  -- JSON array of DetectedQuestion
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
    UNIQUE(exam_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_raw_pages_exam_id ON raw_pages(exam_id);

-- Questions table - stores cropped question images with analysis
CREATE TABLE IF NOT EXISTS questions (
    id TEXT NOT NULL,
    exam_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    data_url TEXT NOT NULL,  -- Base64 encoded cropped image
    original_data_url TEXT,  -- Optional, for before/after comparison
    analysis TEXT,           -- JSON object of QuestionAnalysis
    pro_analysis TEXT,       -- JSON object of QuestionAnalysis from Gemini Pro
    PRIMARY KEY (exam_id, id),
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_questions_exam_id ON questions(exam_id);

-- Sync tracking table - for bidirectional sync between IndexedDB and D1
CREATE TABLE IF NOT EXISTS sync_log (
    id TEXT PRIMARY KEY,
    exam_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete')),
    timestamp INTEGER NOT NULL,
    synced_from TEXT NOT NULL CHECK(synced_from IN ('local', 'remote')),
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sync_log_timestamp ON sync_log(timestamp DESC);

-- Sync history table - records each sync session with details
CREATE TABLE IF NOT EXISTS sync_history (
    id TEXT PRIMARY KEY,
    sync_time INTEGER NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('push', 'pull', 'full_sync')),
    file_names TEXT NOT NULL,  -- JSON array of file names
    file_count INTEGER NOT NULL,
    success BOOLEAN NOT NULL DEFAULT 1,
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now', 'utc'))
);

CREATE INDEX IF NOT EXISTS idx_sync_history_sync_time ON sync_history(sync_time DESC);

-- API Key Call Statistics Table
-- Records each call to Gemini API for auditing and rate limiting purposes
CREATE TABLE IF NOT EXISTS api_key_stats (
    id TEXT PRIMARY KEY,
    api_key_prefix TEXT NOT NULL, -- Last 4 characters of the key for display
    call_time TEXT NOT NULL DEFAULT (datetime('now', 'utc')),  -- UTC timestamp
    success BOOLEAN NOT NULL DEFAULT 0,
    error_message TEXT,  -- Error message if failed
    question_id TEXT,  -- The question being processed
    exam_id TEXT,  -- The exam the question belongs to
    duration_ms INTEGER,  -- How long the call took
    model_id TEXT NOT NULL DEFAULT 'gemini-3-pro-preview'
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_api_key_stats_call_time ON api_key_stats(call_time DESC);
CREATE INDEX IF NOT EXISTS idx_api_key_stats_success ON api_key_stats(success);
CREATE INDEX IF NOT EXISTS idx_api_key_stats_key_prefix ON api_key_stats(api_key_prefix);

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
