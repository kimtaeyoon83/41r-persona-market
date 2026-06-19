import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getPersonaAddress,
  getPersonaKeypair,
} from '../services/sui/persona_wallets.js';

// Standard BIP-39 test mnemonic — fine for deterministic derivation tests.
const TEST_MNEMONIC =
  'test test test test test test test test test test test junk';

describe('sui persona wallets', () => {
  const prev = process.env.PERSONA_MASTER_MNEMONIC;
  beforeAll(() => {
    process.env.PERSONA_MASTER_MNEMONIC = TEST_MNEMONIC;
  });
  afterAll(() => {
    process.env.PERSONA_MASTER_MNEMONIC = prev;
  });

  it('derives a deterministic Sui address per hdIndex', () => {
    const a0 = getPersonaAddress(0);
    expect(a0).toMatch(/^0x[0-9a-f]{64}$/);
    expect(getPersonaAddress(0)).toBe(a0); // stable across calls
  });

  it('different hdIndex → different address', () => {
    expect(getPersonaAddress(0)).not.toBe(getPersonaAddress(1));
    expect(getPersonaAddress(5)).not.toBe(getPersonaAddress(6));
  });

  it('rejects an invalid hdIndex', () => {
    expect(() => getPersonaAddress(-1)).toThrow();
    expect(() => getPersonaKeypair(1.5)).toThrow();
  });
});
