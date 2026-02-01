-- Migration to remove api_key_hash column
-- Dropping the column and associated indexes

-- Drop indexes first (optional, but good practice if not auto-dropped)
DROP INDEX IF EXISTS idx_api_key_stats_key_hash;
DROP INDEX IF EXISTS idx_api_key_stats_time_key;

-- Drop the column
ALTER TABLE api_key_stats DROP COLUMN api_key_hash;
