import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildPersonaProof,
  buildReportProof,
  type PersonaProofDeps,
} from '../services/sui/proof.js';
import type { schema } from '../db/index.js';

const VECTOR = { age_group: '25-34', cohort: 'investor', voice_sample: 'show me traction' };

function depsFor(
  overrides: Partial<Awaited<ReturnType<PersonaProofDeps['load']>>> = {},
): PersonaProofDeps {
  return {
    load: async () => ({
      suiObjectId: '0xobj',
      walrusBlobId: 'sealedBlob',
      sealId: 'seal123',
      contentHash: createHash('sha256').update(JSON.stringify(VECTOR)).digest('hex'),
      contentManifestBlobId: 'manifestBlob',
      anchoredAt: new Date('2026-06-20T12:00:00.000Z'),
      vector: VECTOR,
      ...overrides,
    }),
    readObject: async () => ({
      exists: true,
      type: '0xpkg::persona::Persona',
      owner: { AddressOwner: '0xowner' },
      version: '42',
      memwal_refs: ['sealedBlob', 'manifestBlob'],
      memwal_count: 2,
    }),
    readManifest: async () => ({
      ok: true,
      manifest: {
        v: 1,
        kind: 'persona_vector',
        content_sha256: createHash('sha256').update(JSON.stringify(VECTOR)).digest('hex'),
      },
    }),
  };
}

describe('buildPersonaProof', () => {
  it('returns null when the persona row is missing', async () => {
    const deps = depsFor();
    deps.load = async () => null;
    expect(await buildPersonaProof('p1', 's1', deps)).toBeNull();
  });

  it('assembles anchor + live onchain + manifest for an anchored persona', async () => {
    const proof = await buildPersonaProof('p1', 's1', depsFor());
    expect(proof?.anchored).toBe(true);
    expect(proof?.anchor?.sui_object_id).toBe('0xobj');
    expect(proof?.anchor?.object_url).toContain('0xobj');
    expect(proof?.anchor?.content_manifest_url).toContain('manifestBlob');
    expect(proof?.anchor?.seal_blob_url).toContain('sealedBlob');
    expect(proof?.onchain).toMatchObject({ memwal_count: 2, version: '42' });
    expect(proof?.manifest).toMatchObject({ ok: true });
  });

  it('plaintext is the exact bytes the committed hash is taken over (browser can match)', async () => {
    const proof = await buildPersonaProof('p1', 's1', depsFor());
    // The browser will sha256(plaintext) and compare to the manifest hash —
    // this assertion is that round-trip done server-side.
    const browserHash = createHash('sha256').update(proof!.content.plaintext).digest('hex');
    expect(browserHash).toBe(proof!.content.content_hash);
    expect(
      (proof!.manifest as { manifest: { content_sha256: string } }).manifest.content_sha256,
    ).toBe(browserHash);
  });

  it('always reports content_decryption as gated (never claims sealed bytes are readable)', async () => {
    const proof = await buildPersonaProof('p1', 's1', depsFor());
    expect(proof?.content.decryption).toBe('gated');
  });

  it('unanchored persona → anchored:false but plaintext still present', async () => {
    const proof = await buildPersonaProof('p1', 's1', depsFor({ suiObjectId: null }));
    expect(proof?.anchored).toBe(false);
    expect(proof?.anchor).toBeNull();
    expect(proof?.onchain).toBeNull();
    expect(proof?.content.plaintext).toBe(JSON.stringify(VECTOR));
  });

  it('surfaces a failed on-chain read instead of throwing', async () => {
    const deps = depsFor();
    deps.readObject = async () => ({ error: 'rpc down' });
    const proof = await buildPersonaProof('p1', 's1', deps);
    expect(proof?.onchain).toEqual({ error: 'rpc down' });
  });

  it('skips manifest fetch when no manifest blob committed yet', async () => {
    const proof = await buildPersonaProof('p1', 's1', depsFor({ contentManifestBlobId: null }));
    expect(proof?.manifest).toBeNull();
    expect(proof?.anchor?.content_manifest_blob_id).toBeNull();
  });
});

// Minimal scan row covering the fields buildScanReportPayload + buildReportProof read.
const scanRow = {
  id: 's1',
  targetUrl: 'https://example.com',
  mode: 'A',
  category: 'SaaS',
  oneLinePitch: 'a thing',
  audienceFitScore: 61,
  bestCohortId: 'investor',
  bestCohortScore: 70,
  worstCohortId: 'crypto_user',
  worstCohortScore: 30,
  medianCohortScore: 50,
  personasCompleted: 100,
  modeBVerdict: null,
  completedAt: new Date('2026-06-20T12:00:00.000Z'),
  reportWalrusBlobId: 'reportSealed',
  reportSealId: 'rseal',
  reportContentHash: null,
  reportAnchoredAt: new Date('2026-06-20T12:05:00.000Z'),
} as unknown as typeof schema.audienceFitScans.$inferSelect;

describe('buildReportProof', () => {
  it('returns null for a missing scan', async () => {
    expect(await buildReportProof('s1', null)).toBeNull();
  });

  it('returns anchored:false when neither hash nor blob present', async () => {
    const bare = { ...scanRow, reportWalrusBlobId: null, reportContentHash: null };
    const proof = await buildReportProof('s1', bare as typeof scanRow);
    expect(proof?.anchored).toBe(false);
    expect(proof?.report).toBeNull();
  });

  it('is honest that reports have NO on-chain commitment', async () => {
    const proof = await buildReportProof('s1', scanRow);
    expect(proof?.on_chain_commitment).toBe(false);
    expect(proof?.report?.note).toMatch(/no Sui object/i);
  });

  it('computes a recomputable content hash over the report payload', async () => {
    const proof = await buildReportProof('s1', scanRow);
    const browserHash = createHash('sha256').update(proof!.report!.plaintext).digest('hex');
    expect(browserHash).toBe(proof!.report!.content_hash);
  });
});
