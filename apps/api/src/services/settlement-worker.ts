/**
 * Settlement retry worker.
 *
 * Background task that scans ``settlements`` rows whose ``txSignature``
 * still starts with ``pending_`` and re-attempts the USDC transfer.
 *
 * Behavior:
 *   - runs every ``SETTLEMENT_RETRY_INTERVAL_MS`` (default 30s)
 *   - per-row exponential backoff: 30s → 1m → 5m → 15m (then 15m cap)
 *     — so a flaky devnet doesn't generate hundreds of retries per row
 *   - rows older than ``SETTLEMENT_MAX_AGE_MS`` (24h by default) are
 *     flipped to ``failed_<ts>`` regardless of retryCount so the queue
 *     stays bounded
 *   - on InsufficientFundsError, skips remaining rows for this tick and
 *     logs PAYER_DRY so ops can top up the payer wallet
 */
import { and, asc, eq, like } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { InsufficientFundsError, solanaService } from './solana.js';
import { childLogger } from '../logger.js';

const log = childLogger({ module: 'settlement-worker' });

const INTERVAL_MS = Number(process.env.SETTLEMENT_RETRY_INTERVAL_MS ?? 30_000);
const BATCH_SIZE = Number(process.env.SETTLEMENT_RETRY_BATCH ?? 40);
const MAX_AGE_MS = Number(process.env.SETTLEMENT_MAX_AGE_MS ?? 24 * 60 * 60 * 1000);

// Delay before the Nth retry (index = retryCount). After the last entry
// the cap repeats.
const BACKOFF_SCHEDULE_MS: readonly number[] = [
  30_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
];

export function backoffDelayMs(retryCount: number): number {
  if (retryCount < 0) return BACKOFF_SCHEDULE_MS[0];
  return BACKOFF_SCHEDULE_MS[Math.min(retryCount, BACKOFF_SCHEDULE_MS.length - 1)];
}

export function isRowEligible(
  row: { retryCount: number; lastRetryAt: Date | null; settledAt: Date | null },
  now = Date.now(),
): boolean {
  const reference = row.lastRetryAt ?? row.settledAt;
  if (!reference) return true;
  return reference.getTime() + backoffDelayMs(row.retryCount) <= now;
}

export function isRowExpired(row: { settledAt: Date | null }, now = Date.now()): boolean {
  if (!row.settledAt) return false;
  return now - row.settledAt.getTime() >= MAX_AGE_MS;
}

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

export interface RetryTickResult {
  attempted: number;
  succeeded: number;
  failedTerminal: number;
  skippedPayerDry: number;
  skippedBackoff: number;
}

export async function runRetryTick(): Promise<RetryTickResult> {
  const candidates = await db.select().from(schema.settlements)
    .where(like(schema.settlements.txSignature, 'pending_%'))
    .orderBy(asc(schema.settlements.settledAt))
    .limit(BATCH_SIZE);

  const result: RetryTickResult = {
    attempted: 0,
    succeeded: 0,
    failedTerminal: 0,
    skippedPayerDry: 0,
    skippedBackoff: 0,
  };
  if (candidates.length === 0) return result;

  const now = Date.now();

  for (const row of candidates) {
    // Age-based terminal: unconditionally retire rows older than MAX_AGE.
    if (isRowExpired(row, now)) {
      const newSig = (row.txSignature ?? `pending_${now}`).replace(/^pending_/, 'failed_');
      await db.update(schema.settlements)
        .set({
          txSignature: newSig,
          retryCount: row.retryCount + 1,
          lastRetryAt: new Date(),
        })
        .where(eq(schema.settlements.id, row.id));
      result.failedTerminal++;
      log.error({ rowId: row.id, newSig, maxAgeMs: MAX_AGE_MS }, 'settlement expired');
      continue;
    }

    if (!isRowEligible(row, now)) {
      result.skippedBackoff++;
      continue;
    }

    result.attempted++;
    try {
      const { txSignature } = await solanaService.transferUsdc(row.payeeAddr, row.amountToken);
      await db.update(schema.settlements)
        .set({
          txSignature,
          retryCount: row.retryCount + 1,
          lastRetryAt: new Date(),
        })
        .where(eq(schema.settlements.id, row.id));
      result.succeeded++;
      log.info({ rowId: row.id, retry: row.retryCount + 1, txSignature }, 'settlement paid');
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        // Payer wallet is dry — no point trying remaining rows this tick.
        // Don't increment retryCount; these rows aren't "broken", ops just
        // needs to refill the wallet.
        result.skippedPayerDry = candidates.length - (result.attempted - 1);
        log.error(
          { event: 'PAYER_DRY', needed: err.needed, available: err.available },
          'settlement worker stopping — payer wallet empty',
        );
        break;
      }

      await db.update(schema.settlements)
        .set({
          retryCount: row.retryCount + 1,
          lastRetryAt: new Date(),
        })
        .where(eq(schema.settlements.id, row.id));
      const nextDelay = backoffDelayMs(row.retryCount + 1);
      log.warn(
        { rowId: row.id, retry: row.retryCount + 1, nextDelayMs: nextDelay, err: err instanceof Error ? err.message : err },
        'settlement retry failed',
      );
    }
  }

  return result;
}

export function startSettlementWorker(): void {
  if (timer) return;
  log.info({ intervalMs: INTERVAL_MS, batchSize: BATCH_SIZE, maxAgeMs: MAX_AGE_MS }, 'settlement worker starting');
  timer = setInterval(async () => {
    if (isRunning) return; // skip if previous tick still running
    isRunning = true;
    try {
      await runRetryTick();
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : err }, 'tick threw unexpectedly');
    } finally {
      isRunning = false;
    }
  }, INTERVAL_MS);
  // Don't keep the process alive just because this timer is running.
  timer.unref?.();
}

export function stopSettlementWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
