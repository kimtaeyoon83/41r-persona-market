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
import authRouter from './routes/auth.js';
import devRouter from './routes/dev.js';
import dashboardRouter from './routes/dashboard.js';
import scanRouter from './routes/scan.js';
import calibrationRouter from './routes/calibration.js';
import { devHarnessEnabled } from './middleware/dev_auth.js';
import {
  createX402Middleware,
  createFallbackPaymentMiddleware,
} from './middleware/x402.js';
import { startSettlementWorker } from './services/settlement-worker.js';
import { allowedOrigins, corsOptions } from './config/cors.js';
import { useX402Fallback, logEnvSummary } from './config/env.js';
import { logger } from './logger.js';
import { runHealthChecks } from './services/health.js';

dotenv.config({ path: '../../.env' });
// In production (Docker), env vars are injected directly — dotenv is a no-op

const app: Express = express();
const PORT = process.env.PORT || process.env.API_PORT || 4100;

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
logger.info({ allowedOrigins }, 'CORS allowlist');

// Health check — shallow (process alive) + deep (dependencies).
// GET /api/health               → shallow, 200 if the process is up
// GET /api/health?deep=1        → pings DB, persona-engine, Solana RPC
app.get('/api/health', async (req, res) => {
  const timestamp = new Date().toISOString();
  if (req.query.deep !== '1') {
    res.json({ status: 'ok', timestamp });
    return;
  }
  const checks = await runHealthChecks();
  const healthy = Object.values(checks).every((c) => c.status === 'ok');
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp,
    dependencies: checks,
  });
});

// ---------------------------------------------------------------------------
// x402 Payment Middleware — applied at root to gate specific routes
// Gated routes: /api/hello ($0.001), /api/test/:id/results ($0.05),
//               /api/persona/search ($0.05), /api/persona/:id ($0.10)
// The middleware internally checks req.path to decide which routes need payment.
// ---------------------------------------------------------------------------
try {
  const x402Mode = useX402Fallback ? 'fallback' : 'x402';
  const x402Middleware = x402Mode === 'fallback'
    ? createFallbackPaymentMiddleware()
    : createX402Middleware();
  // Apply at root — middleware internally matches gated paths
  app.use(x402Middleware);
  logger.info({ mode: x402Mode }, 'x402 middleware applied');
} catch (err) {
  logger.warn({ err: err instanceof Error ? err.message : err }, 'x402 middleware init failed');
}

// Routes
app.use('/api/auth', authRouter);
app.use('/api/hello', helloRouter);
app.use('/api/test', testRouter);
app.use('/api/tests', testRouter);
app.use('/api/tester', testerRouter);
app.use('/api/testers', testerRouter);
app.use('/api/report', reportRouter);
app.use('/api/reports', reportRouter);
app.use('/api/persona', personaRouter);
app.use('/api/personas', personaRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/scan', scanRouter);
app.use('/api/calibration', calibrationRouter);
app.use('/api/autotest', autotestRouter);
app.use('/api/autotest-bsc', autotestBscRouter);
app.use('/api/x402-demo', x402DemoRouter);

// Dev harness — only mounted when DEV_TEST_KEY is set in env.
// See middleware/dev_auth.ts + routes/dev.ts. Absent env ⇒ 404.
if (devHarnessEnabled) {
  app.use('/api/dev', devRouter);
  logger.info('[dev] harness mounted at /api/dev (DEV_TEST_KEY is set)');
}

// Static file serving for screenshots (local dev fallback, production uses R2 CDN)
if (process.env.NODE_ENV !== 'production') {
  app.use('/screenshots', express.static(path.resolve('../../screenshots')));
  // Dev replay serving — when R2 isn't configured, services/video.ts
  // returns the bucket key as the URL ("replays/<sid>.webm"). The web
  // UI prefixes with API_BASE; this static handler resolves it from
  // local /tmp where ffmpeg wrote the file. routes/autotest.ts skips
  // the post-upload unlinkSync in the R2-fallback case so the file
  // stays around for serving.
  app.use('/replays', express.static('/tmp/stagehand-videos'));
  // Dev capture serving — services/site_capture.ts writes PNGs to
  // /tmp/site-captures/<hash>.png and returns "/site-captures/..."
  // URLs when R2 isn't configured.
  app.use('/site-captures', express.static('/tmp/site-captures'));
}

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'API listening');
  logEnvSummary();

  // Kick off the settlement retry worker. Safe to call at boot even if
  // no pending rows exist — the first tick is a no-op in that case.
  // Disable with SETTLEMENT_WORKER_DISABLED=1 (e.g. during tests).
  if (process.env.SETTLEMENT_WORKER_DISABLED !== '1') {
    startSettlementWorker();
  }
});

export default app;
