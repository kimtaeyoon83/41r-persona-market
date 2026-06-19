// Server-custodied Sui persona wallets (design doc v0.4 §0.1 chain
// transition; migration E5). Replaces the deleted Solana persona_wallets.
//
// Personas hold their Sui address deterministically HD-derived from a
// single master BIP-39 mnemonic (PERSONA_MASTER_MNEMONIC):
//   - One backup point (the mnemonic) instead of N private keys.
//   - Reproducible — same mnemonic + same hdIndex = same address always.
//   - DB-loss recovery — addresses re-derivable from the mnemonic alone.
//
// Sui uses SLIP-0044 coin type 784 (Solana was 501). Same hdIndex maps
// to a DIFFERENT address than the old Solana wallet by construction —
// personas get fresh Sui addresses (the old Solana addrs in
// personas.tester_addr are historical; re-seed assigns Sui ones).
//
// Custody: the mnemonic lives in env (devnet/testnet phase). NEVER commit
// it. A production hardening pass moves it behind a KMS / signer service.

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

function getMnemonic(): string {
  const m = process.env.PERSONA_MASTER_MNEMONIC;
  if (!m || m.trim().length === 0) {
    throw new Error('PERSONA_MASTER_MNEMONIC is not set');
  }
  return m.trim();
}

/** Deterministic Sui keypair for a persona's HD index.
 *  Path: m/44'/784'/<hdIndex>'/0'/0' (Sui Ed25519). */
export function getPersonaKeypair(hdIndex: number): Ed25519Keypair {
  if (!Number.isInteger(hdIndex) || hdIndex < 0) {
    throw new Error(`hdIndex must be a non-negative integer, got ${hdIndex}`);
  }
  return Ed25519Keypair.deriveKeypair(
    getMnemonic(),
    `m/44'/784'/${hdIndex}'/0'/0'`,
  );
}

/** Sui address (0x…) for a persona's HD index. */
export function getPersonaAddress(hdIndex: number): string {
  return getPersonaKeypair(hdIndex).toSuiAddress();
}

export type PersonaWalletPublic = {
  hdIndex: number;
  address: string;
};

export function getPersonaWalletPublic(hdIndex: number): PersonaWalletPublic {
  return { hdIndex, address: getPersonaAddress(hdIndex) };
}
