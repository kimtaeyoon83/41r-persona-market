// Credit ledger service (Console Sprint 1 — console-ia-redesign.md §4).
//
// Founder-side spend currency. Append-only: every state change is a
// new credit_transactions row; balance = SUM(amount_cents). Concurrent
// debits for one user are serialized with a per-user pg advisory xact
// lock so two in-flight scans can't both pass the balance check.
//
// Signup bonus (decision §12-2): verified identity (email / Google /
// social — any non-wallet linked account) gets $30; wallet-only gets
// $5 and is topped up with the $25 difference if an email/social
// account is linked later. expires_at is recorded (90 days) but NOT
// enforced during the pilot (decision §12-3).

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { logger } from '../logger.js';

const log = logger.child({ service: 'credits' });

export const SIGNUP_BONUS_VERIFIED_CENTS = 3000;
export const SIGNUP_BONUS_WALLET_CENTS = 500;
export const SCAN_PRICE_CENTS: Record<'A' | 'B', number> = { A: 200, B: 100 };
const BONUS_EXPIRY_DAYS = 90;

const SCAN_DEBIT_REASONS = ['scan_mode_a', 'scan_mode_b'] as const;

/** In-memory fast path: users whose bonus is fully resolved (verified-
 *  level grant present). Wallet-only grants stay out so a later login
 *  with a linked email still triggers the upgrade row. Reset on process
 *  restart — the DB check is the source of truth. */
const bonusResolved = new Set<string>();

function expiryDate(): Date {
  return new Date(Date.now() + BONUS_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}

/** Balance in cents. */
export async function getCreditBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({
      balance: sql<number>`coalesce(sum(${schema.creditTransactions.amountCents}), 0)::int`,
    })
    .from(schema.creditTransactions)
    .where(eq(schema.creditTransactions.userId, userId));
  return row?.balance ?? 0;
}

/**
 * Grant the signup bonus exactly once per user, with the wallet-only →
 * verified upgrade path. Called from the privy_auth upsert on every
 * authed request; cheap after the first resolution thanks to the
 * in-memory set + indexed select. Never throws — a grant failure must
 * not block auth (same contract as claimPartnerRows).
 */
export async function ensureSignupBonus(
  userId: string,
  hasVerifiedIdentity: boolean,
): Promise<void> {
  if (bonusResolved.has(userId)) return;
  try {
    const grants = await db
      .select({ reason: schema.creditTransactions.reason })
      .from(schema.creditTransactions)
      .where(
        and(
          eq(schema.creditTransactions.userId, userId),
          inArray(schema.creditTransactions.reason, [
            'signup_bonus',
            'signup_bonus_wallet',
            'signup_bonus_upgrade',
          ]),
        ),
      );
    const has = new Set(grants.map((g) => g.reason));

    if (has.has('signup_bonus') || has.has('signup_bonus_upgrade')) {
      bonusResolved.add(userId);
      return;
    }

    if (!has.has('signup_bonus_wallet')) {
      // First grant for this user.
      const reason = hasVerifiedIdentity ? 'signup_bonus' : 'signup_bonus_wallet';
      const amountCents = hasVerifiedIdentity
        ? SIGNUP_BONUS_VERIFIED_CENTS
        : SIGNUP_BONUS_WALLET_CENTS;
      await db.insert(schema.creditTransactions).values({
        userId,
        amountCents,
        reason,
        expiresAt: expiryDate(),
      });
      log.info({ userId, reason, amountCents }, 'signup bonus granted');
      if (hasVerifiedIdentity) bonusResolved.add(userId);
      return;
    }

    // Wallet-only grant exists; top up the difference once verified.
    if (hasVerifiedIdentity) {
      await db.insert(schema.creditTransactions).values({
        userId,
        amountCents: SIGNUP_BONUS_VERIFIED_CENTS - SIGNUP_BONUS_WALLET_CENTS,
        reason: 'signup_bonus_upgrade',
        expiresAt: expiryDate(),
      });
      log.info({ userId }, 'signup bonus upgraded (wallet-only → verified)');
      bonusResolved.add(userId);
    }
  } catch (err) {
    log.warn(
      { userId, err: err instanceof Error ? err.message : 'unknown' },
      'signup bonus grant failed (non-fatal)',
    );
  }
}

/**
 * Debit a scan. Returns true when the debit row was written, false on
 * insufficient balance (caller responds 402; no row is left behind).
 * Per-user advisory xact lock serializes concurrent debits so the
 * balance check + insert is race-safe without table locks.
 */
export async function debitScan(
  userId: string,
  scanId: string,
  mode: 'A' | 'B',
): Promise<boolean> {
  const price = SCAN_PRICE_CENTS[mode];
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'credits:' + userId}))`);
    const [row] = await tx
      .select({
        balance: sql<number>`coalesce(sum(${schema.creditTransactions.amountCents}), 0)::int`,
      })
      .from(schema.creditTransactions)
      .where(eq(schema.creditTransactions.userId, userId));
    if ((row?.balance ?? 0) < price) return false;
    await tx.insert(schema.creditTransactions).values({
      userId,
      amountCents: -price,
      reason: mode === 'A' ? 'scan_mode_a' : 'scan_mode_b',
      refId: scanId,
    });
    return true;
  });
}

/**
 * Refund a failed scan's debit. Idempotent — at most one refund per
 * scan, enforced by checking under the same per-user advisory lock.
 * No-op when the scan never had a debit (anonymous demo scans).
 * Never throws (called from pipeline failure paths).
 */
export async function refundScanDebit(scanId: string): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(schema.creditTransactions)
      .where(eq(schema.creditTransactions.refId, scanId));
    const debit = rows.find((r) =>
      (SCAN_DEBIT_REASONS as readonly string[]).includes(r.reason),
    );
    if (!debit) return;
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${'credits:' + debit.userId}))`,
      );
      const [existing] = await tx
        .select({ id: schema.creditTransactions.id })
        .from(schema.creditTransactions)
        .where(
          and(
            eq(schema.creditTransactions.refId, scanId),
            eq(schema.creditTransactions.reason, 'scan_refund'),
          ),
        );
      if (existing) return;
      await tx.insert(schema.creditTransactions).values({
        userId: debit.userId,
        amountCents: -debit.amountCents, // mirror the debit (positive)
        reason: 'scan_refund',
        refId: scanId,
      });
    });
    log.info({ scanId }, 'scan debit refunded');
  } catch (err) {
    log.warn(
      { scanId, err: err instanceof Error ? err.message : 'unknown' },
      'scan refund failed (non-fatal)',
    );
  }
}
