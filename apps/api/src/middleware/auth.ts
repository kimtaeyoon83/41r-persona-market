import type { RequestHandler } from 'express';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';

const NONCE_TTL_MS = 5 * 60 * 1000;

type NonceEntry = { wallet: string; expiresAt: number };
const nonces = new Map<string, NonceEntry>();

function now() { return Date.now(); }

function sweepExpired() {
  const t = now();
  for (const [k, v] of nonces) {
    if (v.expiresAt <= t) nonces.delete(k);
  }
}

export function issueNonce(wallet: string): { nonce: string; expiresAt: number } {
  sweepExpired();
  const nonce = `auth_${wallet.slice(0, 8)}_${now()}_${Math.random().toString(36).slice(2, 10)}`;
  const expiresAt = now() + NONCE_TTL_MS;
  nonces.set(nonce, { wallet, expiresAt });
  return { nonce, expiresAt };
}

export function consumeNonce(nonce: string, wallet: string): boolean {
  sweepExpired();
  const entry = nonces.get(nonce);
  if (!entry) return false;
  if (entry.wallet !== wallet) return false;
  if (entry.expiresAt <= now()) {
    nonces.delete(nonce);
    return false;
  }
  // One-shot: delete after successful verification to prevent replay.
  nonces.delete(nonce);
  return true;
}

export function verifyWalletSignature(
  walletAddr: string,
  message: string,
  signatureB58: string,
): boolean {
  try {
    const sig = bs58.decode(signatureB58);
    const pubkey = new PublicKey(walletAddr).toBytes();
    const msg = new TextEncoder().encode(message);
    return nacl.sign.detached.verify(msg, sig, pubkey);
  } catch {
    return false;
  }
}

// Header-based auth: x-wallet-address, x-nonce, x-signature.
// Message signed by the client is the nonce itself.
export const requireSignedRequest: RequestHandler = (req, res, next) => {
  const wallet = req.header('x-wallet-address');
  const nonce = req.header('x-nonce');
  const signature = req.header('x-signature');

  if (!wallet || !nonce || !signature) {
    res.status(401).json({
      error: 'Signed request required',
      message: 'x-wallet-address, x-nonce, and x-signature headers are required',
    });
    return;
  }

  if (!consumeNonce(nonce, wallet)) {
    res.status(401).json({ error: 'Invalid or expired nonce' });
    return;
  }

  if (!verifyWalletSignature(wallet, nonce, signature)) {
    res.status(401).json({ error: 'Signature verification failed' });
    return;
  }

  // Attach for downstream handlers.
  (req as unknown as { signedWallet: string }).signedWallet = wallet;
  next();
};

// Test-only: allow resetting the store between tests.
export function __resetNoncesForTest() { nonces.clear(); }
