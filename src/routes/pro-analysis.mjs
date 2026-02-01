/**
 * Pro Analysis Routes
 * Handles Gemini Pro analysis operations for questions
 */
import { Hono } from 'hono';

const proAnalysisRoutes = new Hono();

// POST /pending - Get N questions without pro_analysis
proAnalysisRoutes.post('/pending', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  if (!body || typeof body.limit !== 'number') {
    return c.json({ error: 'Invalid request: expected { limit: number }' }, 400);
  }

  const { limit } = body;

  const result = await db.prepare(`
    SELECT 
      q.id as question_id,
      q.exam_id,
      q.data_url,
      q.analysis,
      e.name as exam_name
    FROM questions q
    JOIN exams e ON e.id = q.exam_id
    WHERE q.pro_analysis IS NULL
    ORDER BY e.timestamp DESC, q.page_number
    LIMIT ?
  `).bind(limit).all();

  return c.json({
    questions: result.results.map(q => ({
      ...q,
      analysis: q.analysis ? JSON.parse(q.analysis) : null,
    })),
    count: result.results.length,
  });
});

// PUT /update - Update a single question's pro_analysis
proAnalysisRoutes.put('/update', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  if (!body || !body.exam_id || !body.question_id) {
    return c.json({ error: 'Invalid request: expected { exam_id, question_id, pro_analysis }' }, 400);
  }

  const { exam_id, question_id, pro_analysis } = body;
  const serverTimestamp = Date.now();

  const statements = [];

  // Update the question's pro_analysis
  statements.push(
    db.prepare(`
      UPDATE questions 
      SET pro_analysis = ?
      WHERE exam_id = ? AND id = ?
    `).bind(
      pro_analysis ? JSON.stringify(pro_analysis) : null,
      exam_id,
      question_id
    )
  );

  // Update exam timestamp so sync can detect changes
  statements.push(
    db.prepare(`
      UPDATE exams 
      SET timestamp = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      serverTimestamp,
      new Date().toISOString().replace('T', ' ').slice(0, 19),
      exam_id
    )
  );

  await db.batch(statements);

  return c.json({ success: true, timestamp: serverTimestamp });
});

export default proAnalysisRoutes;
