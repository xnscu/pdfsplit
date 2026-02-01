/**
 * Gemini Proxy Routes
 * Transparent proxy for Gemini API requests
 */
import { Hono } from 'hono';
import ProxyWorker from '../proxy.mjs';

const geminiRoutes = new Hono();

// Proxy all requests to Gemini API
geminiRoutes.all('/*', async (c) => {
  const request = c.req.raw;
  const env = c.env;
  const ctx = c.executionCtx;

  // Strip /api/gemini prefix to get the target path expected by proxy.mjs
  const urlObj = new URL(request.url);
  urlObj.pathname = urlObj.pathname.replace('/api/gemini', '');

  // Create a new request with the modified URL
  const newRequest = new Request(urlObj.toString(), request);

  return ProxyWorker.fetch(newRequest, env, ctx);
});

export default geminiRoutes;
