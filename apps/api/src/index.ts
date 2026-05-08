import express, { type Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import authRouter from './routes/auth.js';
import helloRouter from './routes/hello.js';
import scanRouter from './routes/scan.js';
import calibrationRouter from './routes/calibration.js';
import benchmarkRouter from './routes/benchmark.js';
import meResponsesRouter from './routes/me_responses.js';
import { startCalibrationCron } from './services/calibration/cron.js';
import { allowedOrigins, corsOptions } from './config/cors.js';
import { logEnvSummary } from './config/env.js';
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
// GET /api/health?deep=1        → pings DB + Solana RPC
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

// Routes — Validator-only surface (post-pivot 2026-05-04).
// The autotest marketplace routes (/api/test, /api/tester, /api/report,
// /api/persona, /api/autotest, /api/autotest-bsc, /api/dashboard,
// /api/dev, /api/x402-demo) are preserved at backup/api/src/routes/
// and excluded from the build. See BACKUP.md.
app.use('/api/auth', authRouter);
app.use('/api/hello', helloRouter);
app.use('/api/scan', scanRouter);
app.use('/api/calibration', calibrationRouter);
app.use('/api/benchmark', benchmarkRouter);
app.use('/api/me', meResponsesRouter);

// Static file serving for screenshots (local dev fallback, production uses R2 CDN)
if (process.env.NODE_ENV !== 'production') {
  app.use('/screenshots', express.static(path.resolve('../../screenshots')));
  // Dev capture serving — services/site_capture.ts writes PNGs to
  // /tmp/site-captures/<hash>.png and returns "/site-captures/..."
  // URLs when R2 isn't configured.
  app.use('/site-captures', express.static('/tmp/site-captures'));
}

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'API listening');
  logEnvSummary();

  // Calibration Track A weekly cron — gated by
  // CALIBRATION_CRON_ENABLED env. No-op when env is unset.
  startCalibrationCron();
});

export default app;
