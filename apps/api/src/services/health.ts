import { pool } from '../db/index.js';
import { env } from '../config/env.js';

const SOLANA_RPC_URL = env.SOLANA_RPC_URL;
const CHECK_TIMEOUT_MS = env.HEALTH_CHECK_TIMEOUT_MS;

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
  const [db, rpc] = await Promise.all([
    checkDatabase(),
    checkSolanaRpc(),
  ]);
  return { db, solanaRpc: rpc };
}
