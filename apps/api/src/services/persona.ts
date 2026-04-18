/**
 * Persona (re)compute pipeline.
 *
 * Historically `routes/persona.ts` had its own one-shot generation
 * logic that ran on explicit button-press and never updated thereafter.
 * This module extracts that logic into a reusable helper so:
 *   1. The POST /api/persona/generate endpoint calls it for first-time
 *      creation (behavior preserved).
 *   2. `routes/report.ts` calls it fire-and-forget after every accepted
 *      report, so the persona vector evolves with the tester (C6).
 *   3. Each run appends a row to `persona_versions`, giving the audit
 *      trail the calibration-flywheel hypothesis needs (C7,
 *      docs/pivot-strategy.md §3.1).
 */
import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { generatePersona } from './llm.js';
import { sasService, calculateTrustTier } from './sas.js';

const SOURCE_REPORT_LIMIT = Number(process.env.PERSONA_SOURCE_REPORT_LIMIT ?? 5);
const MIN_REPORTS_FOR_PERSONA = 3;

export type PersonaTrigger = 'manual' | 'report_submit' | 'admin';

export interface PersonaComputeResult {
  personaId: string;
  versionNum: number;
  isFirstVersion: boolean;
  sasAttestId?: string;
  sasOnChain: boolean;
  sourceReportIds: string[];
}

interface ReportRow {
  id: string;
  checklistResults: unknown;
  scenarioLog: unknown;
  questionnaireAnswers: unknown;
  qualityScore: number | null;
}

function buildFallbackVector(reports: ReportRow[]) {
  return {
    test_style: { thoroughness: 0.7, speed: 0.6, ux_focus: 0.8, bug_detection: 0.5, creativity: 0.6 },
    expertise: { defi: 0.5, nft: 0.3, gaming: 0.2, ai_tools: 0.4, general_web: 0.7 },
    feedback_pattern: { ui_critical: 0.7, security_aware: 0.5, performance_sensitive: 0.6, accessibility_focus: 0.4, detail_oriented: 0.7 },
    reliability: {
      quality_score: (reports.reduce((sum, r) => sum + (r.qualityScore ?? 3), 0) / Math.max(1, reports.length)) / 5,
      consistency: 0.7,
      response_rate: 1.0,
    },
    voice_sample: 'This tester provides balanced feedback with attention to UI details and practical suggestions.',
  };
}

/**
 * Recompute a tester's persona from their most recent reports. Safe to
 * call repeatedly; each call appends one row to persona_versions.
 *
 * Returns null when the tester has < MIN_REPORTS_FOR_PERSONA (silently
 * — the report-submit path shouldn't 500 just because the tester is
 * new). The explicit /api/persona/generate endpoint should check this
 * condition itself and return 400 as before.
 */
export async function recomputePersona(
  testerAddr: string,
  trigger: PersonaTrigger,
): Promise<PersonaComputeResult | null> {
  const [tester] = await db.select().from(schema.testers)
    .where(eq(schema.testers.walletAddress, testerAddr));
  if (!tester) return null;
  if (tester.testsDone < MIN_REPORTS_FOR_PERSONA) return null;

  // Use the most recent N reports — previously an unordered LIMIT 3
  // pulled an arbitrary slice and often missed the tester's growth.
  const reports = await db.select().from(schema.testReports)
    .where(eq(schema.testReports.testerAddr, testerAddr))
    .orderBy(desc(schema.testReports.createdAt))
    .limit(SOURCE_REPORT_LIMIT);
  if (reports.length < MIN_REPORTS_FOR_PERSONA) return null;

  // Generate vector via LLM, fall back to deterministic skeleton on error.
  const profileData = (tester.profile as Record<string, unknown>) || {};
  let vector;
  try {
    vector = await generatePersona(
      profileData,
      reports.map((r) => ({
        checklist_results: r.checklistResults,
        scenario_log: r.scenarioLog,
        questionnaire_answers: r.questionnaireAnswers,
        quality_score: r.qualityScore,
      })),
    );
  } catch (err) {
    console.warn(`[persona] LLM failed for ${testerAddr}, using fallback:`, err instanceof Error ? err.message : err);
    vector = buildFallbackVector(reports);
  }

  const avgQuality = reports.reduce((s, r) => s + (r.qualityScore ?? 3), 0) / reports.length;
  const sourceReportIds = reports.map((r) => r.id);

  // Upsert the current-snapshot `personas` row. If a persona already
  // exists for this tester, overwrite its vector in place; otherwise
  // insert a new one.
  let personaId: string;
  let isFirstVersion = false;
  if (tester.personaId) {
    personaId = tester.personaId;
    await db.update(schema.personas)
      .set({ vector, updatedAt: new Date() })
      .where(eq(schema.personas.id, personaId));
  } else {
    const [inserted] = await db.insert(schema.personas).values({
      testerAddr,
      vector,
      isActive: true,
    }).returning();
    personaId = inserted.id;
    isFirstVersion = true;
    await db.update(schema.testers)
      .set({ personaId })
      .where(eq(schema.testers.walletAddress, testerAddr));
  }

  // Determine the next version number. For a brand-new persona there
  // are no prior versions so this yields 1.
  const [maxRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(${schema.personaVersions.versionNum}), 0)` })
    .from(schema.personaVersions)
    .where(eq(schema.personaVersions.personaId, personaId));
  const versionNum = (maxRow?.max ?? 0) + 1;

  await db.insert(schema.personaVersions).values({
    personaId,
    testerAddr,
    versionNum,
    vector,
    sourceReportIds,
    qualityScoreAvg: avgQuality,
    trigger,
  });

  // Issue (or renew) SAS attestation. Failure is non-blocking: the
  // persona + version are already committed and a later /renew-sas
  // call can fill this in.
  let sasAttestId: string | undefined;
  let sasOnChain = false;
  try {
    const attestResult = await sasService.issueAttestation(testerAddr, {
      tests_completed: tester.testsDone,
      avg_quality: avgQuality,
      expertise_defi: vector.expertise?.defi ?? 0,
      expertise_ai_tools: vector.expertise?.ai_tools ?? 0,
      trust_tier: calculateTrustTier(avgQuality, tester.testsDone),
      persona_activated: true,
    });
    sasAttestId = attestResult.attestationId;
    sasOnChain = attestResult.onChain;
    await db.update(schema.personas)
      .set({ sasAttestId })
      .where(eq(schema.personas.id, personaId));
  } catch (sasError) {
    console.error(`[persona] SAS attestation failed for ${testerAddr}:`, sasError instanceof Error ? sasError.message : sasError);
  }

  return {
    personaId,
    versionNum,
    isFirstVersion,
    sasAttestId,
    sasOnChain,
    sourceReportIds,
  };
}

