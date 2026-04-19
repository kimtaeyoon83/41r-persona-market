import { describe, it, expect, beforeEach } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import {
  issueNonce,
  consumeNonce,
  verifyWalletSignature,
  __resetNoncesForTest,
} from '../middleware/auth.js';

function genKeypair() {
  const kp = nacl.sign.keyPair();
  const wallet = new PublicKey(kp.publicKey).toBase58();
  return { kp, wallet };
}

function sign(privateKey: Uint8Array, message: string): string {
  const sig = nacl.sign.detached(new TextEncoder().encode(message), privateKey);
  return bs58.encode(sig);
}

describe('nonce store', () => {
  beforeEach(() => __resetNoncesForTest());

  it('issues and consumes a nonce one-shot', () => {
    const { wallet } = genKeypair();
    const { nonce } = issueNonce(wallet);
    expect(consumeNonce(nonce, wallet)).toBe(true);
    // Second consume must fail (replay protection)
    expect(consumeNonce(nonce, wallet)).toBe(false);
  });

  it('rejects nonce used with a different wallet', () => {
    const a = genKeypair();
    const b = genKeypair();
    const { nonce } = issueNonce(a.wallet);
    expect(consumeNonce(nonce, b.wallet)).toBe(false);
    // The still-valid nonce for wallet A should still work after a mismatch attempt
    expect(consumeNonce(nonce, a.wallet)).toBe(true);
  });

  it('rejects an unknown nonce', () => {
    const { wallet } = genKeypair();
    expect(consumeNonce('nonexistent', wallet)).toBe(false);
  });
});

describe('verifyWalletSignature', () => {
  it('verifies a valid ed25519 signature', () => {
    const { kp, wallet } = genKeypair();
    const msg = 'auth_prefix_1234567_abcd';
    const sig = sign(kp.secretKey, msg);
    expect(verifyWalletSignature(wallet, msg, sig)).toBe(true);
  });

  it('rejects a signature from a different key', () => {
    const a = genKeypair();
    const b = genKeypair();
    const msg = 'auth_mismatch';
    const sig = sign(b.kp.secretKey, msg);
    expect(verifyWalletSignature(a.wallet, msg, sig)).toBe(false);
  });

  it('rejects a signature for a different message', () => {
    const { kp, wallet } = genKeypair();
    const sig = sign(kp.secretKey, 'message A');
    expect(verifyWalletSignature(wallet, 'message B', sig)).toBe(false);
  });

  it('gracefully rejects malformed inputs', () => {
    expect(verifyWalletSignature('not-a-wallet', 'm', 'not-sig')).toBe(false);
    expect(verifyWalletSignature('', '', '')).toBe(false);
  });
});
