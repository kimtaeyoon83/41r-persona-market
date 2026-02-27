import express, { type Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import testRouter from './routes/test.js';
import testerRouter from './routes/tester.js';
import reportRouter from './routes/report.js';
import personaRouter from './routes/persona.js';
import autotestRouter from './routes/autotest.js';
import helloRouter from './routes/hello.js';
import {
  createX402Middleware,
  createFallbackPaymentMiddleware,
} from './middleware/x402.js';

dotenv.config({ path: '../../.env' });

const app: Express = express();
const PORT = process.env.API_PORT || 4100;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// x402 Payment Middleware — applied to payment-gated routes
// Routes: /api/hello ($0.001), /api/test/:id/results ($0.05),
//         /api/persona/search ($0.05), /api/persona/:id ($0.10)
// ---------------------------------------------------------------------------
try {
  const x402Mode = process.env.USE_X402_FALLBACK === 'true' ? 'fallback' : 'x402';
  const x402Middleware = x402Mode === 'fallback'
    ? createFallbackPaymentMiddleware()
    : createX402Middleware();
  // Apply x402 to all routes — the middleware internally checks which paths are gated
  app.use('/api/hello', x402Middleware, helloRouter);
  // Note: persona and test routes below will also be payment-gated via x402 route config
  console.log(`[api] x402 middleware applied (mode: ${x402Mode}) — /api/hello, /api/test/*/results, /api/persona/*`);
} catch (err) {
  console.warn('[api] x402 middleware init failed, routes mounted without payment gate:', err instanceof Error ? err.message : err);
  app.use('/api/hello', helloRouter);
}

// Routes
app.use('/api/test', testRouter);
app.use('/api/tests', testRouter);
app.use('/api/tester', testerRouter);
app.use('/api/report', reportRouter);
app.use('/api/reports', reportRouter);
app.use('/api/persona', personaRouter);
app.use('/api/personas', personaRouter);
app.use('/api/autotest', autotestRouter);

// Static file serving for screenshots
app.use('/screenshots', express.static(path.resolve('../../screenshots')));

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});

export default app;
