// On-chain proof — the read-side counterpart to anchor.ts.
//
// anchor.ts WRITES the verifiable record (mint + Seal blob + public content-hash
// manifest). This module READS it back live so a UI can prove integrity end to
// end, without trusting our DB:
//   1. live getObject(Sui)            → object exists, owner, version, memwal refs
//   2. public manifest blob (Walrus)  → the committed sha256 (readable by anyone)
//   3. plaintext vector + DB hash      → the browser re-hashes and compares
//
// The sealed persona blob stays encrypted (Seal committee deferred, §6.3), so
// content_decryption is reported as 'gated' — we never pretend the ciphertext is
// in-browser readable. The honest verifiable claim is the public content-hash
// commitment, not decryption.

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { COHORT_BY_ID } from '@41rpm/shared';
import { db, schema } from '../../db/index.js';
import { getSuiClient } from './client.js';
import { getBlob, walrusBlobUrl } from '../walrus.js';
import { suiObjectUrl, personaPlaintext, buildScanReportPayload, sha256Hex } from './anchor.js';
import { childLogger } from '../../logger.js';

const log = childLogger({ svc: 'sui.proof' });

/** Live on-chain read of a persona object (best-effort; null on any failure so
 *  the panel degrades to DB-known fields instead of erroring). */
export type OnChainObject = {
  exists: boolean;
  type: string | null;
  owner: unknown;
  version: string | null;
  memwal_refs: string[];
  memwal_count: number;
};

export type ManifestFetch =
  | { ok: true; manifest: unknown }
  | { ok: false; error: string };

export type PersonaProof = {
  persona_id: string;
  scan_id: string | null;
  anchored: boolean;
  anchor: {
    sui_object_id: string;
    object_url: string;
    seal_blob_id: string | null;
    seal_blob_url: string | null;
    seal_id: string | null;
    content_manifest_blob_id: string | null;
    content_manifest_url: string | null;
    anchored_at: string | null;
  } | null;
  onchain: OnChainObject | { error: string } | null;
  manifest: ManifestFetch | null;
  content: {
    decryption: 'gated';
    plaintext: string;
    content_hash: string | null;
  };
};

export type PersonaProofDeps = {
  load: (personaId: string) => Promise<
    | {
        suiObjectId: string | null;
        walrusBlobId: string | null;
        sealId: string | null;
        contentHash: string | null;
        contentManifestBlobId: string | null;
        anchoredAt: Date | null;
        vector: unknown;
      }
    | null
  >;
  readObject: (objectId: string) => Promise<OnChainObject | { error: string }>;
  readManifest: (blobId: string) => Promise<ManifestFetch>;
};

/** Parse the memwal_refs vector out of a getObject content payload defensively —
 *  Sui returns Move struct fields under data.content.fields, but the exact shape
 *  varies by SDK version, so we never throw on a missing field. */
function extractOnChain(obj: {
  data?: {
    type?: string | null;
    owner?: unknown;
    version?: string | null;
    content?: { fields?: Record<string, unknown> } | null;
  } | null;
  error?: unknown;
}): OnChainObject | { error: string } {
  if (!obj.data) {
    return { error: obj.error ? JSON.stringify(obj.error) : 'object_not_found' };
  }
  const fields = obj.data.content?.fields ?? {};
  const rawRefs = (fields as Record<string, unknown>).memwal_refs;
  const refs = Array.isArray(rawRefs) ? rawRefs.map((r) => String(r)) : [];
  return {
    exists: true,
    type: obj.data.type ?? null,
    owner: obj.data.owner ?? null,
    version: obj.data.version ?? null,
    memwal_refs: refs,
    memwal_count: refs.length,
  };
}

export function defaultPersonaProofDeps(): PersonaProofDeps {
  return {
    load: async (personaId) => {
      const [row] = await db
        .select({
          suiObjectId: schema.personas.suiObjectId,
          walrusBlobId: schema.personas.walrusBlobId,
          sealId: schema.personas.sealId,
          contentHash: schema.personas.contentHash,
          contentManifestBlobId: schema.personas.contentManifestBlobId,
          anchoredAt: schema.personas.anchoredAt,
          vector: schema.personas.vector,
        })
        .from(schema.personas)
        .where(eq(schema.personas.id, personaId))
        .limit(1);
      return row ?? null;
    },
    readObject: async (objectId) => {
      try {
        const obj = await getSuiClient().getObject({
          id: objectId,
          options: { showOwner: true, showType: true, showContent: true },
        });
        return extractOnChain(obj as Parameters<typeof extractOnChain>[0]);
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
    readManifest: async (blobId) => {
      try {
        const bytes = await getBlob(blobId);
        const text = new TextDecoder().decode(bytes);
        return { ok: true, manifest: JSON.parse(text) };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}

/** Build the full live proof for a persona. Returns null when the persona row
 *  doesn't exist (caller → 404). Unanchored personas return anchored:false with
 *  the plaintext still present (nothing to verify on-chain yet). */
export async function buildPersonaProof(
  personaId: string,
  scanId: string | null,
  deps: PersonaProofDeps = defaultPersonaProofDeps(),
): Promise<PersonaProof | null> {
  const p = await deps.load(personaId);
  if (!p) return null;

  const content = {
    decryption: 'gated' as const,
    plaintext: personaPlaintext(p.vector),
    content_hash: p.contentHash,
  };

  if (!p.suiObjectId) {
    return {
      persona_id: personaId,
      scan_id: scanId,
      anchored: false,
      anchor: null,
      onchain: null,
      manifest: null,
      content,
    };
  }

  const [onchain, manifest] = await Promise.all([
    deps.readObject(p.suiObjectId),
    p.contentManifestBlobId
      ? deps.readManifest(p.contentManifestBlobId)
      : Promise.resolve<ManifestFetch | null>(null),
  ]);

  log.info(
    { personaId, suiObjectId: p.suiObjectId, hasManifest: !!p.contentManifestBlobId },
    'persona proof read',
  );

  return {
    persona_id: personaId,
    scan_id: scanId,
    anchored: true,
    anchor: {
      sui_object_id: p.suiObjectId,
      object_url: suiObjectUrl(p.suiObjectId),
      seal_blob_id: p.walrusBlobId,
      seal_blob_url: p.walrusBlobId ? walrusBlobUrl(p.walrusBlobId) : null,
      seal_id: p.sealId,
      content_manifest_blob_id: p.contentManifestBlobId,
      content_manifest_url: p.contentManifestBlobId
        ? walrusBlobUrl(p.contentManifestBlobId)
        : null,
      anchored_at: p.anchoredAt ? p.anchoredAt.toISOString() : null,
    },
    onchain,
    manifest,
    content,
  };
}

// ─── Report proof ──────────────────────────────────────────────────────────
// Scan reports have NO Sui object (a scan ≈ Campaign would need an escrow coin,
// deferred). So the report proof is honestly weaker: a DB-stored content hash
// over the report snapshot + the sealed Walrus blob. The browser can still
// recompute sha256(report payload) and match the stored hash, but there is no
// on-chain commitment to point at — we say so plainly.

export type ReportProof = {
  scan_id: string;
  anchored: boolean;
  on_chain_commitment: false;
  report: {
    content_hash: string | null;
    seal_blob_id: string | null;
    seal_blob_url: string | null;
    seal_id: string | null;
    anchored_at: string | null;
    decryption: 'gated';
    plaintext: string;
    note: string;
  } | null;
};

const REPORT_NOTE =
  'Reports have no Sui object yet (scan≈Campaign escrow deferred). The hash is ' +
  'a DB commitment over the report snapshot — recompute it locally to verify ' +
  'integrity, but there is no on-chain anchor to point at.';

export async function buildReportProof(
  scanId: string,
  scan?: typeof schema.audienceFitScans.$inferSelect | null,
): Promise<ReportProof | null> {
  let row = scan;
  if (row === undefined) {
    const [r] = await db
      .select()
      .from(schema.audienceFitScans)
      .where(eq(schema.audienceFitScans.id, scanId))
      .limit(1);
    row = r ?? null;
  }
  if (!row) return null;

  if (!row.reportWalrusBlobId && !row.reportContentHash) {
    return { scan_id: scanId, anchored: false, on_chain_commitment: false, report: null };
  }

  // Recompute the plaintext the hash was taken over so the browser can match it.
  const plaintext = JSON.stringify(buildScanReportPayload(row));
  return {
    scan_id: scanId,
    anchored: true,
    on_chain_commitment: false,
    report: {
      content_hash: row.reportContentHash ?? sha256Hex(plaintext),
      seal_blob_id: row.reportWalrusBlobId ?? null,
      seal_blob_url: row.reportWalrusBlobId ? walrusBlobUrl(row.reportWalrusBlobId) : null,
      seal_id: row.reportSealId ?? null,
      anchored_at: row.reportAnchoredAt ? row.reportAnchoredAt.toISOString() : null,
      decryption: 'gated',
      plaintext,
      note: REPORT_NOTE,
    },
  };
}

// ─── Chain showcase ──────────────────────────────────────────────────────────
// Judge-facing data-provenance view: auto-pick the scan with the MOST anchored
// personas, then return the whole on-chain ↔ Walrus ↔ report linkage so a single
// page can draw it. DB-only and fast (no per-persona getObject — the live drill-
// down reuses GET /persona/:id/proof). The story it tells:
//   persona vector → Seal blob + public manifest → Sui object.memwal_refs
//   N personas → aggregate scores → report (its own hash + sealed blob)

export type ShowcasePersona = {
  persona_id: string;
  cohort_id: string;
  cohort_label: string;
  scores: {
    happiness: number | null;
    engagement: number | null;
    task_success: number | null;
    adoption: number | null;
    retention_d7: number | null;
  };
  sui_object_id: string;
  object_url: string;
  walrus_blob_id: string | null;
  walrus_url: string | null;
  content_manifest_blob_id: string | null;
  content_manifest_url: string | null;
  content_hash: string | null;
  anchored_at: string | null;
};

export type ChainShowcase = {
  scan: {
    id: string;
    target_url: string;
    category: string | null;
    one_line_pitch: string | null;
    mode: string;
    audience_fit_score: number | null;
    best_cohort_id: string | null;
    best_cohort_label: string | null;
    best_cohort_score: number | null;
    worst_cohort_id: string | null;
    personas_completed: number | null;
  };
  report_proof: ReportProof | null;
  personas: ShowcasePersona[];
  counts: { anchored: number; total_in_scan: number };
};

export type ShowcaseDeps = {
  /** The scan to feature = the one whose responses include the most anchored
   *  personas (ties → newest). null when nothing is anchored yet. */
  pickScanId: () => Promise<string | null>;
  loadScan: (
    scanId: string,
  ) => Promise<typeof schema.audienceFitScans.$inferSelect | null>;
  loadAnchoredPersonas: (scanId: string) => Promise<
    Array<{
      personaId: string;
      cohortId: string;
      happiness: number | null;
      engagement: number | null;
      taskSuccess: number | null;
      adoption: number | null;
      retentionD7: number | null;
      suiObjectId: string | null;
      walrusBlobId: string | null;
      contentManifestBlobId: string | null;
      contentHash: string | null;
      anchoredAt: Date | null;
    }>
  >;
  countPersonasInScan: (scanId: string) => Promise<number>;
};

export function defaultShowcaseDeps(): ShowcaseDeps {
  return {
    pickScanId: async () => {
      // Prefer the scan that tells the WHOLE story: an anchored report AND the
      // most anchored personas. Falls back to most-anchored-personas when no
      // scan has an anchored report yet (report_anchored sorts first).
      const rows = await db
        .select({
          scanId: schema.scanPersonaResponses.scanId,
          n: sql<number>`count(distinct ${schema.personas.id})::int`,
          reportAnchored: sql<boolean>`bool_or(${schema.audienceFitScans.reportContentHash} is not null)`,
        })
        .from(schema.scanPersonaResponses)
        .innerJoin(
          schema.personas,
          eq(schema.personas.id, schema.scanPersonaResponses.personaId),
        )
        .innerJoin(
          schema.audienceFitScans,
          eq(schema.audienceFitScans.id, schema.scanPersonaResponses.scanId),
        )
        .where(isNotNull(schema.personas.suiObjectId))
        .groupBy(schema.scanPersonaResponses.scanId)
        .orderBy(
          desc(sql`bool_or(${schema.audienceFitScans.reportContentHash} is not null)`),
          desc(sql`count(distinct ${schema.personas.id})`),
        )
        .limit(1);
      return rows[0]?.scanId ?? null;
    },
    loadScan: async (scanId) => {
      const [row] = await db
        .select()
        .from(schema.audienceFitScans)
        .where(eq(schema.audienceFitScans.id, scanId))
        .limit(1);
      return row ?? null;
    },
    loadAnchoredPersonas: async (scanId) =>
      db
        .select({
          personaId: schema.scanPersonaResponses.personaId,
          cohortId: schema.scanPersonaResponses.cohortId,
          happiness: schema.scanPersonaResponses.happinessScore,
          engagement: schema.scanPersonaResponses.engagementScore,
          taskSuccess: schema.scanPersonaResponses.taskSuccessScore,
          adoption: schema.scanPersonaResponses.adoptionScore,
          retentionD7: schema.scanPersonaResponses.retentionD7,
          suiObjectId: schema.personas.suiObjectId,
          walrusBlobId: schema.personas.walrusBlobId,
          contentManifestBlobId: schema.personas.contentManifestBlobId,
          contentHash: schema.personas.contentHash,
          anchoredAt: schema.personas.anchoredAt,
        })
        .from(schema.scanPersonaResponses)
        .innerJoin(
          schema.personas,
          eq(schema.personas.id, schema.scanPersonaResponses.personaId),
        )
        .where(
          and(
            eq(schema.scanPersonaResponses.scanId, scanId),
            isNotNull(schema.personas.suiObjectId),
          ),
        ),
    countPersonasInScan: async (scanId) => {
      const [r] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.scanPersonaResponses)
        .where(eq(schema.scanPersonaResponses.scanId, scanId));
      return r?.n ?? 0;
    },
  };
}

/** Pure shaper — DB persona row → wire shape (testable without a DB). */
export function shapeShowcasePersona(
  p: Awaited<ReturnType<ShowcaseDeps['loadAnchoredPersonas']>>[number],
): ShowcasePersona {
  return {
    persona_id: p.personaId,
    cohort_id: p.cohortId,
    cohort_label: COHORT_BY_ID[p.cohortId]?.label ?? p.cohortId,
    scores: {
      happiness: p.happiness,
      engagement: p.engagement,
      task_success: p.taskSuccess,
      adoption: p.adoption,
      retention_d7: p.retentionD7,
    },
    sui_object_id: p.suiObjectId!,
    object_url: suiObjectUrl(p.suiObjectId!),
    walrus_blob_id: p.walrusBlobId,
    walrus_url: p.walrusBlobId ? walrusBlobUrl(p.walrusBlobId) : null,
    content_manifest_blob_id: p.contentManifestBlobId,
    content_manifest_url: p.contentManifestBlobId
      ? walrusBlobUrl(p.contentManifestBlobId)
      : null,
    content_hash: p.contentHash,
    anchored_at: p.anchoredAt ? p.anchoredAt.toISOString() : null,
  };
}

export async function buildChainShowcase(
  deps: ShowcaseDeps = defaultShowcaseDeps(),
): Promise<ChainShowcase | null> {
  const scanId = await deps.pickScanId();
  if (!scanId) return null;
  const scan = await deps.loadScan(scanId);
  if (!scan) return null;

  const [rawPersonas, total, reportProof] = await Promise.all([
    deps.loadAnchoredPersonas(scanId),
    deps.countPersonasInScan(scanId),
    buildReportProof(scanId, scan),
  ]);

  const personas = rawPersonas.map(shapeShowcasePersona);
  log.info({ scanId, anchored: personas.length, total }, 'chain showcase built');

  return {
    scan: {
      id: scan.id,
      target_url: scan.targetUrl,
      category: scan.category,
      one_line_pitch: scan.oneLinePitch,
      mode: scan.mode,
      audience_fit_score: scan.audienceFitScore,
      best_cohort_id: scan.bestCohortId,
      best_cohort_label: scan.bestCohortId
        ? (COHORT_BY_ID[scan.bestCohortId]?.label ?? scan.bestCohortId)
        : null,
      best_cohort_score: scan.bestCohortScore,
      worst_cohort_id: scan.worstCohortId,
      personas_completed: scan.personasCompleted,
    },
    report_proof: reportProof,
    personas,
    counts: { anchored: personas.length, total_in_scan: total },
  };
}
