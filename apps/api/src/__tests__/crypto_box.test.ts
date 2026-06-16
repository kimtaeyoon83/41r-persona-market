// crypto_box (auth-session encryption) contract.
// Locks the AES-256-GCM roundtrip + tamper/format safety so a stored
// partner session can be decrypted back exactly and a corrupt blob
// degrades to null instead of throwing into a capture run.

import { describe, expect, it } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  isEncryptionAvailable,
} from '../services/crypto_box';

describe('crypto_box', () => {
  it('reports availability when SESSION_ENC_KEY is set (test setup)', () => {
    expect(isEncryptionAvailable()).toBe(true);
  });

  it('roundtrips a storageState JSON exactly', () => {
    const plain = JSON.stringify({
      cookies: [{ name: 's', value: 'abc', domain: '.x.com' }],
      origins: [],
    });
    const enc = encryptSecret(plain);
    expect(enc).not.toContain('abc'); // ciphertext, not plaintext
    expect(enc.split('.')).toHaveLength(3); // iv.tag.cipher
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('produces a fresh IV each call (ciphertext differs, plaintext same)', () => {
    const a = encryptSecret('same');
    const b = encryptSecret('same');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same');
    expect(decryptSecret(b)).toBe('same');
  });

  it('returns null on tampered ciphertext (GCM auth tag fails)', () => {
    const enc = encryptSecret('secret');
    const [iv, tag, data] = enc.split('.');
    // Flip a byte in the ciphertext segment.
    const flipped = `${iv}.${tag}.${Buffer.from('zzzz').toString('base64')}${data}`;
    expect(decryptSecret(flipped)).toBeNull();
  });

  it('returns null on malformed payloads', () => {
    expect(decryptSecret('not-a-valid-box')).toBeNull();
    expect(decryptSecret('a.b')).toBeNull();
    expect(decryptSecret('')).toBeNull();
  });
});
