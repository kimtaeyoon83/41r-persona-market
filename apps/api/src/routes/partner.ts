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

import express, { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { requireGeulbatKey } from '../middleware/partner.js';
import {
  findWorkspaceBySiteKey,
  touchWorkspaceEvent,
} from '../services/workspaces.js';
import { awardSurveyPoints } from '../services/rewards.js';
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
// Reward amount + per-scan cap now live in services/rewards.ts
// (Console S2) — single source for both the partner and direct paths.

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

// ─── Hosted-survey handoff tokens ─────────────────────────────────
// The survey CONTENT (SUS-10, custom questions, voice prompts) is
// 41R-owned, so the partner never rebuilds the form: its server asks
// for a short-lived signed token, sends the user to 41R's hosted
// survey page (?pt=<token>), and the page submits with the token in
// place of Privy auth. HMAC secret reuses the partner key — same two-
// party trust domain, no extra env.
//   token = base64url({e: email, s: scanId, x: expiresEpochSec}) +
//           '.' + hmacSHA256(payload, PARTNER_API_KEY_GEULBAT)
const TOKEN_TTL_SEC = 30 * 60;

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signToken(email: string, scanId: string, secret: string): { token: string; exp: number } {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  const payload = b64url(Buffer.from(JSON.stringify({ e: email, s: scanId, x: exp })));
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  return { token: `${payload}.${sig}`, exp };
}

function verifyToken(
  token: string,
  secret: string,
): { email: string; scanId: string } | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const want = b64url(createHmac('sha256', secret).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'),
    ) as { e?: string; s?: string; x?: number };
    if (!body.e || !body.s || !body.x) return null;
    if (body.x < Math.floor(Date.now() / 1000)) return null;
    return { email: body.e, scanId: body.s };
  } catch {
    return null;
  }
}

type SurveyAnswers = z.infer<typeof surveyBody>;

type IngestResult =
  | { status: 'scan_not_found' }
  | { status: 'scan_not_completed'; scanStatus: string }
  | { status: 'ok'; firstSubmission: boolean; pointsAwarded: number };

/** Shared ingest core — used by both the S2S channel (/geulbat/survey)
 *  and the hosted-page token channel (/geulbat/survey-by-token). */
async function ingestGeulbatSurvey(
  scanId: string,
  emailRaw: string,
  body: SurveyAnswers,
): Promise<IngestResult> {
  const email = emailRaw.toLowerCase();
  if (!UUID_RE.test(scanId)) return { status: 'scan_not_found' };

  const [scan] = await db
    .select()
    .from(schema.audienceFitScans)
    .where(eq(schema.audienceFitScans.id, scanId));
  if (!scan) return { status: 'scan_not_found' };
  if (scan.status !== 'completed') {
    return { status: 'scan_not_completed', scanStatus: scan.status };
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
      .where(eq(schema.scanCohortResults.scanId, scanId));
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
          eq(schema.surveyResponses.scanId, scanId),
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
        scanId,
        userId: null,
        email,
        ...surveyValues,
      });
    }

    // Points — credit on first submission only (edits don't re-earn).
    // Console S2: routed through the shared reward service so the
    // per-scan cap (30 rewarded / scan) applies here too; capped
    // submissions append a transparent 0pt row.
    let pointsAwarded = 0;
    if (firstSubmission) {
      pointsAwarded = await awardSurveyPoints({
        scanId,
        source: 'geulbat',
        email,
      });
    }

  log.info(
    { scanId, email: email.replace(/(.{2}).*(@.*)/, '$1***$2'), firstSubmission },
    'partner survey ingested',
  );
  return {
    status: 'ok',
    firstSubmission,
    pointsAwarded,
  };
}

function respondIngest(res: import('express').Response, r: IngestResult): void {
  if (r.status === 'scan_not_found') {
    res.status(404).json({ error: 'scan_not_found' });
  } else if (r.status === 'scan_not_completed') {
    res.status(409).json({ error: 'scan_not_completed', status: r.scanStatus });
  } else {
    res.status(r.firstSubmission ? 201 : 200).json({
      ok: true,
      first_submission: r.firstSubmission,
      points_awarded: r.pointsAwarded,
    });
  }
}

// ─── Channel A: S2S survey forward (partner renders its own form) ──
router.post('/geulbat/survey', requireGeulbatKey, async (req, res) => {
  try {
    const parsed = partnerSurveyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const { scan_id, email, consent: _c, ...answers } = parsed.data;
    respondIngest(res, await ingestGeulbatSurvey(scan_id, email, answers as SurveyAnswers));
  } catch (err) {
    log.error({ err: (err as Error).message }, 'partner survey ingest failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// ─── Channel B: hosted survey handoff ─────────────────────────────
// B1 — partner server mints a token (key-gated).
const sessionTokenBody = z.object({
  email: z.string().email().max(320),
  scan_id: z.string().uuid(),
});

router.post('/geulbat/session-token', requireGeulbatKey, async (req, res) => {
  try {
    const parsed = sessionTokenBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const { email, scan_id } = parsed.data;
    const [scan] = await db
      .select({ id: schema.audienceFitScans.id, status: schema.audienceFitScans.status })
      .from(schema.audienceFitScans)
      .where(eq(schema.audienceFitScans.id, scan_id));
    if (!scan) {
      res.status(404).json({ error: 'scan_not_found' });
      return;
    }
    if (scan.status !== 'completed') {
      res.status(409).json({ error: 'scan_not_completed', status: scan.status });
      return;
    }
    const secret = process.env.PARTNER_API_KEY_GEULBAT!; // middleware guarantees presence
    const { token, exp } = signToken(email.toLowerCase(), scan_id, secret);
    const webBase = process.env.WEB_PUBLIC_URL ?? 'https://app.project-rpm.xyz';
    res.json({
      token,
      expires_at: new Date(exp * 1000).toISOString(),
      survey_url: `${webBase}/validator/survey/${scan_id}?pt=${encodeURIComponent(token)}`,
    });
  } catch (err) {
    log.error({ err: (err as Error).message }, 'session token issue failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

// B2 — the hosted survey page submits with the token. NO partner key:
// this is called from the respondent's browser; the token IS the auth
// (HMAC-signed by us, 30-min TTL, bound to one email + one scan).
const tokenSurveyBody = surveyBody.extend({
  token: z.string().min(20).max(2048),
});

router.post('/geulbat/survey-by-token', async (req, res) => {
  try {
    const secret = process.env.PARTNER_API_KEY_GEULBAT;
    if (!secret || secret.length < 12) {
      res.status(503).json({ error: 'partner_ingest_disabled' });
      return;
    }
    const parsed = tokenSurveyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
      return;
    }
    const { token, ...answers } = parsed.data;
    const claims = verifyToken(token, secret);
    if (!claims) {
      res.status(401).json({ error: 'token_invalid_or_expired' });
      return;
    }
    respondIngest(
      res,
      await ingestGeulbatSurvey(claims.scanId, claims.email, answers as SurveyAnswers),
    );
  } catch (err) {
    log.error({ err: (err as Error).message }, 'token survey ingest failed');
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


// ─── GA-style drop-in snippet ─────────────────────────────────────
// One script tag on the partner site, zero further code changes:
//   <script src="https://api.project-rpm.xyz/api/partner/t.js"
//           data-site="<site key>" defer></script>
// Auto-captures pageview (SPA route changes via History patch),
// dwell+scroll on leave, session boundaries (30-min idle), and ships
// batches via sendBeacon as text/plain — a CORS "simple request", so
// delivery needs no preflight and no CORS response headers.
//
// Identity: anonymous device id (localStorage) by default, GA-style.
// For email join the partner server-renders data-uid with the same
// HMAC token used for survey handoff (minted per page render, so the
// 30-min TTL is irrelevant). The site key is PUBLIC (like a GA
// measurement id) — it only routes to a source bucket; the S2S
// partner key never appears in a browser.

async function siteKeySource(
  k: string,
): Promise<{ source: string; workspaceId: string | null } | null> {
  const gb = process.env.PARTNER_SITE_KEY_GEULBAT;
  if (gb && gb.length >= 12 && k === gb) return { source: 'geulbat', workspaceId: null };
  // Dogfooding (Console Sprint 1 §5.2) — 41R's own web app carries the
  // t.js snippet so we measure our own PLG funnel with our own pipe.
  const own = process.env.PARTNER_SITE_KEY_41R;
  if (own && own.length >= 12 && k === own) return { source: '41r-web', workspaceId: null };
  // Console S2 — self-serve workspace site keys (rpm_pk_…). Source is
  // 'ws:<id>' so the analytics tab can filter per workspace.
  if (k.startsWith('rpm_pk_')) {
    const ws = await findWorkspaceBySiteKey(k);
    if (ws) return { source: `ws:${ws.id}`, workspaceId: ws.id };
  }
  return null;
}

const SNIPPET = `(function(){
var s=document.currentScript;if(!s)return;
var k=s.getAttribute('data-site');if(!k)return;
var uid=s.getAttribute('data-uid')||null;
var api=new URL(s.src).origin+'/api/partner/t';
function id(){try{return crypto.randomUUID()}catch(e){return 'x'+Date.now()+Math.random().toString(36).slice(2)}}
var aid;try{aid=localStorage.getItem('_rpm_aid');if(!aid){aid=id();localStorage.setItem('_rpm_aid',aid)}}catch(e){aid='na'}
var sid,fresh=false;try{var ls=+(sessionStorage.getItem('_rpm_ts')||0);sid=sessionStorage.getItem('_rpm_sid');
if(!sid||Date.now()-ls>1800000){sid=id();sessionStorage.setItem('_rpm_sid',sid);fresh=true}
sessionStorage.setItem('_rpm_ts',String(Date.now()))}catch(e){sid='na'}
var q=[],path=location.pathname,t0=Date.now(),smax=0;
function push(t,p){q.push({t:t,p:p||{},ts:new Date().toISOString(),sid:sid})}
function flush(){if(!q.length)return;var b=JSON.stringify({k:k,aid:aid,uid:uid,ev:q.splice(0,50)});
try{navigator.sendBeacon(api,new Blob([b],{type:'text/plain'}))}catch(e){
try{fetch(api,{method:'POST',body:b,headers:{'Content-Type':'text/plain'},keepalive:true})}catch(e2){}}}
function dwell(){push('dwell',{path:path,ms:Date.now()-t0,scroll_pct:smax})}
function nav(np){if(np===path)return;dwell();path=np;t0=Date.now();smax=0;push('pageview',{path:np});if(q.length>=20)flush()}
window.addEventListener('scroll',function(){var h=document.documentElement,d=h.scrollHeight-h.clientHeight;
if(d>0){var p=Math.round(100*h.scrollTop/d);if(p>smax)smax=p}},{passive:true});
['pushState','replaceState'].forEach(function(m){var o=history[m];history[m]=function(){o.apply(this,arguments);nav(location.pathname)}});
window.addEventListener('popstate',function(){nav(location.pathname)});
document.addEventListener('visibilitychange',function(){if(document.visibilityState==='hidden'){dwell();flush();t0=Date.now()}});
window.addEventListener('pagehide',function(){dwell();push('session_end',{});flush()});
if(fresh)push('session_start',{entry_path:path,referrer:document.referrer||''});
push('pageview',{path:path});
setInterval(flush,15000);flush();
})();`;

router.get('/t.js', (_req, res) => {
  res
    .type('application/javascript')
    .set('Cache-Control', 'public, max-age=3600')
    .send(SNIPPET);
});

const beaconEvent = z.object({
  t: z.string().min(1).max(60),
  p: z.record(z.unknown()).optional(),
  ts: z.string().datetime(),
  sid: z.string().max(120).optional(),
});
const beaconBody = z.object({
  k: z.string().min(12).max(128),
  aid: z.string().max(120),
  uid: z.string().max(2048).nullable().optional(),
  ev: z.array(beaconEvent).min(1).max(50),
});

router.post('/t', express.text({ type: '*/*', limit: '64kb' }), async (req, res) => {
  try {
    let raw: unknown;
    try {
      raw = JSON.parse(typeof req.body === 'string' ? req.body : '');
    } catch {
      res.status(400).json({ error: 'invalid_json' });
      return;
    }
    const parsed = beaconBody.safeParse(raw);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid_body' });
      return;
    }
    const resolved = await siteKeySource(parsed.data.k);
    if (!resolved) {
      res.status(401).json({ error: 'unknown_site_key' });
      return;
    }
    const { source, workspaceId } = resolved;
    // Optional identity — same HMAC token family as the survey
    // handoff; an invalid/expired uid degrades to anonymous rather
    // than rejecting the batch (tracking must never break the page).
    let email: string | null = null;
    const secret = process.env.PARTNER_API_KEY_GEULBAT;
    if (parsed.data.uid && secret && secret.length >= 12) {
      email = verifyToken(parsed.data.uid, secret)?.email ?? null;
    }
    await db.insert(schema.partnerBehaviorEvents).values(
      parsed.data.ev.map((e) => ({
        source,
        email,
        anonId: parsed.data.aid,
        sessionId: e.sid ?? null,
        eventType: e.t,
        payload: e.p ?? null,
        occurredAt: new Date(e.ts),
      })),
    );
    // TRACKED-tier flag (Console S2) — non-fatal, beacons must never
    // fail because of a bookkeeping update.
    if (workspaceId) {
      touchWorkspaceEvent(workspaceId).catch(() => {});
    }
    res.status(204).end();
  } catch (err) {
    log.error({ err: (err as Error).message }, 'beacon ingest failed');
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
