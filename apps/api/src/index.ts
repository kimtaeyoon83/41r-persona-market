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
import consoleRouter from './routes/console.js';
import partnerRouter from './routes/partner.js';
import { startCalibrationCron } from './services/calibration/cron.js';
import { startDigestCron } from './services/notify.js';
import { allowedOrigins, corsOptions } from './config/cors.js';
import { logEnvSummary } from './config/env.js';
import { readLimiter } from './middleware/rate_limit.js';
import { requireAdminKeyIfConfigured } from './middleware/admin.js';
import { logger } from './logger.js';
import { runHealthChecks } from './services/health.js';

dotenv.config({ path: '../../.env' });
// In production (Docker), env vars are injected directly — dotenv is a no-op

const app: Express = express();
const PORT = process.env.PORT || process.env.API_PORT || 4100;

// Railway terminates TLS at a single proxy hop — trust it so req.ip
// (rate-limit keys, anonymous demo-limit keys) is the real client IP,
// not the proxy. Required by express-rate-limit's IP validation.
app.set('trust proxy', 1);

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
// Rate limiting (Console Sprint 1 — closes Known Limitations §9).
// readLimiter is the router-wide baseline; POST /api/scan carries its
// own stricter limiters inside routes/scan.ts. The partner router is
// excluded — beacons are high-frequency by design.
app.use('/api/auth', readLimiter, authRouter);
app.use('/api/hello', readLimiter, helloRouter);
app.use('/api/scan', readLimiter, scanRouter);
// Calibration is an operator/dev surface — demoted to operator-only
// when ADMIN_API_KEY is configured (console-ia-redesign.md §3.2).
app.use('/api/calibration', readLimiter, requireAdminKeyIfConfigured, calibrationRouter);
app.use('/api/benchmark', readLimiter, benchmarkRouter);
app.use('/api/me', readLimiter, meResponsesRouter);
// Founder Console workspace CRUD (Console S2) — Privy-gated inside.
app.use('/api/console', readLimiter, consoleRouter);
// Partner S2S ingest (geulbat pilot) — key-gated, see middleware/partner.ts
app.use('/api/partner', partnerRouter);

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

  // Weekly digest email (Console S3) — gated by DIGEST_CRON_ENABLED.
  startDigestCron();
});

export default app;
