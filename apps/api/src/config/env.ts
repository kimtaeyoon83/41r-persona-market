/**
 * Single source of truth for all environment variables.
 *
 * Validates at boot via Zod. Required keys (DATABASE_URL, ANTHROPIC_API_KEY)
 * fail-fast with a clear message; optional keys default to safe values.
 *
 * Production safety:
 *   - SKIP_PAYMENT_VERIFY is forced to false when NODE_ENV=production
 *     regardless of input.
 *   - Missing production-only keys (R2_*, PRIVY_*) log a
 *     warning at boot via logEnvSummary() instead of throwing, so the
 *     server can still start in degraded mode.
 *
 * Direct `process.env.X` access in apps/api/src is discouraged. Add new
 * keys here and import via `env.X`.
 */
import dotenv from 'dotenv';
import { z } from 'zod';

// ESM imports resolve before index.ts can call dotenv.config(), so without
// this early load the schema below would see an empty process.env in local
// dev. Mirrors the pattern in middleware/dev_auth.ts and db/index.ts.
// Skip during vitest runs — tests inject env vars directly via vi.resetModules
// and re-loading .env would clobber test setup.
if (!process.env.VITEST) {
  dotenv.config({ path: new URL('../../../../.env', import.meta.url).pathname });
}

// ─── Helpers ────────────────────────────────────────────────────────

const boolFromString = (defaultValue: boolean) =>
  z
    .union([z.string(), z.boolean(), z.undefined()])
    .transform((v) => {
      if (typeof v === 'boolean') return v;
      if (v === undefined || v === '') return defaultValue;
      return v === 'true' || v === '1';
    });

const intFromString = (defaultValue: number) =>
  z
    .union([z.string(), z.number(), z.undefined()])
    .transform((v) => {
      if (typeof v === 'number') return v;
      if (v === undefined || v === '') return defaultValue;
      const n = Number(v);
      return Number.isFinite(n) ? n : defaultValue;
    });

// ─── Schema ─────────────────────────────────────────────────────────

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: intFromString(0),
  API_PORT: intFromString(4100),
  LOG_LEVEL: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().optional(),

  // Database (required)
  DATABASE_URL: z.string().url({ message: 'DATABASE_URL must be a valid Postgres URL' }),
  DB_POOL_MAX: intFromString(30),
  DB_POOL_MIN: intFromString(2),
  DB_POOL_IDLE_MS: intFromString(30_000),
  DB_POOL_CONNECT_MS: intFromString(5_000),

  // Anthropic (required for any LLM-touching path)
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  CLAUDE_SONNET_MODEL: z.string().default('claude-sonnet-4-6'),
  CLAUDE_HAIKU_MODEL: z.string().default('claude-haiku-4-5-20251001'),
  USAGE_LOG_PATH: z.string().default('/tmp/llm-usage.jsonl'),

  HOME: z.string().optional(),

  // ── Sui (chain — design doc v0.4 §0.1; Solana fully removed) ──
  // SUI_PACKAGE_ID is set after publishing the rpm Move package
  // (scripts/sui-publish.ts). PERSONA_MASTER_MNEMONIC (below) HD-derives
  // the server-custodied Sui persona wallets.
  SUI_RPC_URL: z.string().url().default('https://fullnode.testnet.sui.io:443'),
  SUI_NETWORK: z
    .enum(['testnet', 'mainnet', 'devnet', 'localnet'])
    .default('testnet'),
  SUI_KEYPAIR_JSON: z.string().optional(), // bech32 `suiprivkey1...`
  SUI_PACKAGE_ID: z.string().optional(),

  // ── Walrus (MemWal blob storage, §4.2) ──
  // Public-by-default object storage; sensitive data MUST be Seal-
  // encrypted before putBlob (§4.4). Defaults point at the testnet
  // publisher/aggregator.
  WALRUS_PUBLISHER_URL: z
    .string()
    .url()
    .default('https://publisher.walrus-testnet.walrus.space'),
  WALRUS_AGGREGATOR_URL: z
    .string()
    .url()
    .default('https://aggregator.walrus-testnet.walrus.space'),
  WALRUS_EPOCHS: z.coerce.number().int().positive().default(1),

  // ── Seal (threshold encryption / gating, §4.4, §6.3) ──
  // The t-of-n key-server COMMITTEE is a residual-trust decision (§6.3),
  // deliberately deferred: supply the testnet committee object IDs via
  // SEAL_KEY_SERVER_IDS (comma-separated) rather than hardcoding a
  // provider set. SEAL_THRESHOLD = how many must cooperate to decrypt.
  SEAL_KEY_SERVER_IDS: z.string().optional(),
  SEAL_THRESHOLD: z.coerce.number().int().positive().default(1),

  // ── USDC escrow (pay-per-scan campaigns, §4.3) ──
  // Circle native USDC coin type. Default = Sui testnet. The reward escrow
  // (rpm::campaign Campaign<T>) is funded in this coin; the server verifies
  // the create tx + settles/closes the campaign. 6 decimals.
  SUI_USDC_COIN_TYPE: z
    .string()
    .default(
      '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
    ),

  // ── Mode C build gate (behavior simulation §11) ──
  // THE single source of truth for whether autonomous (Mode C) traversal
  // sessions are allowed. Stays false in production until the human
  // think-aloud calibration passes (scripts/spike-behavior-sim/calibrate.ts).
  // planSession() reads this via runModeCSession; flipping it to 1 is the
  // ONLY switch that unblocks Mode C — do not bypass the gate elsewhere.
  THINK_ALOUD_GATE_PASSED: boolFromString(false),

  // Payment verification flags (credit-ledger gating).
  SKIP_PAYMENT_VERIFY: boolFromString(false),
  USE_X402_FALLBACK: boolFromString(false),

  PERSONA_SOURCE_REPORT_LIMIT: intFromString(5),

  // Privy (Phase 4 §1) — single-auth identity provider.
  // Local dev without these set disables /api/auth/me (returns 503).
  // Prod must have both.
  PRIVY_APP_ID: z.string().optional(),
  PRIVY_APP_SECRET: z.string().optional(),

  // AES-256-GCM key for encrypting stored partner auth sessions
  // (authenticated capture — services/crypto_box.ts). 32-byte key as
  // 64 hex chars or base64. Absent ⇒ session storage is disabled (the
  // console rejects uploads), so gated-app capture just isn't offered.
  SESSION_ENC_KEY: z.string().optional(),

  // Master mnemonic for HD-derived synthetic persona wallets
  // (Phase 2 §D2). Only seed scripts + show-persona-key CLI need it —
  // the API itself doesn't sign as personas.
  PERSONA_MASTER_MNEMONIC: z.string().optional(),

  // R2 (production only — empty default lets dev run without it)
  R2_ACCOUNT_ID: z.string().default(''),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_BUCKET: z.string().default('41rpm-screenshots'),
  R2_PUBLIC_URL: z.string().default('https://pub-d5db789b01364e288af930cfd54a666e.r2.dev'),

  // EVM / BSC
  EVM_FACILITATOR_PRIVATE_KEY: z.string().optional(),
  BSC_RPC_URL: z.string().optional(),
  BSC_MOCKUSDC_ADDRESS: z.string().optional(),
  X402_EVM_RESOURCE_WALLET: z.string().optional(),

  // Stagehand / browser
  CHROMIUM_PATH: z.string().optional(),
  STAGEHAND_SCREENSHOTS_DIR: z.string().optional(),

  // Timeouts / runtime tuning
  QUALITY_SCORE_TIMEOUT_MS: intFromString(30_000),
  HEALTH_CHECK_TIMEOUT_MS: intFromString(2_000),
  SETTLEMENT_RETRY_INTERVAL_MS: intFromString(30_000),
  SETTLEMENT_RETRY_BATCH: intFromString(40),
  SETTLEMENT_MAX_AGE_MS: intFromString(24 * 60 * 60 * 1000),
  SETTLEMENT_WORKER_DISABLED: boolFromString(false),

  // Dev harness
  DEV_TEST_KEY: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // Use console here — logger.ts itself depends on env (LOG_LEVEL)
    // and we want a readable failure before pino is wired up.
    console.error(`[env] validation failed:\n${issues}`);
    throw new Error('Environment validation failed. See errors above.');
  }
  const e = parsed.data;
  // Production safety: SKIP_PAYMENT_VERIFY can never be true in prod.
  if (e.NODE_ENV === 'production' && e.SKIP_PAYMENT_VERIFY) {
    console.warn('[env] SKIP_PAYMENT_VERIFY=true ignored in production (forced to false)');
    e.SKIP_PAYMENT_VERIFY = false;
  }
  return e;
}

export const env = loadEnv();

// ─── Backwards-compatible exports (existing imports use these) ──────

export const skipPaymentVerify = env.SKIP_PAYMENT_VERIFY;
export const useX402Fallback = env.USE_X402_FALLBACK;
/** Mode C build gate — false until think-aloud calibration passes (§11). */
export const thinkAloudGatePassed = env.THINK_ALOUD_GATE_PASSED;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

export function logEnvSummary(): void {
  console.log(
    `[env] NODE_ENV=${env.NODE_ENV} · ` +
      `payment verify: ${env.SKIP_PAYMENT_VERIFY ? 'SKIPPED' : 'ENABLED'}`,
  );
  // R2 is required for production screenshot CDN — warn but don't throw.
  if (env.NODE_ENV === 'production' && !env.R2_ACCESS_KEY_ID) {
    console.warn('[env] R2_ACCESS_KEY_ID missing — screenshots will fail in production');
  }
}
