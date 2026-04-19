import { pool } from '../db/index.js';

const PERSONA_ENGINE_URL = process.env.PERSONA_ENGINE_URL ?? 'http://persona-engine:4200';
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
const CHECK_TIMEOUT_MS = Number(process.env.HEALTH_CHECK_TIMEOUT_MS ?? 2_000);

export type CheckStatus = 'ok' | 'error';
export interface CheckResult {
  status: CheckStatus;
  latencyMs: number;
  detail?: string;
}

async function timed(fn: () => Promise<void>): Promise<CheckResult> {
  const started = Date.now();
  try {
    await fn();
    return { status: 'ok', latencyMs: Date.now() - started };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function checkDatabase(): Promise<CheckResult> {
  return timed(async () => {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
    } finally {
      client.release();
    }
  });
}

export async function checkPersonaEngine(): Promise<CheckResult> {
  return timed(async () => {
    const res = await fetchWithTimeout(`${PERSONA_ENGINE_URL}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  });
}

export async function checkSolanaRpc(): Promise<CheckResult> {
  return timed(async () => {
    const res = await fetchWithTimeout(SOLANA_RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { result?: string; error?: unknown };
    if (body.result !== 'ok') throw new Error(`getHealth=${JSON.stringify(body)}`);
  });
}

export async function runHealthChecks(): Promise<Record<string, CheckResult>> {
  const [db, engine, rpc] = await Promise.all([
    checkDatabase(),
    checkPersonaEngine(),
    checkSolanaRpc(),
  ]);
  return { db, personaEngine: engine, solanaRpc: rpc };
}
