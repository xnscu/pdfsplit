/**
 * Database Helper Functions
 * Shared utilities for database operations
 */

/**
 * Get full exam data including pages and questions
 */
export async function getFullExam(db, id) {
  const exam = await db.prepare(`
    SELECT id, name, timestamp, page_count as pageCount
    FROM exams WHERE id = ?
  `).bind(id).first();

  if (!exam) return null;

  const pagesResult = await db.prepare(`
    SELECT page_number as pageNumber, file_name as fileName,
           data_url as dataUrl, width, height, detections
    FROM raw_pages WHERE exam_id = ?
    ORDER BY page_number
  `).bind(id).all();

  const rawPages = pagesResult.results.map(p => ({
    ...p,
    detections: JSON.parse(p.detections || '[]'),
  }));

  const questionsResult = await db.prepare(`
    SELECT id, page_number as pageNumber, file_name as fileName,
           data_url as dataUrl, analysis, pro_analysis
    FROM questions WHERE exam_id = ?
    ORDER BY page_number
  `).bind(id).all();

  const questions = questionsResult.results.map(q => ({
    ...q,
    analysis: q.analysis ? JSON.parse(q.analysis) : undefined,
    pro_analysis: q.pro_analysis ? JSON.parse(q.pro_analysis) : undefined,
  }));

  return { ...exam, rawPages, questions };
}

/**
 * Save exam data to database with incremental updates
 */
export async function saveExamToDb(db, examData, source) {
  const { id, name, pageCount, rawPages, questions } = examData;

  const statements = [];
  const serverTimestamp = Date.now();

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

  // Delete pages not in incoming data
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

  // Delete questions not in incoming data
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

  statements.push(
    db.prepare(`
      INSERT INTO sync_log (id, exam_id, action, timestamp, synced_from)
      VALUES (?, ?, 'update', ?, ?)
    `).bind(crypto.randomUUID(), id, Date.now(), source)
  );

  await db.batch(statements);
}
