import { describe, expect, it, vi } from 'vitest';
import {
  usdcAmountFromCents,
  parseCampaignCreation,
  settleAndClose,
  type SettleDeps,
} from '../services/sui/escrow.js';

const USDC = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC';
const PKG = '0x54ba9167';
const OPERATOR = '0xoperator';
const CAMPAIGN = '0xcampaign';

describe('usdcAmountFromCents', () => {
  it('cents → 6-dp USDC base units', () => {
    expect(usdcAmountFromCents(200)).toBe(2_000_000n); // $2
    expect(usdcAmountFromCents(100)).toBe(1_000_000n); // $1
  });
});

describe('parseCampaignCreation (pure)', () => {
  const good = {
    campaignObjectId: CAMPAIGN,
    campaign: {
      type: `${PKG}::campaign::Campaign<${USDC}>`,
      content: { fields: { reward_pool: '2000000', requester: '0xpayer' } },
    },
    cap: { owner: { AddressOwner: OPERATOR }, content: { fields: { campaign_id: CAMPAIGN } } },
    txSuccess: true,
    usdcCoinType: USDC,
    operator: OPERATOR,
    expectedAmount: 2_000_000n,
  };

  it('accepts a well-formed USDC escrow', () => {
    const v = parseCampaignCreation(good);
    expect(v).toEqual({ ok: true, payer: '0xpayer', amount: 2_000_000n });
  });

  it('reads Balance rendered as { value }', () => {
    const v = parseCampaignCreation({
      ...good,
      campaign: {
        ...good.campaign,
        content: { fields: { reward_pool: { value: '2000000' }, requester: '0xp' } },
      },
    });
    expect(v.ok).toBe(true);
  });

  it('rejects: failed tx / wrong coin / short pool / cap not operator / mismatch', () => {
    expect(parseCampaignCreation({ ...good, txSuccess: false })).toMatchObject({
      ok: false,
      reason: 'tx_not_success',
    });
    expect(
      parseCampaignCreation({
        ...good,
        campaign: { ...good.campaign, type: `${PKG}::campaign::Campaign<0x2::sui::SUI>` },
      }),
    ).toMatchObject({ ok: false, reason: 'wrong_coin_type' });
    expect(parseCampaignCreation({ ...good, expectedAmount: 9_000_000n })).toMatchObject({
      ok: false,
      reason: 'pool_too_small',
    });
    expect(
      parseCampaignCreation({
        ...good,
        cap: { owner: { AddressOwner: '0xstranger' }, content: { fields: { campaign_id: CAMPAIGN } } },
      }),
    ).toMatchObject({ ok: false, reason: 'cap_not_operator' });
    expect(
      parseCampaignCreation({
        ...good,
        cap: { owner: { AddressOwner: OPERATOR }, content: { fields: { campaign_id: '0xother' } } },
      }),
    ).toMatchObject({ ok: false, reason: 'cap_campaign_mismatch' });
  });
});

function makeSettleDeps(over: Partial<SettleDeps> = {}): SettleDeps {
  return {
    loadEscrow: vi.fn(async () => ({
      campaignObjectId: CAMPAIGN,
      campaignCapId: '0xcap',
      escrowCoinType: USDC,
      escrowAmount: 2_000_000,
      escrowStatus: 'escrowed',
    })),
    settle: vi.fn(async () => ({ digest: 'sdig' })),
    close: vi.fn(async () => ({ digest: 'cdig' })),
    persist: vi.fn(async () => {}),
    loadRespondents: vi.fn(async () => []),
    ...over,
  };
}

describe('settleAndClose', () => {
  it('settles then closes, persisting settled→closed', async () => {
    const calls: string[] = [];
    const deps = makeSettleDeps({
      settle: vi.fn(async () => {
        calls.push('settle');
        return { digest: 's' };
      }),
      persist: vi.fn(async (_id, status) => {
        calls.push(`persist:${status}`);
      }),
      close: vi.fn(async () => {
        calls.push('close');
        return { digest: 'c' };
      }),
    });
    const r = await settleAndClose('scan1', deps, OPERATOR);
    expect(r).toEqual({ status: 'closed' });
    expect(calls).toEqual(['settle', 'persist:settled', 'close', 'persist:closed']);
    // No respondents → only the operator 40% (platform 10% + persona-time 30%)
    // is settled; the 50% survey + 10% buffer refund to the requester on close.
    expect(deps.settle).toHaveBeenCalledWith(USDC, CAMPAIGN, '0xcap', OPERATOR, 800_000n);
  });

  it('splits the survey 50% evenly across resolvable respondents', async () => {
    const settled: Array<{ to: string; amt: bigint }> = [];
    const deps = makeSettleDeps({
      settle: vi.fn(async (_c, _id, _cap, to, amt) => {
        settled.push({ to, amt });
        return { digest: 's' };
      }),
      loadRespondents: vi.fn(async () => ['0xA', '0xB']),
    });
    await settleAndClose('scan1', deps, OPERATOR);
    // operator 40% = 800k, then survey 50% = 1,000k split 2 ways = 500k each.
    expect(settled).toEqual([
      { to: OPERATOR, amt: 800_000n },
      { to: '0xA', amt: 500_000n },
      { to: '0xB', amt: 500_000n },
    ]);
  });

  it('skips when not escrowed (idempotent) — no chain calls', async () => {
    const deps = makeSettleDeps({
      loadEscrow: vi.fn(async () => ({
        campaignObjectId: CAMPAIGN,
        campaignCapId: '0xcap',
        escrowCoinType: USDC,
        escrowAmount: 2_000_000,
        escrowStatus: 'closed',
      })),
    });
    const r = await settleAndClose('scan1', deps, OPERATOR);
    expect(r).toEqual({ status: 'skipped', reason: 'status_closed' });
    expect(deps.settle).not.toHaveBeenCalled();
    expect(deps.close).not.toHaveBeenCalled();
  });

  it('skips when the scan is missing', async () => {
    const deps = makeSettleDeps({ loadEscrow: vi.fn(async () => null) });
    const r = await settleAndClose('missing', deps, OPERATOR);
    expect(r).toEqual({ status: 'skipped', reason: 'scan_not_found' });
  });
});
