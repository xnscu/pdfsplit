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

// GET /details - Get successful call details
keyStatsRoutes.get('/details', async (c) => {
  const db = c.env.DB;
  const days = parseInt(c.req.query('days')) || 0;
  const keyPrefix = c.req.query('prefix');

  let query = `
    SELECT 
      s.exam_id,
      e.name as exam_name,
      s.question_id,
      s.call_time
    FROM api_key_stats s
    LEFT JOIN exams e ON s.exam_id = e.id
    WHERE s.success = 1 
    AND s.question_id IS NOT NULL 
    AND s.exam_id IS NOT NULL
  `;
  
  const params = [];

  if (days > 0) {
    query += ` AND s.call_time >= datetime('now', 'utc', '-? days')`;
    params.push(days);
  }

  if (keyPrefix) {
    query += ` AND s.api_key_prefix = ?`;
    params.push(keyPrefix);
  }

  query += ` ORDER BY s.call_time DESC LIMIT 1000`; // Limit to prevent massive payloads

  // Note: D1 binding with variable arguments is tricky if using raw string interpolation for days
  // Let's use direct injection for the integer days since we parse it as int above
  // but for safety let's use the binding API properly if possible.
  // Actually, standard D1 prepare().bind(). It supports ? parameters.

  // Re-constructing query to be cleaner for bind
  let whereClauses = ["s.success = 1", "s.question_id IS NOT NULL", "s.exam_id IS NOT NULL"];
  let bindParams = [];

  if (days > 0) {
    whereClauses.push(`s.call_time >= datetime('now', 'utc', '-${days} days')`);
    // Note: Parameterizing the interval string in SQLite can be tricky. 
    // Since we parseInt(days), it's safe to inject directly into the string literal for the interval.
  }

  if (keyPrefix) {
    whereClauses.push("s.api_key_prefix = ?");
    bindParams.push(keyPrefix);
  }

  const finalQuery = `
    SELECT 
      s.exam_id,
      e.name as exam_name,
      s.question_id,
      s.call_time
    FROM api_key_stats s
    LEFT JOIN exams e ON s.exam_id = e.id
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY s.call_time DESC 
    LIMIT 2000
  `;

  const results = await db.prepare(finalQuery).bind(...bindParams).all();

  return c.json(results.results);
});

export default keyStatsRoutes;
