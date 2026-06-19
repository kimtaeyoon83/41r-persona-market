import { describe, expect, it, vi } from 'vitest';
import { encryptAndStore, parseSealConfig } from '../services/seal.js';

describe('parseSealConfig', () => {
  it('splits a CSV committee into weighted server configs', () => {
    const cfg = parseSealConfig('0xaaa, 0xbbb ,0xccc', 2);
    expect(cfg.threshold).toBe(2);
    expect(cfg.serverConfigs).toEqual([
      { objectId: '0xaaa', weight: 1 },
      { objectId: '0xbbb', weight: 1 },
      { objectId: '0xccc', weight: 1 },
    ]);
  });

  it('yields an empty committee when unset (caller must guard)', () => {
    expect(parseSealConfig(undefined, 1).serverConfigs).toEqual([]);
    expect(parseSealConfig('', 1).serverConfigs).toEqual([]);
  });
});

describe('encryptAndStore', () => {
  it('encrypts BEFORE storing and only the ciphertext reaches put', async () => {
    const plaintext = new Uint8Array([1, 2, 3]);
    const ciphertext = new Uint8Array([9, 9, 9]);
    const encrypt = vi.fn().mockResolvedValue(ciphertext);
    const put = vi.fn().mockResolvedValue({ blobId: 'b1' });

    const out = await encryptAndStore({ encrypt, put }, plaintext);

    expect(out.blobId).toBe('b1');
    // Plaintext goes to encrypt; ciphertext (never plaintext) goes to put.
    expect(encrypt).toHaveBeenCalledWith(plaintext);
    expect(put).toHaveBeenCalledWith(ciphertext);
    // Ordering: encrypt resolves before put is invoked.
    expect(encrypt.mock.invocationCallOrder[0]).toBeLessThan(
      put.mock.invocationCallOrder[0],
    );
  });
});
