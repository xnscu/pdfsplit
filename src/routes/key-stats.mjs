/**
 * API Key Stats Routes
 * Handles recording and retrieving API key usage statistics
 */
import { Hono } from 'hono';

const keyStatsRoutes = new Hono();

// POST /record - Record an API key call
keyStatsRoutes.post('/record', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  if (!body || !body.api_key_prefix) {
    return c.json({ error: 'Invalid request: expected { api_key_prefix, success, ... }' }, 400);
  }

  const {
    api_key_prefix,
    api_key_hash,
    success,
    error_message,
    question_id,
    exam_id,
    duration_ms,
    model_id,
  } = body;

  await db.prepare(`
    INSERT INTO api_key_stats (
      id, api_key_hash, api_key_prefix, call_time, success, 
      error_message, question_id, exam_id, duration_ms, model_id
    )
    VALUES (?, ?, ?, datetime('now', 'utc'), ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    api_key_hash || api_key_prefix,
    api_key_prefix,
    success ? 1 : 0,
    error_message || null,
    question_id || null,
    exam_id || null,
    duration_ms || null,
    model_id || 'gemini-3-pro-preview'
  ).run();

  return c.json({ success: true });
});

// GET / - Get API key statistics
keyStatsRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const days = parseInt(c.req.query('days')) || 0;

  let dateFilter = '';
  if (days > 0) {
    dateFilter = `WHERE call_time >= datetime('now', 'utc', '-${days} days')`;
  }

  // Get per-key statistics
  const perKeyResult = await db.prepare(`
    SELECT 
      api_key_prefix,
      COUNT(*) as total_calls,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count,
      AVG(duration_ms) as avg_duration_ms,
      MAX(call_time) as last_call_time
    FROM api_key_stats
    ${dateFilter}
    GROUP BY api_key_prefix
    ORDER BY total_calls DESC
  `).all();

  // Get overall totals
  const totalsResult = await db.prepare(`
    SELECT 
      COUNT(*) as total_calls,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failure_count,
      AVG(duration_ms) as avg_duration_ms
    FROM api_key_stats
    ${dateFilter}
  `).first();

  return c.json({
    keys: perKeyResult.results,
    totals: totalsResult || { total_calls: 0, success_count: 0, failure_count: 0, avg_duration_ms: 0 },
    days_filter: days,
  });
});

export default keyStatsRoutes;
