import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBlob,
  parseWalrusPutResponse,
  putBlob,
} from '../services/walrus.js';

describe('parseWalrusPutResponse', () => {
  it('reads blobId from a newlyCreated envelope', () => {
    expect(
      parseWalrusPutResponse({ newlyCreated: { blobObject: { blobId: 'abc' } } }),
    ).toEqual({ blobId: 'abc', alreadyCertified: false });
  });

  it('reads blobId from an alreadyCertified envelope', () => {
    expect(parseWalrusPutResponse({ alreadyCertified: { blobId: 'xyz' } })).toEqual({
      blobId: 'xyz',
      alreadyCertified: true,
    });
  });

  it('throws when no blobId is present', () => {
    expect(() => parseWalrusPutResponse({})).toThrow('no blobId');
  });
});

describe('putBlob / getBlob', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('PUTs to the publisher and returns the blobId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ newlyCreated: { blobObject: { blobId: 'b1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const r = await putBlob(new Uint8Array([1, 2, 3]), { epochs: 5 });
    expect(r.blobId).toBe('b1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/blobs?epochs=5');
    expect(init.method).toBe('PUT');
  });

  it('GETs raw bytes from the aggregator', async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => bytes.buffer }),
    );
    const out = await getBlob('b1');
    expect(Array.from(out)).toEqual([9, 8, 7]);
  });

  it('throws on a non-ok publisher response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'err' }),
    );
    await expect(putBlob(new Uint8Array([1]))).rejects.toThrow('walrus put failed');
  });
});
