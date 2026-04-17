import express, { type Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import testRouter from './routes/test.js';
import testerRouter from './routes/tester.js';
import reportRouter from './routes/report.js';
import personaRouter from './routes/persona.js';
import autotestRouter from './routes/autotest.js';
import autotestBscRouter from './routes/autotest-bsc.js';
import helloRouter from './routes/hello.js';
import x402DemoRouter from './routes/x402-demo.js';
import {
  createX402Middleware,
  createFallbackPaymentMiddleware,
} from './middleware/x402.js';

dotenv.config({ path: '../../.env' });
// In production (Docker), env vars are injected directly — dotenv is a no-op

const app: Express = express();
const PORT = process.env.PORT || process.env.API_PORT || 4100;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// x402 Payment Middleware — applied at root to gate specific routes
// Gated routes: /api/hello ($0.001), /api/test/:id/results ($0.05),
//               /api/persona/search ($0.05), /api/persona/:id ($0.10)
// The middleware internally checks req.path to decide which routes need payment.
// ---------------------------------------------------------------------------
try {
  const x402Mode = process.env.USE_X402_FALLBACK === 'true' ? 'fallback' : 'x402';
  const x402Middleware = x402Mode === 'fallback'
    ? createFallbackPaymentMiddleware()
    : createX402Middleware();
  // Apply at root — middleware internally matches gated paths
  app.use(x402Middleware);
  console.log(`[api] x402 middleware applied (mode: ${x402Mode}) — /api/hello, /api/test/*/results, /api/persona/*`);
} catch (err) {
  console.warn('[api] x402 middleware init failed, routes mounted without payment gate:', err instanceof Error ? err.message : err);
}

// Routes
app.use('/api/hello', helloRouter);
app.use('/api/test', testRouter);
app.use('/api/tests', testRouter);
app.use('/api/tester', testerRouter);
app.use('/api/testers', testerRouter);
app.use('/api/report', reportRouter);
app.use('/api/reports', reportRouter);
app.use('/api/persona', personaRouter);
app.use('/api/personas', personaRouter);
app.use('/api/autotest', autotestRouter);
app.use('/api/autotest-bsc', autotestBscRouter);
app.use('/api/x402-demo', x402DemoRouter);

// Static file serving for screenshots (local dev fallback, production uses R2 CDN)
if (process.env.NODE_ENV !== 'production') {
  app.use('/screenshots', express.static(path.resolve('../../screenshots')));
}

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});

export default app;
