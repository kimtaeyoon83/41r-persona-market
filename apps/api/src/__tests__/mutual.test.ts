import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  nextState,
  sha256Hex,
  extractMutualIds,
  createMutualCampaign,
  advanceMutual,
  ACTION_ACTOR,
  MutualStateError,
  MutualNotFound,
  MUTUAL_STATES,
  type MutualState,
  type MutualRow,
  type CreateDeps,
  type AdvanceDeps,
} from '../services/sui/mutual.js';
import { env } from '../config/env.js';

// ─── Pure state machine (mirror mutual.move §4.5.2) ──────────────────

describe('nextState (pure)', () => {
  it('walks the full happy path', () => {
    let s: MutualState = 'asset_sealed';
    s = nextState(s, 'opt_in');
    expect(s).toBe('persona_opted_in');
    s = nextState(s, 'reveal_asset');
    expect(s).toBe('asset_revealed');
    s = nextState(s, 'commit_evidence');
    expect(s).toBe('evidence_committed');
    s = nextState(s, 'reveal_evidence');
    expect(s).toBe('evidence_revealed');
    s = nextState(s, 'settle');
    expect(s).toBe('settled');
  });

  it('slash is reachable from every post-opt-in, pre-settle state', () => {
    for (const from of ['persona_opted_in', 'asset_revealed', 'evidence_committed'] as const) {
      expect(nextState(from, 'slash')).toBe('aborted');
    }
  });

  it('slash is NOT reachable from asset_sealed / evidence_revealed / settled', () => {
    for (const from of ['asset_sealed', 'evidence_revealed', 'settled'] as const) {
      expect(() => nextState(from, 'slash')).toThrow(MutualStateError);
    }
  });

  it('rejects out-of-order edges', () => {
    expect(() => nextState('asset_sealed', 'settle')).toThrow(MutualStateError);
    expect(() => nextState('asset_sealed', 'reveal_asset')).toThrow(MutualStateError);
    expect(() => nextState('settled', 'opt_in')).toThrow(MutualStateError);
    expect(() => nextState('aborted', 'opt_in')).toThrow(MutualStateError);
  });

  it('terminal states have no outgoing edges', () => {
    for (const action of ['opt_in', 'reveal_asset', 'settle', 'slash'] as const) {
      expect(() => nextState('settled', action)).toThrow();
      expect(() => nextState('aborted', action)).toThrow();
    }
  });

  it('every declared state is part of the type list', () => {
    expect(MUTUAL_STATES).toContain('settled');
    expect(MUTUAL_STATES).toContain('aborted');
  });
});

describe('ACTION_ACTOR', () => {
  it('persona acts pre-evidence, requester finalizes', () => {
    expect(ACTION_ACTOR.opt_in).toBe('persona');
    expect(ACTION_ACTOR.reveal_asset).toBe('persona');
    expect(ACTION_ACTOR.commit_evidence).toBe('persona');
    expect(ACTION_ACTOR.reveal_evidence).toBe('requester');
    expect(ACTION_ACTOR.settle).toBe('requester');
    expect(ACTION_ACTOR.slash).toBe('requester');
  });
});

describe('sha256Hex', () => {
  it('is stable + hex', () => {
    const h = sha256Hex(new TextEncoder().encode('hello'));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(new TextEncoder().encode('hello'))).toBe(h);
  });
});

// ─── createMutualCampaign (injected deps) ────────────────────────────

function makeCreateDeps(over: Partial<CreateDeps> = {}): CreateDeps {
  return {
    seal: vi.fn(async (id: string) => ({ blobId: `blob:${id}`, sealId: `seal:${id}` })),
    mintOnChain: vi.fn(async () => ({ suiObjectId: '0xMUTUAL', suiCapId: '0xCAP' })),
    insert: vi.fn(
      async (row) =>
        ({
          ...(row as Record<string, unknown>),
          personaUserId: row.personaUserId ?? null,
          description: row.description ?? null,
          assetBlobId: row.assetBlobId ?? null,
          assetSealId: row.assetSealId ?? null,
          evidenceHash: null,
          evidenceBlobId: null,
          evidenceSealId: null,
          suiObjectId: row.suiObjectId ?? null,
          suiCapId: row.suiCapId ?? null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          settledAt: null,
        }) as unknown as MutualRow,
    ),
    ...over,
  };
}

describe('createMutualCampaign', () => {
  it('hashes + seals the asset, persists state asset_sealed', async () => {
    const deps = makeCreateDeps();
    const asset = new TextEncoder().encode('pre-release-figma-link');
    const row = await createMutualCampaign(
      {
        requesterUserId: 'u-company',
        title: 'Seal my unreleased flow',
        description: 'NDA build',
        asset,
        sandboxOnly: true,
        rewardAmount: 5_000n,
        stakeAmount: 1_000n,
      },
      deps,
    );
    expect(row.state).toBe('asset_sealed');
    expect(row.assetHash).toBe(sha256Hex(asset));
    expect(row.assetBlobId).toMatch(/^blob:/);
    expect(row.requesterUserId).toBe('u-company');
    expect(row.rewardAmount).toBe(5_000n);
    expect(deps.seal).toHaveBeenCalledOnce();
  });

  it('records an unsealed reference when Seal is unconfigured (blob null)', async () => {
    const deps = makeCreateDeps({ seal: vi.fn(async () => null) });
    const row = await createMutualCampaign(
      {
        requesterUserId: 'u',
        title: 't',
        asset: new TextEncoder().encode('x'),
        sandboxOnly: false,
        rewardAmount: 0n,
        stakeAmount: 0n,
      },
      deps,
    );
    expect(row.assetBlobId).toBeNull();
    expect(row.assetHash).toMatch(/^[0-9a-f]{64}$/); // hash still computed
  });

  it('does NOT mint on-chain when MUTUAL_ONCHAIN_ENABLED is off (default)', async () => {
    const deps = makeCreateDeps();
    const row = await createMutualCampaign(
      {
        requesterUserId: 'u',
        title: 't',
        asset: new TextEncoder().encode('x'),
        sandboxOnly: true,
        rewardAmount: 100n,
        stakeAmount: 0n,
      },
      deps,
    );
    expect(deps.mintOnChain).not.toHaveBeenCalled();
    expect(row.suiObjectId).toBeNull();
    expect(row.suiCapId).toBeNull();
  });
});

describe('createMutualCampaign — on-chain mint gate', () => {
  afterEach(() => {
    (env as { MUTUAL_ONCHAIN_ENABLED: boolean }).MUTUAL_ONCHAIN_ENABLED = false;
  });

  it('mints + persists sui ids when the flag is on', async () => {
    (env as { MUTUAL_ONCHAIN_ENABLED: boolean }).MUTUAL_ONCHAIN_ENABLED = true;
    const deps = makeCreateDeps();
    const row = await createMutualCampaign(
      {
        requesterUserId: 'u',
        title: 't',
        asset: new TextEncoder().encode('x'),
        sandboxOnly: true,
        rewardAmount: 1_000n,
        stakeAmount: 0n,
      },
      deps,
    );
    expect(deps.mintOnChain).toHaveBeenCalledOnce();
    expect(row.suiObjectId).toBe('0xMUTUAL');
    expect(row.suiCapId).toBe('0xCAP');
  });

  it('is non-fatal — a mint failure still persists the off-chain seal', async () => {
    (env as { MUTUAL_ONCHAIN_ENABLED: boolean }).MUTUAL_ONCHAIN_ENABLED = true;
    const deps = makeCreateDeps({
      mintOnChain: vi.fn(async () => {
        throw new Error('rpc down');
      }),
    });
    const row = await createMutualCampaign(
      {
        requesterUserId: 'u',
        title: 't',
        asset: new TextEncoder().encode('x'),
        sandboxOnly: true,
        rewardAmount: 1_000n,
        stakeAmount: 0n,
      },
      deps,
    );
    expect(row.state).toBe('asset_sealed'); // seal succeeded
    expect(row.suiObjectId).toBeNull(); // mint failed → null, not thrown
  });
});

describe('extractMutualIds (pure)', () => {
  it('pulls the MutualCampaign + MutualOwnerCap ids out of objectChanges', () => {
    const changes = [
      { type: 'created', objectType: '0x2::coin::Coin<0x2::sui::SUI>', objectId: '0xgas' },
      { type: 'created', objectType: '0xpkg::mutual::MutualCampaign', objectId: '0xmc' },
      { type: 'created', objectType: '0xpkg::mutual::MutualOwnerCap', objectId: '0xcap' },
    ];
    expect(extractMutualIds(changes)).toEqual({ suiObjectId: '0xmc', suiCapId: '0xcap' });
  });

  it('returns null when no MutualCampaign was created', () => {
    expect(extractMutualIds([{ type: 'created', objectType: '0x2::coin::Coin', objectId: '0x1' }])).toBeNull();
    expect(extractMutualIds(null)).toBeNull();
  });

  it('campaign with no cap → suiCapId null (still returns the object)', () => {
    const changes = [{ type: 'created', objectType: '0xp::mutual::MutualCampaign', objectId: '0xmc' }];
    expect(extractMutualIds(changes)).toEqual({ suiObjectId: '0xmc', suiCapId: null });
  });
});

// ─── advanceMutual (in-memory store) ─────────────────────────────────

function makeStore(initial: Partial<MutualRow>): { deps: AdvanceDeps; row: () => MutualRow } {
  let row = {
    id: 'm1',
    requesterUserId: 'u-company',
    personaUserId: null,
    title: 't',
    description: null,
    assetHash: 'h',
    assetBlobId: 'blob',
    assetSealId: 'seal',
    assetSandboxOnly: true,
    evidenceHash: null,
    evidenceBlobId: null,
    evidenceSealId: null,
    rewardAmount: 0n,
    stakeAmount: 0n,
    state: 'asset_sealed',
    suiObjectId: null,
    suiCapId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    settledAt: null,
    ...initial,
  } as MutualRow;
  const deps: AdvanceDeps = {
    load: vi.fn(async () => row),
    seal: vi.fn(async (id: string) => ({ blobId: `eblob:${id}`, sealId: `eseal:${id}` })),
    persist: vi.fn(async (_id, patch) => {
      row = { ...row, ...(patch as Partial<MutualRow>) };
      return row;
    }),
  };
  return { deps, row: () => row };
}

describe('advanceMutual', () => {
  it('opt_in binds the persona', async () => {
    const { deps } = makeStore({});
    const r = await advanceMutual('m1', 'opt_in', { personaUserId: 'u-persona' }, deps);
    expect(r.state).toBe('persona_opted_in');
    expect(r.personaUserId).toBe('u-persona');
  });

  it('commit_evidence seals the evidence blob + stores its hash', async () => {
    const { deps } = makeStore({ state: 'asset_revealed', personaUserId: 'u-persona' });
    const evidence = new TextEncoder().encode('session-trace');
    const r = await advanceMutual('m1', 'commit_evidence', { evidence }, deps);
    expect(r.state).toBe('evidence_committed');
    expect(r.evidenceHash).toBe(sha256Hex(evidence));
    expect(r.evidenceBlobId).toMatch(/^eblob:/);
    expect(deps.seal).toHaveBeenCalledOnce();
  });

  it('settle stamps settled_at', async () => {
    const { deps } = makeStore({ state: 'evidence_revealed', personaUserId: 'u-persona' });
    const r = await advanceMutual('m1', 'settle', {}, deps);
    expect(r.state).toBe('settled');
    expect(r.settledAt).toBeInstanceOf(Date);
  });

  it('rejects an out-of-order transition with MutualStateError', async () => {
    const { deps } = makeStore({ state: 'asset_sealed' });
    await expect(advanceMutual('m1', 'settle', {}, deps)).rejects.toBeInstanceOf(MutualStateError);
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('throws MutualNotFound when the row is missing', async () => {
    const deps = makeStore({}).deps;
    (deps.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(
      advanceMutual('gone', 'opt_in', { personaUserId: 'x' }, deps),
    ).rejects.toBeInstanceOf(MutualNotFound);
  });

  it('opt_in without personaUserId is a programmer error', async () => {
    const { deps } = makeStore({});
    await expect(advanceMutual('m1', 'opt_in', {}, deps)).rejects.toThrow(/personaUserId/);
  });
});
