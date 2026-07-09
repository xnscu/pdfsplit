-- Add Claude analysis and review columns to questions table
--
-- claude_analysis: QuestionAnalysis JSON produced by Claude solving the question
--                  independently (without seeing pro_analysis).
-- claude_review:   ClaudeReview JSON recording the comparison between
--                  claude_analysis and pro_analysis, plus arbitration when they
--                  disagree.

ALTER TABLE questions ADD COLUMN claude_analysis TEXT;
ALTER TABLE questions ADD COLUMN claude_review TEXT;

-- Pending-work lookups scan for rows where these are still NULL.
CREATE INDEX IF NOT EXISTS idx_questions_claude_analysis_pending
    ON questions(exam_id) WHERE claude_analysis IS NULL;

CREATE INDEX IF NOT EXISTS idx_questions_claude_review_pending
    ON questions(exam_id) WHERE claude_review IS NULL;

-- Verdict is stored inside claude_review JSON; index it for dashboard filters
-- that surface questions Claude flagged as wrong.
CREATE INDEX IF NOT EXISTS idx_questions_claude_verdict
    ON questions(json_extract(claude_review, '$.verdict'));
