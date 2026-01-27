/**
 * Cloudflare Worker for GKSX Exam Storage API
 * Provides REST API for D1 database operations and sync with frontend IndexedDB
 * Static assets are served by the Cloudflare Vite plugin / ASSETS binding
 */

import { GoogleGenAI, Type } from "@google/genai";
import { PROMPTS, SCHEMAS } from "../shared/ai-config.js";

// CORS headers for cross-origin requests
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Sync-Token',
  'Access-Control-Max-Age': '86400',
};

// Helper to create JSON response
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

// Helper to create error response
function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, status);
}

// Parse request body as JSON
async function parseBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * Main request handler
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // API Routes - handle first
      if (path.startsWith('/api/')) {
        return handleApiRoutes(request, env, path, method);
      }

      // Static assets - served by ASSETS binding (Cloudflare Vite plugin)
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      // No static assets configured, return 404 for non-API routes

      return errorResponse('Not Found', 404);
    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse(`Internal Server Error: ${error.message}`, 500);
    }
  },
};


/**
 * Handle all API routes
 */
async function handleApiRoutes(request, env, path, method) {
  const db = env.DB;
  const r2 = env.R2;

  // === R2 Storage Routes ===

  // HEAD /api/r2/:hash - Check if image exists in R2
  if (path.match(/^\/api\/r2\/[^/]+$/) && method === 'HEAD') {
    const hash = path.split('/').pop();
    return handleCheckR2Image(r2, hash);
  }

  // GET /api/r2/:hash - Get image from R2
  if (path.match(/^\/api\/r2\/[^/]+$/) && method === 'GET') {
    const hash = path.split('/').pop();
    return handleGetR2Image(r2, hash);
  }

  // PUT /api/r2/:hash - Upload image to R2
  if (path.match(/^\/api\/r2\/[^/]+$/) && method === 'PUT') {
    const hash = path.split('/').pop();
    return handleUploadR2Image(request, r2, hash);
  }

  // POST /api/r2/check-batch - Batch check if images exist
  if (path === '/api/r2/check-batch' && method === 'POST') {
    const body = await parseBody(request);
    if (!body || !Array.isArray(body.hashes)) {
      return errorResponse('Invalid request: expected { hashes: string[] }');
    }
    return handleBatchCheckR2Images(r2, body.hashes);
  }

  // === Exam Routes ===

  // GET /api/exams - List all exams (metadata only)
  if (path === '/api/exams' && method === 'GET') {
    return handleListExams(db);
  }

  // GET /api/exams/:id - Get full exam with pages and questions
  if (path.match(/^\/api\/exams\/[^/]+$/) && method === 'GET') {
    const id = path.split('/').pop();
    return handleGetExam(db, id);
  }

  // POST /api/exams - Create or update exam
  if (path === '/api/exams' && method === 'POST') {
    const body = await parseBody(request);
    if (!body) return errorResponse('Invalid JSON body');
    return handleSaveExam(db, body);
  }

  // DELETE /api/exams/:id - Delete exam
  if (path.match(/^\/api\/exams\/[^/]+$/) && method === 'DELETE') {
    const id = path.split('/').pop();
    return handleDeleteExam(db, id);
  }

  // POST /api/exams/batch-delete - Delete multiple exams
  if (path === '/api/exams/batch-delete' && method === 'POST') {
    const body = await parseBody(request);
    if (!body || !Array.isArray(body.ids)) {
      return errorResponse('Invalid request: expected { ids: string[] }');
    }
    return handleBatchDeleteExams(db, body.ids);
  }

  // === Sync Routes ===

  // GET /api/sync/status - Get sync status (timestamps)
  if (path === '/api/sync/status' && method === 'GET') {
    return handleGetSyncStatus(db);
  }

  // POST /api/sync/push - Push local changes to remote
  if (path === '/api/sync/push' && method === 'POST') {
    const body = await parseBody(request);
    if (!body) return errorResponse('Invalid JSON body');
    return handleSyncPush(db, body);
  }

  // POST /api/sync/pull - Get remote changes since timestamp
  if (path === '/api/sync/pull' && method === 'POST') {
    const body = await parseBody(request);
    if (!body) return errorResponse('Invalid JSON body');
    return handleSyncPull(db, body);
  }

  // === Questions Routes ===

  // PUT /api/exams/:id/questions - Update questions for an exam
  if (path.match(/^\/api\/exams\/[^/]+\/questions$/) && method === 'PUT') {
    const id = path.split('/')[3];
    const body = await parseBody(request);
    if (!body) return errorResponse('Invalid JSON body');
    return handleUpdateQuestions(db, id, body.questions);
  }

  // === Gemini Proxy Routes ===

  // POST /api/gemini/proxy - Proxy Gemini API requests
  if (path === '/api/gemini/proxy' && method === 'POST') {
    const body = await parseBody(request);
    if (!body) return errorResponse('Invalid JSON body');
    return handleGeminiProxy(body);
  }

  return errorResponse('Not Found', 404);
}

// ============ R2 Storage Handlers ============

async function handleCheckR2Image(r2, hash) {
  if (!r2) {
    return errorResponse('R2 storage not configured', 503);
  }
  try {
    const object = await r2.head(hash);
    if (object) {
      return new Response(null, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': object.httpMetadata?.contentType || 'image/png',
          'Content-Length': object.size.toString(),
        },
      });
    }
    return new Response(null, { status: 404, headers: corsHeaders });
  } catch (error) {
    return errorResponse(`R2 check failed: ${error.message}`, 500);
  }
}

async function handleGetR2Image(r2, hash) {
  if (!r2) {
    return errorResponse('R2 storage not configured', 503);
  }
  try {
    const object = await r2.get(hash);
    if (!object) {
      return errorResponse('Image not found', 404);
    }

    const headers = {
      ...corsHeaders,
      'Content-Type': object.httpMetadata?.contentType || 'image/png',
      'Content-Length': object.size.toString(),
      'Cache-Control': 'public, max-age=31536000, immutable',
    };

    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    return errorResponse(`R2 get failed: ${error.message}`, 500);
  }
}

async function handleUploadR2Image(request, r2, hash) {
  if (!r2) {
    return errorResponse('R2 storage not configured', 503);
  }
  try {
    // Check if already exists
    const existing = await r2.head(hash);
    if (existing) {
      return jsonResponse({ success: true, hash, existed: true });
    }

    // Get content type from header
    const contentType = request.headers.get('Content-Type') || 'image/png';

    // Upload to R2
    const body = await request.arrayBuffer();
    await r2.put(hash, body, {
      httpMetadata: { contentType },
    });

    return jsonResponse({ success: true, hash, existed: false });
  } catch (error) {
    return errorResponse(`R2 upload failed: ${error.message}`, 500);
  }
}

async function handleBatchCheckR2Images(r2, hashes) {
  if (!r2) {
    return errorResponse('R2 storage not configured', 503);
  }
  try {
    const results = {};

    // Check each hash in parallel
    const checks = hashes.map(async (hash) => {
      const object = await r2.head(hash);
      return { hash, exists: !!object };
    });

    const checkResults = await Promise.all(checks);

    for (const { hash, exists } of checkResults) {
      results[hash] = exists;
    }

    return jsonResponse({ results });
  } catch (error) {
    return errorResponse(`R2 batch check failed: ${error.message}`, 500);
  }
}

// ============ Exam Handlers ============

async function handleListExams(db) {
  const result = await db.prepare(`
    SELECT id, name, timestamp, page_count as pageCount
    FROM exams
    ORDER BY timestamp DESC
  `).all();

  return jsonResponse(result.results);
}

async function handleGetExam(db, id) {
  // Get exam metadata
  const exam = await db.prepare(`
    SELECT id, name, timestamp, page_count as pageCount
    FROM exams WHERE id = ?
  `).bind(id).first();

  if (!exam) {
    return errorResponse('Exam not found', 404);
  }

  // Get raw pages
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

  // Get questions
  const questionsResult = await db.prepare(`
    SELECT id, page_number as pageNumber, file_name as fileName,
           data_url as dataUrl, analysis
    FROM questions WHERE exam_id = ?
    ORDER BY page_number
  `).bind(id).all();

  const questions = questionsResult.results.map(q => ({
    ...q,
    analysis: q.analysis ? JSON.parse(q.analysis) : undefined,
  }));

  return jsonResponse({
    ...exam,
    rawPages,
    questions,
  });
}

async function handleSaveExam(db, examData) {
  const { id, name, pageCount, rawPages, questions } = examData;

  if (!id || !name) {
    return errorResponse('Missing required fields: id, name');
  }

  // Use transaction-like batch operations with INCREMENTAL updates
  // Instead of delete-all-then-insert, we use UPSERT and selective deletion
  const statements = [];

  // IMPORTANT: Always use server time as timestamp to ensure sync/pull can detect changes.
  // Previously we used client-provided timestamp, but client-side update operations
  // (like updateQuestionsForFile) don't always update the timestamp, causing sync/pull
  // to miss updates. Using server time ensures any push will be detectable by subsequent pulls.
  const serverTimestamp = Date.now();

  // Upsert exam record
  statements.push(
    db.prepare(`
      INSERT INTO exams (id, name, timestamp, page_count, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        timestamp = excluded.timestamp,
        page_count = excluded.page_count,
        updated_at = datetime('now')
    `).bind(id, name, serverTimestamp, pageCount || 0)
  );

  // === INCREMENTAL UPDATE for raw_pages ===
  // Use UPSERT based on UNIQUE(exam_id, page_number) constraint
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
          crypto.randomUUID(), // Only used for new inserts
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
    // Delete pages not in the incoming list
    const placeholders = incomingPageNumbers.map(() => '?').join(',');
    statements.push(
      db.prepare(`
        DELETE FROM raw_pages
        WHERE exam_id = ? AND page_number NOT IN (${placeholders})
      `).bind(id, ...incomingPageNumbers)
    );
  } else {
    // No pages incoming, delete all
    statements.push(db.prepare('DELETE FROM raw_pages WHERE exam_id = ?').bind(id));
  }

  // === INCREMENTAL UPDATE for questions ===
  // Use UPSERT based on PRIMARY KEY(exam_id, id)
  const incomingQuestionIds = [];
  if (questions && questions.length > 0) {
    for (const q of questions) {
      const qId = q.id || crypto.randomUUID();
      incomingQuestionIds.push(qId);
      statements.push(
        db.prepare(`
          INSERT INTO questions (id, exam_id, page_number, file_name, data_url, analysis)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(exam_id, id) DO UPDATE SET
            page_number = excluded.page_number,
            file_name = excluded.file_name,
            data_url = excluded.data_url,
            analysis = excluded.analysis
        `).bind(
          qId,
          id,
          q.pageNumber,
          q.fileName,
          q.dataUrl,
          q.analysis ? JSON.stringify(q.analysis) : null
        )
      );
    }
  }

  // Delete questions that are no longer in the incoming data
  if (incomingQuestionIds.length > 0) {
    // Delete questions not in the incoming list
    const placeholders = incomingQuestionIds.map(() => '?').join(',');
    statements.push(
      db.prepare(`
        DELETE FROM questions
        WHERE exam_id = ? AND id NOT IN (${placeholders})
      `).bind(id, ...incomingQuestionIds)
    );
  } else {
    // No questions incoming, delete all
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

  // Return the server timestamp so client can update local timestamp to match
  return jsonResponse({ success: true, id, timestamp: serverTimestamp });
}

async function handleDeleteExam(db, id) {
  // Check if exam exists
  const exam = await db.prepare('SELECT id FROM exams WHERE id = ?').bind(id).first();
  if (!exam) {
    return errorResponse('Exam not found', 404);
  }

  // Delete with cascade (raw_pages and questions will be deleted automatically)
  await db.prepare('DELETE FROM exams WHERE id = ?').bind(id).run();

  // Add sync log entry for deletion
  await db.prepare(`
    INSERT INTO sync_log (id, exam_id, action, timestamp, synced_from)
    VALUES (?, ?, 'delete', ?, 'remote')
  `).bind(crypto.randomUUID(), id, Date.now()).run();

  return jsonResponse({ success: true });
}

async function handleBatchDeleteExams(db, ids) {
  if (ids.length === 0) {
    return jsonResponse({ success: true, deleted: 0 });
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

  return jsonResponse({ success: true, deleted: ids.length });
}

// ============ Questions Handlers ============

async function handleUpdateQuestions(db, examId, questions) {
  // Check if exam exists
  const exam = await db.prepare('SELECT id FROM exams WHERE id = ?').bind(examId).first();
  if (!exam) {
    return errorResponse('Exam not found', 404);
  }

  const statements = [];

  // Delete existing questions
  statements.push(db.prepare('DELETE FROM questions WHERE exam_id = ?').bind(examId));

  // Insert new questions with UPSERT
  if (questions && questions.length > 0) {
    for (const q of questions) {
      statements.push(
        db.prepare(`
          INSERT OR REPLACE INTO questions (id, exam_id, page_number, file_name, data_url, analysis)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          q.id || crypto.randomUUID(),
          examId,
          q.pageNumber,
          q.fileName,
          q.dataUrl,
          q.analysis ? JSON.stringify(q.analysis) : null
        )
      );
    }
  }

  // IMPORTANT: Update both timestamp and updated_at to ensure sync/pull can detect changes
  const serverTimestamp = Date.now();
  statements.push(
    db.prepare('UPDATE exams SET timestamp = ?, updated_at = datetime(\'now\') WHERE id = ?').bind(serverTimestamp, examId)
  );

  // Add sync log entry for tracking
  statements.push(
    db.prepare(`
      INSERT INTO sync_log (id, exam_id, action, timestamp, synced_from)
      VALUES (?, ?, 'update', ?, 'remote')
    `).bind(crypto.randomUUID(), examId, serverTimestamp)
  );

  await db.batch(statements);

  return jsonResponse({ success: true });
}

// ============ Sync Handlers ============

async function handleGetSyncStatus(db) {
  // Get latest sync timestamp
  const latest = await db.prepare(`
    SELECT MAX(timestamp) as lastSync FROM sync_log
  `).first();

  // Get exam count
  const count = await db.prepare('SELECT COUNT(*) as total FROM exams').first();

  return jsonResponse({
    lastSync: latest?.lastSync || 0,
    examCount: count?.total || 0,
  });
}

async function handleSyncPush(db, data) {
  const { exams, lastSyncTime } = data;

  if (!exams || !Array.isArray(exams)) {
    return errorResponse('Invalid request: expected { exams: ExamRecord[] }');
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

  return jsonResponse(results);
}

async function handleSyncPull(db, data) {
  const { since } = data;
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

  return jsonResponse({
    exams,
    deleted: deletedResult.results.map(r => r.id),
    syncTime: Date.now(),
  });
}

// ============ Helper Functions ============

async function getFullExam(db, id) {
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
           data_url as dataUrl, analysis
    FROM questions WHERE exam_id = ?
    ORDER BY page_number
  `).bind(id).all();

  const questions = questionsResult.results.map(q => ({
    ...q,
    analysis: q.analysis ? JSON.parse(q.analysis) : undefined,
  }));

  return { ...exam, rawPages, questions };
}

async function saveExamToDb(db, examData, source) {
  const { id, name, pageCount, rawPages, questions } = examData;

  // Use INCREMENTAL updates instead of delete-all-then-insert
  const statements = [];

  // IMPORTANT: Always use server time as timestamp to ensure sync/pull can detect changes.
  const serverTimestamp = Date.now();

  statements.push(
    db.prepare(`
      INSERT INTO exams (id, name, timestamp, page_count, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        timestamp = excluded.timestamp,
        page_count = excluded.page_count,
        updated_at = datetime('now')
    `).bind(id, name, serverTimestamp, pageCount || 0)
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
          INSERT INTO questions (id, exam_id, page_number, file_name, data_url, analysis)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(exam_id, id) DO UPDATE SET
            page_number = excluded.page_number,
            file_name = excluded.file_name,
            data_url = excluded.data_url,
            analysis = excluded.analysis
        `).bind(
          qId,
          id,
          q.pageNumber,
          q.fileName,
          q.dataUrl,
          q.analysis ? JSON.stringify(q.analysis) : null
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

// ============ Gemini Proxy Handler ============

/**
 * Convert schema format for Gemini API
 * The frontend uses a simplified schema format, we need to convert it
 */
function convertSchemaType(type) {
  // Map string types to Type enum
  const typeMap = {
    'STRING': Type.STRING,
    'NUMBER': Type.NUMBER,
    'INTEGER': Type.INTEGER,
    'BOOLEAN': Type.BOOLEAN,
    'ARRAY': Type.ARRAY,
    'OBJECT': Type.OBJECT,
  };
  return typeMap[type] || type;
}

function convertSchema(schema) {
  if (!schema) return schema;

  const result = { ...schema };

  // Convert type if it's a string
  if (typeof result.type === 'string') {
    result.type = convertSchemaType(result.type);
  }

  // Recursively convert nested schemas
  if (result.items) {
    result.items = convertSchema(result.items);
  }

  if (result.properties) {
    const newProps = {};
    for (const [key, value] of Object.entries(result.properties)) {
      newProps[key] = convertSchema(value);
    }
    result.properties = newProps;
  }

  return result;
}

/**
 * Handle Gemini API proxy requests
 * Receives requests from frontend and forwards to Gemini API
 */
async function handleGeminiProxy(body) {
  const { apiKey, modelId, image, prompt, responseSchema, requestType } = body;

  if (!apiKey) {
    return errorResponse('API key is required');
  }

  if (!image) {
    return errorResponse('Image data is required');
  }

  if (!modelId) {
    return errorResponse('Model ID is required');
  }

  try {
    // Create AI client with provided key
    const ai = new GoogleGenAI({ apiKey });

    // Parse image data URL
    let mimeType = 'image/png';
    let imageData = image;

    if (image.startsWith('data:')) {
      const match = image.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        imageData = match[2];
      }
    } else if (image.startsWith('r2://')) {
      // R2 reference - we'll need to handle this differently
      // For now, return an error - the frontend should resolve R2 refs first
      return errorResponse('R2 image references must be resolved before proxy');
    }

    // Build the request
    const contents = [
      {
        parts: [
          {
            inlineData: {
              mimeType,
              data: imageData,
            },
          },
          { text: prompt || PROMPTS.BASIC },
        ],
      },
    ];

    // Configure response format
    const config = {
      responseMimeType: 'application/json',
    };

    // Use the appropriate schema based on request type
    if (requestType === 'detection') {
      config.responseSchema = {
        type: Type.ARRAY,
        items: SCHEMAS.BASIC,
      };
    } else if (requestType === 'analysis') {
      config.responseSchema = SCHEMAS.ANALYSIS;
    } else if (responseSchema) {
      // Convert the provided schema
      config.responseSchema = convertSchema(responseSchema);
    }

    // Make the API call
    const response = await ai.models.generateContent({
      model: modelId,
      contents,
      config,
    });

    const text = response.text;
    if (!text) {
      return errorResponse('Empty response from AI');
    }

    // Parse and return the response
    const data = JSON.parse(text);
    return jsonResponse({ success: true, data });
  } catch (error) {
    console.error('Gemini proxy error:', error);

    // Extract meaningful error message
    let message = error.message || 'Unknown error';

    // Check for rate limiting
    if (message.includes('429') || message.includes('quota') || message.includes('rate')) {
      return errorResponse(`Rate limit exceeded: ${message}`, 429);
    }

    // Check for auth errors
    if (message.includes('401') || message.includes('API key')) {
      return errorResponse(`Authentication failed: ${message}`, 401);
    }

    return errorResponse(`Gemini API error: ${message}`, 500);
  }
}
