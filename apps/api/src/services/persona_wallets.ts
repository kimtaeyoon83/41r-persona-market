// HD-derived persona wallets — Phase 2 (D2 + user request 2026-05-04).
//
// All synthetic-cohort persona wallets are derived from a single
// master BIP-39 mnemonic. Storing the mnemonic alone suffices to
// regenerate every persona's keypair for as long as we keep the
// `hd_index` on the persona row.
//
// Path: m/44'/501'/<index>'/0'   ← Solana standard (Phantom/Solflare)
//   - 44 = BIP-44
//   - 501 = Solana coin type (SLIP-44)
//   - index = persona's hd_index (0..N)
//
// Why HD vs N independent keypairs:
//   * One backup point (the mnemonic) instead of N private keys.
//   * Stateless DB — only `hd_index` needs to live on the persona row.
//   * Reproducible — same mnemonic + same index = same wallet always.
//   * DB loss recovery — wallets re-derivable from mnemonic alone.
//
// Security:
//   * Devnet phase: mnemonic in .env / Railway env (plaintext OK,
//     no real value at stake). Local backup copy at
//     secrets/persona-master.mnemonic.
//   * Mainnet phase (future): graduate to HSM or encrypted-at-rest.
//   * NEVER commit the mnemonic to git. .env + secrets/ both
//     gitignored.

import { Keypair } from '@solana/web3.js';
import { mnemonicToSeedSync, validateMnemonic } from 'bip39';
import { derivePath } from 'ed25519-hd-key';

let cachedSeed: Buffer | null = null;

function getSeed(): Buffer {
  if (cachedSeed) return cachedSeed;
  const mnemonic = process.env.PERSONA_MASTER_MNEMONIC;
  if (!mnemonic || mnemonic.trim().length === 0) {
    throw new Error(
      'PERSONA_MASTER_MNEMONIC env var is not set. Run scripts/seed-validator-cohorts.ts to generate one.',
    );
  }
  if (!validateMnemonic(mnemonic.trim())) {
    throw new Error('PERSONA_MASTER_MNEMONIC is not a valid BIP-39 mnemonic');
  }
  cachedSeed = mnemonicToSeedSync(mnemonic.trim());
  return cachedSeed;
}

/**
 * Derive the Solana Keypair for a given persona slot.
 *
 * @param hdIndex - persona's `hd_index` (the value stored on the
 *                  persona DB row). Stable across re-runs.
 * @returns        Solana Keypair — deterministic for (mnemonic, hdIndex).
 *
 * @throws if PERSONA_MASTER_MNEMONIC is unset or malformed.
 */
export function getPersonaKeypair(hdIndex: number): Keypair {
  if (!Number.isInteger(hdIndex) || hdIndex < 0) {
    throw new Error(`hdIndex must be a non-negative integer, got ${hdIndex}`);
  }
  const seed = getSeed();
  const path = `m/44'/501'/${hdIndex}'/0'`;
  const { key } = derivePath(path, seed.toString('hex'));
  return Keypair.fromSeed(key);
}

/**
 * Derive just the public address (base58) for a persona slot.
 * Cheaper than getPersonaKeypair when only the address is needed
 * (e.g., bulk seeding 800 personas, persona-card rendering).
 */
export function getPersonaAddress(hdIndex: number): string {
  return getPersonaKeypair(hdIndex).publicKey.toBase58();
}

/**
 * Public-side interface — the parts you can hand to the frontend
 * without leaking signing capability.
 */
export type PersonaWalletPublic = {
  hdIndex: number;
  address: string;
};

export function getPersonaWalletPublic(hdIndex: number): PersonaWalletPublic {
  return { hdIndex, address: getPersonaAddress(hdIndex) };
}
