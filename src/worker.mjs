/**
 * Cloudflare Worker for GKSX Exam Storage API
 * Provides REST API for D1 database operations and sync with frontend IndexedDB
 * Static assets are served by the Cloudflare Vite plugin / ASSETS binding
 *
 * Modularized using Hono framework
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';

// Import route modules
import r2Routes from './routes/r2.mjs';
import examRoutes from './routes/exams.mjs';
import syncRoutes from './routes/sync.mjs';
import proAnalysisRoutes from './routes/pro-analysis.mjs';
import keyStatsRoutes from './routes/key-stats.mjs';
import geminiRoutes from './routes/gemini.mjs';
import tasksRoutes from './routes/tasks.mjs';
import questionsRoutes from './routes/questions.mjs';

// Create main Hono app
const app = new Hono();

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Sync-Token'],
  maxAge: 86400,
}));

// === Mount API Routes ===

// R2 Storage Routes
app.route('/api/r2', r2Routes);

// Exam Routes
app.route('/api/exams', examRoutes);

// Sync Routes
app.route('/api/sync', syncRoutes);

// Pro Analysis Routes
app.route('/api/pro-analysis', proAnalysisRoutes);

// Tasks Routes
app.route('/api/tasks', tasksRoutes);

// API Key Stats Routes
app.route('/api/key-stats', keyStatsRoutes);

// Gemini Proxy Routes
app.route('/api/gemini', geminiRoutes);

// Questions Routes
app.route('/api/questions', questionsRoutes);

// === Static Assets Handler ===
app.all('*', async (c) => {
  // Static assets - served by ASSETS binding (Cloudflare Vite plugin)
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  // No static assets configured, return 404 for non-API routes
  return c.json({ error: 'Not Found' }, 404);
});

// Export the Hono app as the default export
export default app;
