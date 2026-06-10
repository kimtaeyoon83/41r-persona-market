// /api/partner — partner S2S ingest (geulbat pilot, 2026-06-10).
//
// geulbat (our own Next.js writing service) embeds the 41R survey,
// verifies the respondent via Google OAuth on its side, and forwards
// the submission server-to-server with the shared partner key. The
// email acts as a provisional identity: rows land with user_id NULL
// and are claimed when that email later logs into 41R via Privy
// (middleware/privy_auth.ts claim pass).
//
//   POST /api/partner/geulbat/survey
//     headers: x-partner-key (middleware/partner.ts)
//     body: surveyBody fields + { email, consent: true }
//     effects: survey_responses upsert keyed (scan_id, email, user_id NULL)
//              + 5 calibration_records rows (same as the Privy survey)
//              + point_transactions credit (pilot: flat 100 pt)
//
// Anchor scan: the partner sends the scanId of the 41R scan of the
// partner's own site, so human responses line up against the AI
// prediction for the same page — the calibration showcase pair.

import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireGeulbatKey } from '../middleware/partner.js';
import {
  surveyBody,
  computeSusScoreLocal,
  HUMAN_ENGAGEMENT_TO_SCORE,
  HUMAN_RETENTION_TO_D7,
} from './scan.js';
import { logger } from '../logger.js';

const log = logger.child({ service: 'partner_ingest' });
const router: RouterType = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pilot reward — policy intentionally undecided; ledger is append-
 *  only so a real policy can reprice retroactively. */
const PILOT_SURVEY_POINTS = 100;

const partnerSurveyBody = surveyBody.extend({
  scan_id: z.string().uuid(),
  /** Google-verified on the partner side; trusted because the request
   *  carries the partner key (see middleware/partner.ts trust note). */
  email: z.string().email().max(320),
  /** Explicit research-use opt-in collected in the partner UI. The
   *  ingest refuses submissions without it — consent is recorded by
   *  the fact a row exists at all. */
  consent: z.literal(true),
});

router.post('/geulbat/survey', requireGeulbatKey, async (req, res) => {
  try {
    const parsed = partnerSurveyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const body = parsed.data;
    const email = body.email.toLowerCase();
    if (!UUID_RE.test(body.scan_id)) {
      res.status(404).json({ error: 'scan_not_found' });
      return;
    }

    const [scan] = await db
      .select()
      .from(schema.audienceFitScans)
      .where(eq(schema.audienceFitScans.id, body.scan_id));
    if (!scan) {
      res.status(404).json({ error: 'scan_not_found' });
      return;
    }
    if (scan.status !== 'completed') {
      res.status(409).json({ error: 'scan_not_completed', status: scan.status });
      return;
    }

    // Human-side dimension scores — identical recipe to the Privy
    // survey handler so calibration rows compare apples-to-apples.
    const human = {
      happiness: computeSusScoreLocal(body.sus_responses),
      engagement: HUMAN_ENGAGEMENT_TO_SCORE[body.engagement_category]!,
      adoption: body.signup_likelihood * 100,
      retention: HUMAN_RETENTION_TO_D7[body.retention_category]!,
      task_success: body.completion_likelihood * 100,
    };
    const cohortRows = await db
      .select()
      .from(schema.scanCohortResults)
      .where(eq(schema.scanCohortResults.scanId, body.scan_id));
    const totalN = cohortRows.reduce((s, c) => s + c.nCompleted, 0) || 1;
    const wAvg = (
      key: 'happinessMean' | 'engagementMean' | 'adoptionMean' | 'retentionMean' | 'taskSuccessMean',
    ) => cohortRows.reduce((s, c) => s + (c[key] ?? 0) * c.nCompleted, 0) / totalN;
    const llm = {
      happiness: wAvg('happinessMean'),
      engagement: wAvg('engagementMean'),
      adoption: wAvg('adoptionMean'),
      retention: wAvg('retentionMean'),
      task_success: wAvg('taskSuccessMean'),
    };
    const dateStr = new Date().toISOString().slice(0, 10);
    for (const d of ['happiness', 'engagement', 'adoption', 'retention', 'task_success'] as const) {
      await db.insert(schema.calibrationRecords).values({
        date: dateStr,
        siteUrl: scan.targetUrl,
        personaId: null,
        dimension: d,
        llmInference: llm[d],
        groundTruth: human[d],
        delta: llm[d] - human[d],
        source: 'human_baseline',
      });
    }

    // Upsert keyed (scan_id, email) over the unclaimed (user_id NULL)
    // rows — a geulbat user resubmitting overwrites their previous
    // answer, same edit semantics as the Privy survey. The DB-level
    // (scan_id, user_id) unique index doesn't constrain NULL user_id
    // rows, so this code-level upsert is the dedup boundary here.
    const surveyValues = {
      susResponses: body.sus_responses,
      dimensionInputs: {
        engagement_category: body.engagement_category,
        signup_likelihood: body.signup_likelihood,
        retention_category: body.retention_category,
        completion_likelihood: body.completion_likelihood,
      },
      voice: body.voice,
      customAnswers: body.custom_answers,
      demographics: body.demographics,
    };
    const [existing] = await db
      .select({ id: schema.surveyResponses.id })
      .from(schema.surveyResponses)
      .where(
        and(
          eq(schema.surveyResponses.scanId, body.scan_id),
          eq(schema.surveyResponses.email, email),
          isNull(schema.surveyResponses.userId),
        ),
      );
    let firstSubmission = true;
    if (existing) {
      firstSubmission = false;
      await db
        .update(schema.surveyResponses)
        .set({ ...surveyValues, submittedAt: new Date() })
        .where(eq(schema.surveyResponses.id, existing.id));
    } else {
      await db.insert(schema.surveyResponses).values({
        scanId: body.scan_id,
        userId: null,
        email,
        ...surveyValues,
      });
    }

    // Points — credit on first submission only (edits don't re-earn).
    if (firstSubmission) {
      await db.insert(schema.pointTransactions).values({
        userId: null,
        email,
        amount: PILOT_SURVEY_POINTS,
        reason: 'survey',
        source: 'geulbat',
      });
    }

    log.info(
      { scanId: body.scan_id, email: email.replace(/(.{2}).*(@.*)/, '$1***$2'), firstSubmission },
      'partner survey ingested',
    );
    res.status(firstSubmission ? 201 : 200).json({
      ok: true,
      first_submission: firstSubmission,
      points_awarded: firstSubmission ? PILOT_SURVEY_POINTS : 0,
    });
  } catch (err) {
    log.error({ err: (err as Error).message }, 'partner survey ingest failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─── Stream ① — person profile ───────────────────────────────────
// One row per (source, email), upserted. Profile body is partner-
// defined jsonb (recommended vocabulary mirrors testers.profile:
// age_range, region, occupation, expertise[], crypto_experience...).
const profileBody = z.object({
  email: z.string().email().max(320),
  consent: z.literal(true),
  profile: z.record(z.unknown()).refine((p) => Object.keys(p).length > 0, {
    message: 'profile must not be empty',
  }),
});

router.post('/geulbat/profile', requireGeulbatKey, async (req, res) => {
  try {
    const parsed = profileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const email = parsed.data.email.toLowerCase();
    const [existing] = await db
      .select({ id: schema.partnerProfiles.id })
      .from(schema.partnerProfiles)
      .where(
        and(
          eq(schema.partnerProfiles.source, 'geulbat'),
          eq(schema.partnerProfiles.email, email),
        ),
      );
    if (existing) {
      await db
        .update(schema.partnerProfiles)
        .set({ profile: parsed.data.profile, updatedAt: new Date() })
        .where(eq(schema.partnerProfiles.id, existing.id));
    } else {
      await db.insert(schema.partnerProfiles).values({
        source: 'geulbat',
        email,
        profile: parsed.data.profile,
      });
    }
    res.status(existing ? 200 : 201).json({ ok: true, created: !existing });
  } catch (err) {
    log.error({ err: (err as Error).message }, 'partner profile ingest failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─── Stream ② — behavior events (batch) ──────────────────────────
// Partner stores raw events in its own DB and syncs in batches.
// Event vocabulary is partner-defined; 41R aggregates downstream
// (dwell/paths/returns → behavioral traits, Mode C ground truth).
const behaviorBody = z.object({
  email: z.string().email().max(320),
  events: z
    .array(
      z.object({
        session_id: z.string().max(120).optional(),
        event_type: z.string().min(1).max(60),
        payload: z.record(z.unknown()).optional(),
        occurred_at: z.string().datetime(),
      }),
    )
    .min(1)
    .max(500),
});

router.post('/geulbat/behavior', requireGeulbatKey, async (req, res) => {
  try {
    const parsed = behaviorBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const email = parsed.data.email.toLowerCase();
    await db.insert(schema.partnerBehaviorEvents).values(
      parsed.data.events.map((e) => ({
        source: 'geulbat',
        email,
        sessionId: e.session_id ?? null,
        eventType: e.event_type,
        payload: e.payload ?? null,
        occurredAt: new Date(e.occurred_at),
      })),
    );
    res.status(201).json({ ok: true, inserted: parsed.data.events.length });
  } catch (err) {
    log.error({ err: (err as Error).message }, 'partner behavior ingest failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
