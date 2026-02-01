/**
 * Sync Routes
 * Handles sync operations between local IndexedDB and remote D1 database
 */
import { Hono } from 'hono';
import { getFullExam, saveExamToDb } from '../utils/db-helpers.mjs';

const syncRoutes = new Hono();

// GET /status - Get sync status (timestamps)
syncRoutes.get('/status', async (c) => {
  const db = c.env.DB;

  // Get latest sync timestamp
  const latest = await db.prepare(`
    SELECT MAX(timestamp) as lastSync FROM sync_log
  `).first();

  // Get exam count
  const count = await db.prepare('SELECT COUNT(*) as total FROM exams').first();

  return c.json({
    lastSync: latest?.lastSync || 0,
    examCount: count?.total || 0,
  });
});

// POST /push - Push local changes to remote
syncRoutes.post('/push', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  if (!body) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { exams, lastSyncTime } = body;

  if (!exams || !Array.isArray(exams)) {
    return c.json({ error: 'Invalid request: expected { exams: ExamRecord[] }' }, 400);
  }

  const results = {
    pushed: 0,
    conflicts: [],
    errors: [],
  };

  for (const exam of exams) {
    try {
      // Check for conflicts (remote was updated after last sync)
      const remoteExam = await db.prepare(`
        SELECT timestamp FROM exams WHERE id = ?
      `).bind(exam.id).first();

      if (remoteExam && remoteExam.timestamp > lastSyncTime && remoteExam.timestamp !== exam.timestamp) {
        // Conflict detected - remote was modified
        results.conflicts.push({
          id: exam.id,
          name: exam.name,
          localTimestamp: exam.timestamp,
          remoteTimestamp: remoteExam.timestamp,
        });
        continue;
      }

      // No conflict, save the exam
      await saveExamToDb(db, exam, 'local');
      results.pushed++;
    } catch (error) {
      results.errors.push({ id: exam.id, error: error.message });
    }
  }

  return c.json(results);
});

// POST /pull - Get remote changes since timestamp
syncRoutes.post('/pull', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json();

  if (!body) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const { since } = body;
  const sinceTimestamp = since || 0;

  // Get all exams modified since the given timestamp
  const examsResult = await db.prepare(`
    SELECT id, name, timestamp, page_count as pageCount
    FROM exams
    WHERE timestamp > ?
    ORDER BY timestamp DESC
  `).bind(sinceTimestamp).all();

  const exams = [];

  for (const exam of examsResult.results) {
    // Get full exam data including pages and questions
    const fullExam = await getFullExam(db, exam.id);
    if (fullExam) {
      exams.push(fullExam);
    }
  }

  // Get deleted exams since timestamp
  const deletedResult = await db.prepare(`
    SELECT DISTINCT exam_id as id FROM sync_log
    WHERE action = 'delete' AND timestamp > ?
  `).bind(sinceTimestamp).all();

  return c.json({
    exams,
    deleted: deletedResult.results.map(r => r.id),
    syncTime: Date.now(),
  });
});

export default syncRoutes;
