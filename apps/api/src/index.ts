import express, { type Express } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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
// x402 Payment Middleware (Phase 1.1 PoC)
// ---------------------------------------------------------------------------
// Set USE_X402_FALLBACK=true in .env to use the manual USDC verification
// instead of the x402 facilitator.
if (process.env.USE_X402_FALLBACK === 'true') {
  console.log('[api] Using FALLBACK payment middleware (manual USDC verification)');
  app.use(createFallbackPaymentMiddleware());
} else {
  console.log('[api] Using x402 payment middleware (Coinbase facilitator)');
  app.use(createX402Middleware());
}

// x402-gated route
app.use('/api', helloRouter);

// Routes
app.use('/api/test', testRouter);
app.use('/api/tests', testRouter);
app.use('/api/tester', testerRouter);
app.use('/api/report', reportRouter);
app.use('/api/reports', reportRouter);
app.use('/api/persona', personaRouter);
app.use('/api/personas', personaRouter);
app.use('/api/autotest', autotestRouter);

app.listen(PORT, () => {
  console.log(`[api] listening on http://localhost:${PORT}`);
});

export default app;
