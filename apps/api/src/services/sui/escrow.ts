// USDC escrow campaign lifecycle (design doc §4.3) — the on-chain payment for
// a scan. The requester locks USDC into a shared rpm::campaign Campaign<USDC>;
// this module VERIFIES that create tx and later SETTLES + CLOSES the escrow
// (operator-signed, cap-gated) when the scan completes.
//
// Cap custody: the create PTB sends CampaignOwnerCap to the operator (the §6
// verification anchor), so settle/close are operator-signed here.

import { eq } from 'drizzle-orm';
import { db, schema } from '../../db/index.js';
import { env } from '../../config/env.js';
import { getSuiClient, getSuiSigner, requirePackageId } from './client.js';
import { buildSettleCampaign, buildCloseCampaign } from './tx.js';
import { executeTx } from './anchor.js';
import { childLogger } from '../../logger.js';

const log = childLogger({ svc: 'sui.escrow' });

/** Cents → USDC base units (6 decimals). $2 = 200 cents → 2_000_000. */
export function usdcAmountFromCents(cents: number): bigint {
  return BigInt(cents) * 10_000n;
}

// ─── Verify the create tx (pure parse + async wrapper) ───────────────

export type CampaignObject = {
  type?: string;
  content?: { fields?: { reward_pool?: unknown; requester?: string } } | null;
};
export type CapObject = {
  owner?: unknown;
  content?: { fields?: { campaign_id?: string } } | null;
};

/** Balance<T> renders as a bare u64 string or `{ value }` depending on RPC —
 *  read either shape. */
function poolValue(reward: unknown): bigint {
  if (reward == null) return 0n;
  if (typeof reward === 'string' || typeof reward === 'number') return BigInt(reward);
  if (typeof reward === 'object' && 'value' in (reward as Record<string, unknown>)) {
    return BigInt(String((reward as Record<string, unknown>).value));
  }
  return 0n;
}

function ownerAddress(owner: unknown): string | null {
  if (owner && typeof owner === 'object' && 'AddressOwner' in (owner as Record<string, unknown>)) {
    return String((owner as Record<string, unknown>).AddressOwner);
  }
  return null;
}

export type VerifyVerdict =
  | { ok: true; payer: string; amount: bigint }
  | { ok: false; reason: string };

/**
 * Pure verification of an escrow create: the campaign object must be a
 * Campaign<USDC> whose pool ≥ expected; the cap must be owned by the operator
 * and bound to the campaign; the tx must have succeeded.
 */
export function parseCampaignCreation(args: {
  campaignObjectId: string;
  campaign: CampaignObject | null;
  cap: CapObject | null;
  txSuccess: boolean;
  usdcCoinType: string;
  operator: string;
  expectedAmount: bigint;
}): VerifyVerdict {
  const { campaign, cap, usdcCoinType, operator, expectedAmount } = args;
  if (!args.txSuccess) return { ok: false, reason: 'tx_not_success' };
  if (!campaign?.type) return { ok: false, reason: 'campaign_not_found' };
  if (!campaign.type.includes('::campaign::Campaign<')) {
    return { ok: false, reason: 'not_a_campaign' };
  }
  if (!campaign.type.includes(usdcCoinType)) return { ok: false, reason: 'wrong_coin_type' };

  const pool = poolValue(campaign.content?.fields?.reward_pool);
  if (pool < expectedAmount) return { ok: false, reason: 'pool_too_small' };

  if (ownerAddress(cap?.owner) !== operator) return { ok: false, reason: 'cap_not_operator' };
  if (cap?.content?.fields?.campaign_id !== args.campaignObjectId) {
    return { ok: false, reason: 'cap_campaign_mismatch' };
  }

  const payer = campaign.content?.fields?.requester ?? '';
  return { ok: true, payer, amount: pool };
}

/** Fetch the create tx + campaign + cap objects and verify on-chain. */
export async function verifyCampaignCreation(args: {
  digest: string;
  campaignObjectId: string;
  capId: string;
  expectedAmount: bigint;
}): Promise<VerifyVerdict> {
  const client = getSuiClient();
  const operator = getSuiSigner().toSuiAddress();
  const [tx, campaign, cap] = await Promise.all([
    client.getTransactionBlock({ digest: args.digest, options: { showEffects: true } }),
    client.getObject({ id: args.campaignObjectId, options: { showType: true, showContent: true } }),
    client.getObject({ id: args.capId, options: { showOwner: true, showContent: true } }),
  ]);
  return parseCampaignCreation({
    campaignObjectId: args.campaignObjectId,
    campaign: (campaign.data as CampaignObject | undefined) ?? null,
    cap: (cap.data as CapObject | undefined) ?? null,
    txSuccess: tx.effects?.status?.status === 'success',
    usdcCoinType: env.SUI_USDC_COIN_TYPE,
    operator,
    expectedAmount: args.expectedAmount,
  });
}

// ─── Settle + close at scan completion ───────────────────────────────

export type SettleDeps = {
  loadEscrow: (scanId: string) => Promise<
    | {
        campaignObjectId: string | null;
        campaignCapId: string | null;
        escrowCoinType: string | null;
        escrowAmount: number | null;
        escrowStatus: string | null;
      }
    | null
  >;
  settle: (
    coinType: string,
    campaignId: string,
    capId: string,
    recipient: string,
    amount: bigint,
  ) => Promise<{ digest: string }>;
  close: (coinType: string, campaignId: string, capId: string) => Promise<{ digest: string }>;
  persist: (scanId: string, status: string) => Promise<void>;
  /** Sui addresses of this scan's survey respondents (resolvable ones only).
   *  Receive the survey-reward slice (§9 split). */
  loadRespondents: (scanId: string) => Promise<string[]>;
};

/** Escrow split (decided 2026-06-20). Platform fee + persona-time both go to
 *  the operator for now (synthetic personas are operator-owned); survey reward
 *  is split among the scan's resolvable respondents; the remainder (1 - sum)
 *  refunds to the requester on close. Basis points. */
export const SETTLE_BPS = { platform: 1000, personaTime: 3000, survey: 5000 } as const;

export function defaultSettleDeps(): SettleDeps {
  const packageId = requirePackageId();
  return {
    loadEscrow: async (scanId) => {
      const [row] = await db
        .select({
          campaignObjectId: schema.audienceFitScans.campaignObjectId,
          campaignCapId: schema.audienceFitScans.campaignCapId,
          escrowCoinType: schema.audienceFitScans.escrowCoinType,
          escrowAmount: schema.audienceFitScans.escrowAmount,
          escrowStatus: schema.audienceFitScans.escrowStatus,
        })
        .from(schema.audienceFitScans)
        .where(eq(schema.audienceFitScans.id, scanId))
        .limit(1);
      return row ?? null;
    },
    settle: (coinType, campaignId, capId, recipient, amount) =>
      executeTx(buildSettleCampaign(packageId, coinType, campaignId, capId, recipient, amount)),
    close: (coinType, campaignId, capId) =>
      executeTx(buildCloseCampaign(packageId, coinType, campaignId, capId)),
    persist: async (scanId, status) => {
      await db
        .update(schema.audienceFitScans)
        .set({ escrowStatus: status })
        .where(eq(schema.audienceFitScans.id, scanId));
    },
    loadRespondents: async (scanId) => {
      // Respondents whose Sui address we hold (users.wallet_address, 0x form).
      // Stored when a respondent submits a survey with their derived address;
      // null-address respondents simply don't receive the on-chain split (their
      // slice refunds to the requester on close).
      const rows = await db
        .select({ addr: schema.users.walletAddress })
        .from(schema.surveyResponses)
        .innerJoin(schema.users, eq(schema.users.id, schema.surveyResponses.userId))
        .where(eq(schema.surveyResponses.scanId, scanId));
      const seen = new Set<string>();
      for (const r of rows) {
        if (r.addr && /^0x[0-9a-fA-F]{64}$/.test(r.addr)) seen.add(r.addr);
      }
      return [...seen];
    },
  };
}

export type SettleResult = { status: 'skipped'; reason: string } | { status: 'closed' };

/**
 * Settle the platform fee (full escrow → operator, v1) then close the campaign
 * (refund any remainder to the requester). Operator-signed, cap-gated.
 * Idempotent: only runs when escrow_status === 'escrowed'. The platform
 * recipient is the operator; per-respondent reward splits are a follow-up
 * (same settle primitive, applied per recipient).
 */
export async function settleAndClose(
  scanId: string,
  deps: SettleDeps = defaultSettleDeps(),
  recipient: string = getSuiSigner().toSuiAddress(),
): Promise<SettleResult> {
  const e = await deps.loadEscrow(scanId);
  if (!e) return { status: 'skipped', reason: 'scan_not_found' };
  if (e.escrowStatus !== 'escrowed') return { status: 'skipped', reason: `status_${e.escrowStatus}` };
  if (!e.campaignObjectId || !e.campaignCapId || !e.escrowCoinType || e.escrowAmount == null) {
    return { status: 'skipped', reason: 'missing_campaign_fields' };
  }

  const amount = BigInt(e.escrowAmount);
  const coin = e.escrowCoinType;
  const campaign = e.campaignObjectId;
  const cap = e.campaignCapId;

  // Operator slice = platform fee + persona-time (synthetic personas are
  // operator-owned). Paid first.
  const operatorCut = (amount * BigInt(SETTLE_BPS.platform + SETTLE_BPS.personaTime)) / 10_000n;
  if (operatorCut > 0n) await deps.settle(coin, campaign, cap, recipient, operatorCut);

  // Survey slice = split evenly among resolvable respondents. Integer division
  // leaves dust + any null-address shares in the pool → refunded on close.
  const surveyTotal = (amount * BigInt(SETTLE_BPS.survey)) / 10_000n;
  const respondents = await deps.loadRespondents(scanId);
  let paidRespondents = 0;
  if (respondents.length > 0 && surveyTotal > 0n) {
    const per = surveyTotal / BigInt(respondents.length);
    if (per > 0n) {
      for (const addr of respondents) {
        await deps.settle(coin, campaign, cap, addr, per);
        paidRespondents++;
      }
    }
  }
  await deps.persist(scanId, 'settled');

  // Close refunds the remainder (the ~10% buffer + any unpaid survey slice) to
  // the requester.
  await deps.close(coin, campaign, cap);
  await deps.persist(scanId, 'closed');

  log.info(
    { scanId, campaign, operatorCut: operatorCut.toString(), paidRespondents },
    'escrow settled (split) + closed',
  );
  return { status: 'closed' };
}
