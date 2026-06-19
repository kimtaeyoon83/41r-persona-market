#!/usr/bin/env npx tsx
/**
 * Show the Sui keypair for a synthetic-cohort persona.
 *
 * Two modes:
 *   pnpm tsx scripts/show-persona-key.ts 42                  # by hd_index
 *   pnpm tsx scripts/show-persona-key.ts <persona-uuid>      # by personas.id
 *
 * Output (stdout): hd_index, derivation path, Sui address, private key
 * (bech32 suiprivkey — `sui keytool import`).
 *
 * Required env (loaded from .env):
 *   PERSONA_MASTER_MNEMONIC   - 24-word BIP-39 mnemonic
 *   DATABASE_URL              - only when looking up by persona-uuid
 *
 * SECURITY: this prints raw private key material to stdout. Don't paste
 * output into chat/issues/PRs. The mnemonic itself remains the single
 * backup point.
 */

import 'dotenv/config';
import pg from 'pg';
import { getPersonaKeypair } from '../apps/api/src/services/sui/persona_wallets.js';

const { Client } = pg;

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: show-persona-key.ts <hd_index | persona_uuid>');
  process.exit(1);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveHdIndex(input: string): Promise<number> {
  // Numeric? treat as hd_index directly.
  if (/^\d+$/.test(input)) return parseInt(input, 10);

  // UUID? look up via DB.
  if (UUID_RE.test(input)) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL required when looking up by UUID');
    }
    const client = new Client({ connectionString: dbUrl });
    await client.connect();
    try {
      const r = await client.query(
        'SELECT hd_index, tester_addr FROM personas WHERE id = $1',
        [input],
      );
      if (r.rowCount === 0) throw new Error(`No persona found with id=${input}`);
      const row = r.rows[0];
      if (row.hd_index === null) {
        throw new Error(
          `Persona ${input} is a legacy (non-HD) persona — wallet ${row.tester_addr} was not derived from the master mnemonic.`,
        );
      }
      return row.hd_index as number;
    } finally {
      await client.end();
    }
  }

  throw new Error(`Argument must be a number or UUID, got: ${input}`);
}

async function main(): Promise<void> {
  const hdIndex = await resolveHdIndex(arg!);
  const kp = getPersonaKeypair(hdIndex);

  console.log('─────────────────────────────────────────────');
  console.log(`hd_index:           ${hdIndex}`);
  console.log(`derivation path:    m/44'/784'/${hdIndex}'/0'/0'`);
  console.log(`sui address:        ${kp.toSuiAddress()}`);
  console.log('─────────────────────────────────────────────');
  console.log(`private key:        ${kp.getSecretKey()}`);
  console.log("  (bech32 suiprivkey — import: sui keytool import <key> ed25519)");
  console.log('─────────────────────────────────────────────');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
