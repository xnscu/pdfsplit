/**
 * Exam Routes
 * Handles CRUD operations for exams, pages, and questions
 */
import { Hono } from 'hono';
import { getFullExam } from '../utils/db-helpers.mjs';

const examRoutes = new Hono();

// GET /debug/mismatched-counts - Find exams where rawpages question count != questions table count
examRoutes.get('/debug/mismatched-counts', async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(`
    SELECT
      e.id,
      e.name,
      (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) as questionCount,
      (
        SELECT COUNT(*)
        FROM raw_pages rp, json_each(rp.detections)
        WHERE rp.exam_id = e.id
        AND json_extract(json_each.value, '$.id') != 'continuation'
      ) as detectedCount
    FROM exams e
    GROUP BY e.id, e.name
    HAVING questionCount != detectedCount
  `).all();

  return c.json(result.results);
});

// GET / - List all exams (metadata only)
examRoutes.get('/', async (c) => {
  const db = c.env.DB;
  const result = await db.prepare(`
    SELECT id, name, timestamp, page_count as pageCount
    FROM exams
    ORDER BY timestamp DESC
  `).all();

  return c.json(result.results);
});

// GET /:id - Get full exam with pages and questions
examRoutes.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const fullExam = await getFullExam(db, id);
  if (!fullExam) {
    return c.json({ error: 'Exam not found' }, 404);
  }

  return c.json(fullExam);
});

// POST / - Create or update exam
examRoutes.post('/', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  if (!body) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { id, name, pageCount, rawPages, questions } = body;

  if (!id || !name) {
    return c.json({ error: 'Missing required fields: id, name' }, 400);
  }

  const statements = [];
  const serverTimestamp = Date.now();

  // Upsert exam record
  statements.push(
    db.prepare(`
      INSERT INTO exams (id, name, timestamp, page_count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        timestamp = excluded.timestamp,
        page_count = excluded.page_count,
        updated_at = excluded.updated_at
    `).bind(id, name, serverTimestamp, pageCount || 0, new Date().toISOString().replace('T', ' ').slice(0, 19), new Date().toISOString().replace('T', ' ').slice(0, 19))
  );

  // === INCREMENTAL UPDATE for raw_pages ===
  const incomingPageNumbers = [];
  if (rawPages && rawPages.length > 0) {
    for (const page of rawPages) {
      incomingPageNumbers.push(page.pageNumber);
      statements.push(
        db.prepare(`
          INSERT INTO raw_pages (id, exam_id, page_number, file_name, data_url, width, height, detections)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(exam_id, page_number) DO UPDATE SET
            file_name = excluded.file_name,
            data_url = excluded.data_url,
            width = excluded.width,
            height = excluded.height,
            detections = excluded.detections
        `).bind(
          crypto.randomUUID(),
          id,
          page.pageNumber,
          page.fileName,
          page.dataUrl,
          page.width,
          page.height,
          JSON.stringify(page.detections || [])
        )
      );
    }
  }

  // Delete pages that are no longer in the incoming data
  if (incomingPageNumbers.length > 0) {
    const placeholders = incomingPageNumbers.map(() => '?').join(',');
    statements.push(
      db.prepare(`
        DELETE FROM raw_pages
        WHERE exam_id = ? AND page_number NOT IN (${placeholders})
      `).bind(id, ...incomingPageNumbers)
    );
  } else {
    statements.push(db.prepare('DELETE FROM raw_pages WHERE exam_id = ?').bind(id));
  }

  // === INCREMENTAL UPDATE for questions ===
  const incomingQuestionIds = [];
  if (questions && questions.length > 0) {
    for (const q of questions) {
      const qId = q.id || crypto.randomUUID();
      incomingQuestionIds.push(qId);
      statements.push(
        db.prepare(`
          INSERT INTO questions (id, exam_id, page_number, file_name, data_url, analysis, pro_analysis)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(exam_id, id) DO UPDATE SET
            page_number = excluded.page_number,
            file_name = excluded.file_name,
            data_url = excluded.data_url,
            analysis = excluded.analysis,
            pro_analysis = excluded.pro_analysis
        `).bind(
          qId,
          id,
          q.pageNumber,
          q.fileName,
          q.dataUrl,
          q.analysis ? JSON.stringify(q.analysis) : null,
          q.pro_analysis ? JSON.stringify(q.pro_analysis) : null
        )
      );
    }
  }

  // Delete questions that are no longer in the incoming data
  if (incomingQuestionIds.length > 0) {
    const placeholders = incomingQuestionIds.map(() => '?').join(',');
    statements.push(
      db.prepare(`
        DELETE FROM questions
        WHERE exam_id = ? AND id NOT IN (${placeholders})
      `).bind(id, ...incomingQuestionIds)
    );
  } else {
    statements.push(db.prepare('DELETE FROM questions WHERE exam_id = ?').bind(id));
  }

  // Add sync log entry
  statements.push(
    db.prepare(`
      INSERT INTO sync_log (id, exam_id, action, timestamp, synced_from)
      VALUES (?, ?, 'update', ?, 'remote')
    `).bind(crypto.randomUUID(), id, Date.now())
  );

  // Execute batch
  await db.batch(statements);

  return c.json({ success: true, id, timestamp: serverTimestamp });
});

// DELETE /:id - Delete exam
examRoutes.delete('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  // Check if exam exists
  const exam = await db.prepare('SELECT id FROM exams WHERE id = ?').bind(id).first();
  if (!exam) {
    return c.json({ error: 'Exam not found' }, 404);
  }

  // Delete with cascade
  await db.prepare('DELETE FROM exams WHERE id = ?').bind(id).run();

  // Add sync log entry for deletion
  await db.prepare(`
    INSERT INTO sync_log (id, exam_id, action, timestamp, synced_from)
    VALUES (?, ?, 'delete', ?, 'remote')
  `).bind(crypto.randomUUID(), id, Date.now()).run();

  return c.json({ success: true });
});

// POST /batch-delete - Delete multiple exams
examRoutes.post('/batch-delete', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  if (!body || !Array.isArray(body.ids)) {
    return c.json({ error: 'Invalid request: expected { ids: string[] }' }, 400);
  }

  const { ids } = body;

  if (ids.length === 0) {
    return c.json({ success: true, deleted: 0 });
  }

  const statements = [];
  const timestamp = Date.now();

  for (const id of ids) {
    statements.push(db.prepare('DELETE FROM exams WHERE id = ?').bind(id));
    statements.push(
      db.prepare(`
        INSERT INTO sync_log (id, exam_id, action, timestamp, synced_from)
        VALUES (?, ?, 'delete', ?, 'remote')
      `).bind(crypto.randomUUID(), id, timestamp)
    );
  }

  await db.batch(statements);

  return c.json({ success: true, deleted: ids.length });
});

// PUT /:id/questions - Update questions for an exam
examRoutes.put('/:id/questions', async (c) => {
  const db = c.env.DB;
  const examId = c.req.param('id');
  const body = await c.req.json();

  if (!body) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Check if exam exists
  const exam = await db.prepare('SELECT id FROM exams WHERE id = ?').bind(examId).first();
  if (!exam) {
    return c.json({ error: 'Exam not found' }, 404);
  }

  const { questions } = body;
  const statements = [];

  // Delete existing questions
  statements.push(db.prepare('DELETE FROM questions WHERE exam_id = ?').bind(examId));

  // Insert new questions
  if (questions && questions.length > 0) {
    for (const q of questions) {
      statements.push(
        db.prepare(`
          INSERT OR REPLACE INTO questions (id, exam_id, page_number, file_name, data_url, analysis, pro_analysis)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          q.id || crypto.randomUUID(),
          examId,
          q.pageNumber,
          q.fileName,
          q.dataUrl,
          q.analysis ? JSON.stringify(q.analysis) : null,
          q.pro_analysis ? JSON.stringify(q.pro_analysis) : null
        )
      );
    }
  }

  const serverTimestamp = Date.now();
  statements.push(
    db.prepare('UPDATE exams SET timestamp = ?, updated_at = ? WHERE id = ?').bind(serverTimestamp, new Date().toISOString().replace('T', ' ').slice(0, 19), examId)
  );

  statements.push(
    db.prepare(`
      INSERT INTO sync_log (id, exam_id, action, timestamp, synced_from)
      VALUES (?, ?, 'update', ?, 'remote')
    `).bind(crypto.randomUUID(), examId, serverTimestamp)
  );

  await db.batch(statements);

  return c.json({ success: true });
});

// PATCH /:examId/questions/:questionId/image - Update question image (data_url)
examRoutes.patch('/:examId/questions/:questionId/image', async (c) => {
  const db = c.env.DB;
  const examId = c.req.param('examId');
  const questionId = c.req.param('questionId');
  const body = await c.req.json();

  if (!body || !body.dataUrl) {
    return c.json({ error: 'Missing dataUrl' }, 400);
  }

  try {
    const result = await db.prepare(`
      UPDATE questions
      SET data_url = ?
      WHERE exam_id = ? AND id = ?
    `).bind(body.dataUrl, examId, questionId).run();

    if (result.meta && result.meta.changes === 0) {
       return c.json({ error: 'Question not found or not updated' }, 404);
    }

    // Also update exam timestamp to trigger sync if needed
    await db.prepare('UPDATE exams SET updated_at = ? WHERE id = ?')
      .bind(new Date().toISOString().replace('T', ' ').slice(0, 19), examId).run();

    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default examRoutes;
