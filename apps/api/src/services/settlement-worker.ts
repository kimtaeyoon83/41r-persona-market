/**
 * Settlement retry worker.
 *
 * Background task that scans ``settlements`` rows whose ``txSignature``
 * still starts with ``pending_`` and re-attempts the USDC transfer.
 * This closes the gap where a single devnet blip at report-submit
 * time previously left the tester permanently unpaid with a fake
 * ``pending_<ts>`` signature (audit C3).
 *
 * Behavior:
 *   - runs every ``SETTLEMENT_RETRY_INTERVAL_MS`` (default 30s)
 *   - at most ``SETTLEMENT_RETRY_BATCH`` rows per tick (default 20)
 *   - at most ``SETTLEMENT_RETRY_MAX`` retries per row (default 3)
 *   - on InsufficientFundsError, skips remaining rows for this tick
 *     and logs PAYER_DRY so ops can top up the payer wallet
 *   - on exhaustion, flips prefix to ``failed_<ts>`` so future ticks
 *     skip the row
 */
import { and, asc, eq, like, lt } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { InsufficientFundsError, solanaService } from './solana.js';

const INTERVAL_MS = Number(process.env.SETTLEMENT_RETRY_INTERVAL_MS ?? 30_000);
const BATCH_SIZE = Number(process.env.SETTLEMENT_RETRY_BATCH ?? 20);
const MAX_RETRIES = Number(process.env.SETTLEMENT_RETRY_MAX ?? 3);

let timer: NodeJS.Timeout | null = null;
let isRunning = false;

export interface RetryTickResult {
  attempted: number;
  succeeded: number;
  failedTerminal: number;
  skippedPayerDry: number;
}

export async function runRetryTick(): Promise<RetryTickResult> {
  const rows = await db.select().from(schema.settlements)
    .where(and(
      like(schema.settlements.txSignature, 'pending_%'),
      lt(schema.settlements.retryCount, MAX_RETRIES),
    ))
    .orderBy(asc(schema.settlements.settledAt))
    .limit(BATCH_SIZE);

  const result: RetryTickResult = { attempted: 0, succeeded: 0, failedTerminal: 0, skippedPayerDry: 0 };
  if (rows.length === 0) return result;

  for (const row of rows) {
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
      console.log(`[settlement-worker] row=${row.id.slice(0, 8)} retry=${row.retryCount + 1} → ${txSignature.slice(0, 10)}…`);
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        // Payer wallet is dry — no point trying remaining rows this
        // tick. Don't increment retryCount either; these rows aren't
        // "broken", ops just needs to refill the wallet.
        result.skippedPayerDry = rows.length - (result.attempted - 1);
        console.error(
          `[settlement-worker] PAYER_DRY needed=${err.needed} available=${err.available} — stopping tick`,
        );
        break;
      }

      const nextCount = row.retryCount + 1;
      const terminal = nextCount >= MAX_RETRIES;
      const newSig = terminal
        ? (row.txSignature ?? `pending_${Date.now()}`).replace(/^pending_/, 'failed_')
        : row.txSignature;
      await db.update(schema.settlements)
        .set({
          retryCount: nextCount,
          lastRetryAt: new Date(),
          ...(terminal ? { txSignature: newSig } : {}),
        })
        .where(eq(schema.settlements.id, row.id));
      if (terminal) {
        result.failedTerminal++;
        console.error(
          `[settlement-worker] row=${row.id.slice(0, 8)} exhausted retries → ${newSig}`,
          err instanceof Error ? err.message : err,
        );
      } else {
        console.warn(
          `[settlement-worker] row=${row.id.slice(0, 8)} retry ${nextCount}/${MAX_RETRIES} failed, will try again`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return result;
}

export function startSettlementWorker(): void {
  if (timer) return;
  console.log(`[settlement-worker] starting — interval=${INTERVAL_MS}ms batch=${BATCH_SIZE} maxRetries=${MAX_RETRIES}`);
  timer = setInterval(async () => {
    if (isRunning) return; // skip if previous tick still running
    isRunning = true;
    try {
      await runRetryTick();
    } catch (err) {
      console.error('[settlement-worker] tick threw unexpectedly:', err);
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
