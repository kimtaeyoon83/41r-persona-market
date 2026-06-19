import { describe, expect, it, vi } from 'vitest';
import {
  extractCreatedObjectId,
  suiObjectUrl,
  anchorPersona,
  anchorScanReport,
  type AnchorDeps,
  type ScanAnchorDeps,
} from '../services/sui/anchor.js';

describe('extractCreatedObjectId (pure)', () => {
  it('prefers the created change matching the type needle', () => {
    const changes = [
      { type: 'created', objectType: '0x2::coin::Coin<0x2::sui::SUI>', objectId: '0xgas' },
      { type: 'created', objectType: '0xpkg::persona::Persona', objectId: '0xpersona' },
    ];
    expect(extractCreatedObjectId(changes, '::persona::Persona')).toBe('0xpersona');
  });

  it('falls back to the first created change without a needle', () => {
    const changes = [
      { type: 'mutated', objectId: '0xclock' },
      { type: 'created', objectId: '0xfirst' },
    ];
    expect(extractCreatedObjectId(changes)).toBe('0xfirst');
  });

  it('returns null when nothing was created', () => {
    expect(extractCreatedObjectId([{ type: 'mutated', objectId: '0x1' }])).toBeNull();
    expect(extractCreatedObjectId(null)).toBeNull();
  });
});

describe('suiObjectUrl', () => {
  it('builds the testnet explorer link', () => {
    expect(suiObjectUrl('0xabc')).toBe('https://suiscan.xyz/testnet/object/0xabc');
  });
});

function makeDeps(over: Partial<AnchorDeps> = {}): AnchorDeps {
  return {
    loadPersona: vi.fn(async () => ({ suiObjectId: null, vector: { voice_sample: 'hi' } })),
    encryptStore: vi.fn(async () => ({ blobId: 'blob1' })),
    mint: vi.fn(async () => ({ digest: 'dig1', createdObjectId: '0xobj1' })),
    addMemwalRef: vi.fn(async () => ({ digest: 'dig2' })),
    persist: vi.fn(async () => {}),
    ...over,
  };
}

describe('anchorPersona', () => {
  it('runs store→mint→addRef→persist in order and returns the ids', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      encryptStore: vi.fn(async () => {
        calls.push('store');
        return { blobId: 'blobX' };
      }),
      mint: vi.fn(async () => {
        calls.push('mint');
        return { digest: 'd', createdObjectId: '0xMINT' };
      }),
      addMemwalRef: vi.fn(async (objId, blobId) => {
        calls.push(`ref:${objId}:${blobId}`);
        return { digest: 'd2' };
      }),
      persist: vi.fn(async () => {
        calls.push('persist');
      }),
    });

    const now = new Date('2026-06-19T00:00:00.000Z');
    const r = await anchorPersona('p1', deps, now);

    expect(calls).toEqual(['store', 'mint', 'ref:0xMINT:blobX', 'persist']);
    expect(r).toEqual({
      status: 'anchored',
      suiObjectId: '0xMINT',
      walrusBlobId: 'blobX',
      digest: 'd2',
    });
    expect(deps.persist).toHaveBeenCalledWith('p1', {
      suiObjectId: '0xMINT',
      walrusBlobId: 'blobX',
      sealId: '7031', // hex of 'p1' — seal id must be a hex namespace
      anchoredAt: now,
    });
    // the seal/walrus store is keyed by the hex id, not the raw persona id
    expect(deps.encryptStore).toHaveBeenCalledWith({ id: '7031', data: expect.any(Uint8Array) });
  });

  it('is idempotent — skips when already anchored, runs no chain calls', async () => {
    const deps = makeDeps({
      loadPersona: vi.fn(async () => ({ suiObjectId: '0xEXISTING', vector: {} })),
    });
    const r = await anchorPersona('p1', deps);
    expect(r).toEqual({ status: 'skipped', suiObjectId: '0xEXISTING' });
    expect(deps.encryptStore).not.toHaveBeenCalled();
    expect(deps.mint).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('throws when the persona does not exist', async () => {
    const deps = makeDeps({ loadPersona: vi.fn(async () => null) });
    await expect(anchorPersona('missing', deps)).rejects.toThrow('not found');
  });

  it('throws when mint returns no created object id', async () => {
    const deps = makeDeps({ mint: vi.fn(async () => ({ digest: 'd', createdObjectId: null })) });
    await expect(anchorPersona('p1', deps)).rejects.toThrow('no created object id');
  });
});

function makeScanDeps(over: Partial<ScanAnchorDeps> = {}): ScanAnchorDeps {
  return {
    loadScan: vi.fn(async () => ({ reportWalrusBlobId: null, payload: { scan_id: 's1' } })),
    encryptStore: vi.fn(async () => ({ blobId: 'rblob' })),
    persist: vi.fn(async () => {}),
    ...over,
  };
}

describe('anchorScanReport (Walrus+Seal, no mint)', () => {
  it('seal-encrypts the report → walrus → persists, keyed by hex scan id', async () => {
    const deps = makeScanDeps();
    const now = new Date('2026-06-19T00:00:00.000Z');
    const r = await anchorScanReport('s1', deps, now);
    expect(r).toEqual({ status: 'anchored', walrusBlobId: 'rblob' });
    expect(deps.encryptStore).toHaveBeenCalledWith({
      id: '7331', // hex of 's1'
      data: expect.any(Uint8Array),
    });
    expect(deps.persist).toHaveBeenCalledWith('s1', {
      reportWalrusBlobId: 'rblob',
      reportSealId: '7331',
      reportAnchoredAt: now,
    });
  });

  it('is idempotent — skips when already anchored', async () => {
    const deps = makeScanDeps({
      loadScan: vi.fn(async () => ({ reportWalrusBlobId: 'existing', payload: {} })),
    });
    const r = await anchorScanReport('s1', deps);
    expect(r).toEqual({ status: 'skipped', walrusBlobId: 'existing' });
    expect(deps.encryptStore).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('throws when the scan does not exist', async () => {
    const deps = makeScanDeps({ loadScan: vi.fn(async () => null) });
    await expect(anchorScanReport('missing', deps)).rejects.toThrow('not found');
  });
});
