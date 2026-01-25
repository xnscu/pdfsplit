-- Migration: Clear all data from database tables
-- This script deletes all records from all tables in the database
-- WARNING: This operation cannot be undone!
-- Use this for development/testing purposes only
-- Step 1: Delete all sync logs (no foreign key dependencies)
DELETE FROM sync_log;

-- Step 2: Delete all questions (references exams via foreign key)
DELETE FROM questions;

-- Step 3: Delete all raw pages (references exams via foreign key)
DELETE FROM raw_pages;

-- Step 4: Delete all exams (parent table, must be deleted last)
DELETE FROM exams;

-- Verify all tables are empty
SELECT
  'exams' AS table_name,
  COUNT(*) AS row_count
FROM
  exams
UNION ALL
SELECT
  'raw_pages' AS table_name,
  COUNT(*) AS row_count
FROM
  raw_pages
UNION ALL
SELECT
  'questions' AS table_name,
  COUNT(*) AS row_count
FROM
  questions
UNION ALL
SELECT
  'sync_log' AS table_name,
  COUNT(*) AS row_count
FROM
  sync_log;

