
import { Hono } from 'hono';

const questionsRoutes = new Hono();

// GET / - List questions with filtering
questionsRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const level0 = c.req.query('level0'); // Chapter
  const level1 = c.req.query('level1'); // Section 1
  const level2 = c.req.query('level2'); // Section 2
  const level3 = c.req.query('level3'); // Section 3

  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');

  // Build query
  let sql = `
    SELECT q.*, e.name as exam_name
    FROM questions q
    JOIN exams e ON q.exam_id = e.id
    WHERE 1=1
  `;
  const params = [];

  // Helper to add level filter
  // We check both analysis and pro_analysis
  // We match json_extract(..., '$.tags[0].levelX')

  if (level0) {
    sql += ` AND (
      json_extract(q.pro_analysis, '$.tags[0].level0') = ?
    )`;
    params.push(level0, level0);
  }

  if (level1) {
    sql += ` AND (
      json_extract(q.pro_analysis, '$.tags[0].level1') = ?
    )`;
    params.push(level1, level1);
  }

  if (level2) {
    sql += ` AND (
      json_extract(q.pro_analysis, '$.tags[0].level2') = ?
    )`;
    params.push(level2, level2);
  }

  if (level3) {
    sql += ` AND (
      json_extract(q.pro_analysis, '$.tags[0].level3') = ?
    )`;
    params.push(level3, level3);
  }

  // Add order and limit
  sql += ` ORDER BY e.timestamp DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  try {
    const result = await db.prepare(sql).bind(...params).all();

    // Parse JSON fields
    const questions = result.results.map(row => ({
      ...row,
      analysis: row.analysis ? JSON.parse(row.analysis) : null,
      pro_analysis: row.pro_analysis ? JSON.parse(row.pro_analysis) : null,
    }));

    // Get total count for pagination
    let countSql = `
      SELECT COUNT(*) as total
      FROM questions q
      WHERE 1=1
    `;
    const countParams = [];

    if (level0) {
      countSql += ` AND (
        json_extract(q.analysis, '$.tags[0].level0') = ? OR
        json_extract(q.pro_analysis, '$.tags[0].level0') = ?
      )`;
      countParams.push(level0, level0);
    }

    if (level1) {
      countSql += ` AND (
        json_extract(q.analysis, '$.tags[0].level1') = ? OR
        json_extract(q.pro_analysis, '$.tags[0].level1') = ?
      )`;
      countParams.push(level1, level1);
    }

    if (level2) {
      countSql += ` AND (
        json_extract(q.analysis, '$.tags[0].level2') = ? OR
        json_extract(q.pro_analysis, '$.tags[0].level2') = ?
      )`;
      countParams.push(level2, level2);
    }

    if (level3) {
      countSql += ` AND (
        json_extract(q.analysis, '$.tags[0].level3') = ? OR
        json_extract(q.pro_analysis, '$.tags[0].level3') = ?
      )`;
      countParams.push(level3, level3);
    }

    const countResult = await db.prepare(countSql).bind(...countParams).first();

    return c.json({
      data: questions,
      total: countResult.total,
      page: Math.floor(offset / limit) + 1,
      limit,
    });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default questionsRoutes;
