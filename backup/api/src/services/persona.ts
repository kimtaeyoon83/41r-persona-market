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
import { env } from '../config/env.js';

const SOURCE_REPORT_LIMIT = env.PERSONA_SOURCE_REPORT_LIMIT;
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

/**
 * Profile-driven fallback. Produces a deterministic vector keyed to the
 * tester's profile (expertise strings, crypto_experience, primary_device,
 * design_matters, occupation, frustration_triggers). Two testers with
 * different profiles → different vectors; same profile → same output.
 * Keeps auto-queue matching meaningful even when generatePersona's LLM
 * call fails (pre-change every fallback persona collapsed to identical
 * hardcoded numbers, defeating the matcher).
 */
type FallbackProfile = {
  expertise?: string[];
  crypto_experience?: string;
  occupation?: string;
  primary_device?: string;
  design_matters?: boolean;
  frustration_triggers?: string[];
  age_range?: string;
  region?: string;
  experience_level?: string;
};

function has(arr: string[] | undefined, ...needles: string[]): boolean {
  if (!arr || arr.length === 0) return false;
  const set = new Set(arr.map((s) => String(s).toLowerCase()));
  return needles.some((n) => set.has(n.toLowerCase()));
}

function hasSubstring(haystack: string | undefined, ...needles: string[]): boolean {
  if (!haystack) return false;
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function buildFallbackVector(reports: ReportRow[], profile?: FallbackProfile) {
  const p: FallbackProfile = profile ?? {};
  const cryptoExp = String(p.crypto_experience ?? '').toLowerCase();
  const advanced = cryptoExp === 'advanced';
  const intermediate = cryptoExp === 'intermediate';
  const none = cryptoExp === 'none' || cryptoExp === '';

  const expertiseArr = p.expertise ?? [];

  // Expertise: start at a baseline matching crypto_experience, add per
  // declared expertise tag.
  const baseDomain = none ? 0.15 : intermediate ? 0.35 : advanced ? 0.5 : 0.25;
  const expertise = {
    defi: clamp(baseDomain + (has(expertiseArr, 'defi', 'trading', 'finance') ? 0.4 : 0) + (hasSubstring(p.occupation, 'trader', 'defi') ? 0.1 : 0)),
    nft: clamp(baseDomain + (has(expertiseArr, 'nft', 'art', 'collectibles') ? 0.4 : 0)),
    gaming: clamp(baseDomain + (has(expertiseArr, 'gaming', 'games') ? 0.4 : 0)),
    ai_tools: clamp(baseDomain + (has(expertiseArr, 'ai', 'ml', 'llm', 'ai-tools') ? 0.4 : 0) + (hasSubstring(p.occupation, 'engineer', 'developer', 'scientist') ? 0.15 : 0)),
    general_web: clamp(0.5 + (has(expertiseArr, 'web3', 'web', 'saas', 'e-commerce', 'product') ? 0.3 : 0.1)),
  };

  // Feedback pattern: drives matcher + Phase D persona actions.
  const triggers = p.frustration_triggers ?? [];
  const feedback_pattern = {
    ui_critical: clamp(
      (p.design_matters ? 0.7 : 0.4) +
      (has(expertiseArr, 'design', 'design-systems', 'ui', 'ux') ? 0.25 : 0) +
      (hasSubstring(p.occupation, 'design', 'ux') ? 0.1 : 0),
    ),
    security_aware: clamp(
      (advanced ? 0.55 : intermediate ? 0.35 : 0.2) +
      (has(expertiseArr, 'security', 'audit') ? 0.4 : 0) +
      (hasSubstring(p.occupation, 'security', 'audit') ? 0.2 : 0),
    ),
    performance_sensitive: clamp(
      0.45 +
      (has(expertiseArr, 'performance', 'backend', 'infra') ? 0.35 : 0) +
      (hasSubstring(p.occupation, 'engineer', 'developer') ? 0.1 : 0) +
      (p.primary_device === 'mobile' ? 0.1 : 0),
    ),
    accessibility_focus: clamp(
      0.3 +
      (has(expertiseArr, 'accessibility', 'a11y') ? 0.5 : 0) +
      (p.primary_device === 'mobile' ? 0.15 : 0) +
      (p.design_matters ? 0.1 : 0),
    ),
    detail_oriented: clamp(
      0.5 +
      (has(expertiseArr, 'qa', 'testing', 'audit') ? 0.3 : 0) +
      (advanced ? 0.15 : intermediate ? 0.05 : 0) +
      (triggers.length >= 2 ? 0.1 : 0),
    ),
  };

  // Test style — advanced users test faster/broader, novices more cautious.
  const test_style = {
    thoroughness: clamp(advanced ? 0.75 : intermediate ? 0.6 : 0.5),
    speed: clamp(advanced ? 0.7 : intermediate ? 0.5 : 0.35),
    ux_focus: clamp(feedback_pattern.ui_critical * 0.8 + 0.15),
    bug_detection: clamp(feedback_pattern.detail_oriented * 0.7 + (advanced ? 0.15 : 0)),
    creativity: clamp(0.4 + (has(expertiseArr, 'design', 'product', 'research') ? 0.3 : 0)),
  };

  // Reliability — keep the existing "avg quality / 5" calibration.
  const avgQ = reports.reduce((sum, r) => sum + (r.qualityScore ?? 3), 0) / Math.max(1, reports.length);

  const voiceBits: string[] = [];
  if (p.occupation) voiceBits.push(`${p.occupation} 관점에서`);
  else if (advanced) voiceBits.push('크립토 숙련자로서');
  else if (none) voiceBits.push('일반 사용자로서');
  if (p.design_matters) voiceBits.push('디자인 일관성에 민감하며');
  if (feedback_pattern.security_aware > 0.7) voiceBits.push('보안/신뢰 신호를 먼저 확인하고');
  if (feedback_pattern.performance_sensitive > 0.7) voiceBits.push('성능·로딩 지연을 놓치지 않으며');
  if (triggers.length > 0) voiceBits.push(`${triggers.slice(0, 2).join('·')} 에 특히 예민합니다`);
  else voiceBits.push('실제 사용 관점에서 구체적인 피드백을 남깁니다');

  return {
    test_style,
    expertise,
    feedback_pattern,
    reliability: {
      quality_score: clamp(avgQ / 5),
      consistency: clamp(0.65 + (reports.length >= 5 ? 0.1 : 0)),
      response_rate: 1.0,
    },
    voice_sample: voiceBits.join(' ') + '.',
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
  // LLM call is retried once with a short delay — most failures are
  // transient (rate limits, network blips). If both attempts fail, we
  // drop to the profile-based fallback AND log at error level so
  // persistent failures are visible in Railway logs (pre-change these
  // were fire-and-forget silent, so a broken ANTHROPIC_API_KEY could
  // produce weeks of look-alike fallback personas before anyone noticed).
  const profileData = (tester.profile as Record<string, unknown>) || {};
  const reportPayload = reports.map((r) => ({
    checklist_results: r.checklistResults,
    scenario_log: r.scenarioLog,
    questionnaire_answers: r.questionnaireAnswers,
    quality_score: r.qualityScore,
  }));

  let vector;
  let llmErr: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      vector = await generatePersona(profileData, reportPayload);
      llmErr = null;
      break;
    } catch (err) {
      llmErr = err;
      if (attempt === 1) {
        console.warn(
          `[persona] generatePersona attempt ${attempt} failed for ${testerAddr} (trigger=${trigger}): ${err instanceof Error ? err.message : String(err)} — retrying in 2s`,
        );
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  if (!vector) {
    console.error(
      `[persona] generatePersona failed twice for ${testerAddr} (trigger=${trigger}) — falling back to profile-based vector. last error: ${llmErr instanceof Error ? llmErr.message : String(llmErr)}`,
    );
    vector = buildFallbackVector(reports, profileData as FallbackProfile);
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

