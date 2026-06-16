// Authenticated-capture secret box (Phase 1, 2026-06-16).
//
// Encrypts partner auth sessions (Playwright storageState) at rest with
// AES-256-GCM. A stored session is bearer-equivalent — anyone holding
// it is logged in as that account — so it never leaves the server in
// plaintext and is never returned to a client. Key comes from
// SESSION_ENC_KEY (32 bytes as 64 hex chars or base64); absent ⇒
// encryption is unavailable and the caller refuses to store sessions.
//
// Wire format (single string): base64(iv).base64(authTag).base64(cipher)

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM standard nonce length

/** Parse SESSION_ENC_KEY into a 32-byte buffer (hex or base64). Returns
 *  null when unset or malformed — callers treat that as "disabled". */
function loadKey(): Buffer | null {
  const raw = env.SESSION_ENC_KEY;
  if (!raw) return null;
  let buf: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, 'hex');
  } else {
    try {
      const b = Buffer.from(raw, 'base64');
      if (b.length === 32) buf = b;
    } catch {
      buf = null;
    }
  }
  return buf && buf.length === 32 ? buf : null;
}

export function isEncryptionAvailable(): boolean {
  return loadKey() !== null;
}

/** Encrypt a UTF-8 plaintext. Throws if no valid key is configured —
 *  the caller should check isEncryptionAvailable() first and 503/refuse. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  if (!key) throw new Error('SESSION_ENC_KEY not configured');
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

/** Decrypt a value produced by encryptSecret. Returns null on any
 *  failure (bad key, tampered ciphertext, wrong format) so a corrupt
 *  session degrades to "no auth session" rather than throwing into a
 *  capture run. */
export function decryptSecret(payload: string): string | null {
  const key = loadKey();
  if (!key) return null;
  const parts = payload.split('.');
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64!, 'base64');
    const tag = Buffer.from(tagB64!, 'base64');
    const data = Buffer.from(dataB64!, 'base64');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}
