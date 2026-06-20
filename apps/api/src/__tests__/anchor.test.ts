import { describe, expect, it, vi } from 'vitest';
import {
  extractCreatedObjectId,
  suiObjectUrl,
  anchorPersona,
  anchorScanReport,
  transferPersonaToUser,
  isSuiAddress,
  sha256Hex,
  commitPersonaContentHash,
  buildContentManifest,
  type AnchorDeps,
  type ScanAnchorDeps,
  type TransferDeps,
  type ContentHashDeps,
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
      reportContentHash: sha256Hex(JSON.stringify({ scan_id: 's1' })),
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

const RECIPIENT = '0x' + 'a'.repeat(64);

describe('isSuiAddress', () => {
  it('accepts 0x + 64 hex, rejects everything else', () => {
    expect(isSuiAddress(RECIPIENT)).toBe(true);
    expect(isSuiAddress('0xabc')).toBe(false); // too short
    expect(isSuiAddress('a'.repeat(66))).toBe(false); // no 0x
    expect(isSuiAddress('0x' + 'g'.repeat(64))).toBe(false); // non-hex
  });
});

function makeTransferDeps(over: Partial<TransferDeps> = {}): TransferDeps {
  return {
    loadPersona: vi.fn(async () => ({ suiObjectId: '0xOBJ', transferredTo: null })),
    transfer: vi.fn(async () => ({ digest: 'tdig' })),
    persist: vi.fn(async () => {}),
    ...over,
  };
}

describe('transferPersonaToUser (mint-to-user §4.1)', () => {
  it('transfers an anchored persona + persists the recipient', async () => {
    const deps = makeTransferDeps();
    const now = new Date('2026-06-20T00:00:00.000Z');
    const r = await transferPersonaToUser('p1', RECIPIENT, deps, now);
    expect(r).toEqual({
      status: 'transferred',
      suiObjectId: '0xOBJ',
      recipient: RECIPIENT,
      digest: 'tdig',
    });
    expect(deps.transfer).toHaveBeenCalledWith('0xOBJ', RECIPIENT);
    expect(deps.persist).toHaveBeenCalledWith('p1', {
      transferredTo: RECIPIENT,
      transferredAt: now,
    });
  });

  it('skips an invalid recipient before any load/chain call', async () => {
    const deps = makeTransferDeps();
    const r = await transferPersonaToUser('p1', '0xbad', deps);
    expect(r).toEqual({ status: 'skipped', reason: 'invalid_recipient' });
    expect(deps.loadPersona).not.toHaveBeenCalled();
    expect(deps.transfer).not.toHaveBeenCalled();
  });

  it('skips an unanchored persona (no on-chain object to transfer)', async () => {
    const deps = makeTransferDeps({
      loadPersona: vi.fn(async () => ({ suiObjectId: null, transferredTo: null })),
    });
    const r = await transferPersonaToUser('p1', RECIPIENT, deps);
    expect(r).toEqual({ status: 'skipped', reason: 'not_anchored' });
    expect(deps.transfer).not.toHaveBeenCalled();
  });

  it('is idempotent — skips when already transferred to the same recipient', async () => {
    const deps = makeTransferDeps({
      loadPersona: vi.fn(async () => ({ suiObjectId: '0xOBJ', transferredTo: RECIPIENT })),
    });
    const r = await transferPersonaToUser('p1', RECIPIENT, deps);
    expect(r).toEqual({ status: 'skipped', reason: 'already_transferred' });
    expect(deps.transfer).not.toHaveBeenCalled();
    expect(deps.persist).not.toHaveBeenCalled();
  });

  it('errors on a conflicting re-target (object no longer operator-owned)', async () => {
    const other = '0x' + 'b'.repeat(64);
    const deps = makeTransferDeps({
      loadPersona: vi.fn(async () => ({ suiObjectId: '0xOBJ', transferredTo: other })),
    });
    await expect(transferPersonaToUser('p1', RECIPIENT, deps)).rejects.toThrow(
      'already transferred',
    );
    expect(deps.transfer).not.toHaveBeenCalled();
  });

  it('throws when the persona does not exist', async () => {
    const deps = makeTransferDeps({ loadPersona: vi.fn(async () => null) });
    await expect(transferPersonaToUser('missing', RECIPIENT, deps)).rejects.toThrow('not found');
  });
});

describe('sha256Hex + buildContentManifest (pure)', () => {
  it('hashes deterministically + emits a self-describing manifest', () => {
    const h = sha256Hex('{"a":1}');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    const m = buildContentManifest({
      kind: 'persona_vector',
      id: 'p1',
      contentHash: h,
      now: new Date('2026-06-20T00:00:00.000Z'),
    });
    expect(m).toEqual({
      v: 1,
      kind: 'persona_vector',
      id: 'p1',
      content_sha256: h,
      algo: 'sha256',
      committed_at: '2026-06-20T00:00:00.000Z',
    });
  });
});

function makeHashDeps(over: Partial<ContentHashDeps> = {}): ContentHashDeps {
  return {
    load: vi.fn(async () => ({ suiObjectId: '0xOBJ', vector: { voice: 'hi' }, contentHash: null })),
    storePublic: vi.fn(async () => ({ blobId: 'manifestBlob' })),
    addMemwalRef: vi.fn(async () => ({ digest: 'd' })),
    persist: vi.fn(async () => {}),
    ...over,
  };
}

describe('commitPersonaContentHash (Method B)', () => {
  it('hashes plaintext → public manifest → add_memwal_ref → persists', async () => {
    const deps = makeHashDeps();
    const r = await commitPersonaContentHash('p1', deps);
    const expectedHash = sha256Hex(JSON.stringify({ voice: 'hi' }));
    expect(r).toEqual({ status: 'committed', contentHash: expectedHash, manifestBlobId: 'manifestBlob' });
    // the PUBLIC manifest carries the hash (not the sealed vector)
    const stored = (deps.storePublic as ReturnType<typeof vi.fn>).mock.calls[0][0] as Uint8Array;
    expect(JSON.parse(new TextDecoder().decode(stored)).content_sha256).toBe(expectedHash);
    expect(deps.addMemwalRef).toHaveBeenCalledWith('0xOBJ', 'manifestBlob');
    expect(deps.persist).toHaveBeenCalledWith('p1', {
      contentHash: expectedHash,
      contentManifestBlobId: 'manifestBlob',
    });
  });

  it('skips an unanchored persona (no object to ref)', async () => {
    const deps = makeHashDeps({
      load: vi.fn(async () => ({ suiObjectId: null, vector: {}, contentHash: null })),
    });
    const r = await commitPersonaContentHash('p1', deps);
    expect(r).toEqual({ status: 'skipped', reason: 'not_anchored' });
    expect(deps.storePublic).not.toHaveBeenCalled();
    expect(deps.addMemwalRef).not.toHaveBeenCalled();
  });

  it('is idempotent — skips when the hash is already committed', async () => {
    const deps = makeHashDeps({
      load: vi.fn(async () => ({ suiObjectId: '0xOBJ', vector: {}, contentHash: 'abc' })),
    });
    const r = await commitPersonaContentHash('p1', deps);
    expect(r).toEqual({ status: 'skipped', reason: 'already_committed' });
    expect(deps.addMemwalRef).not.toHaveBeenCalled();
  });

  it('throws when the persona does not exist', async () => {
    const deps = makeHashDeps({ load: vi.fn(async () => null) });
    await expect(commitPersonaContentHash('missing', deps)).rejects.toThrow('not found');
  });
});
