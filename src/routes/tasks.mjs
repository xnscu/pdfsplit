import { Hono } from 'hono';

const tasksRoutes = new Hono();

// GET /:type - Get status of a specific task type
tasksRoutes.get('/:type', async (c) => {
  const db = c.env.DB;
  const type = c.req.param('type');

  try {
    const status = await db.prepare('SELECT * FROM task_status WHERE task_type = ?').bind(type).first();
    if (!status) {
      return c.json({ status: 'idle', total: 0, processed: 0 });
    }
    return c.json(status);
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

// POST /:type - Update status (Authorized use only, but for now open)
tasksRoutes.post('/:type', async (c) => {
  const db = c.env.DB;
  const type = c.req.param('type');
  const body = await c.req.json();
  const { status, total, processed, metadata } = body;

  try {
    await db.prepare(`
      INSERT INTO task_status (id, task_type, status, total, processed, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'utc'))
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        total = excluded.total,
        processed = excluded.processed,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at
    `).bind(
      type, // Use type as ID for singleton tasks
      type,
      status || 'running',
      total || 0,
      processed || 0,
      metadata ? JSON.stringify(metadata) : null
    ).run();

    return c.json({ success: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  }
});

export default tasksRoutes;
