// Retention push loops (Console Sprint 3 — console-ia-redesign.md §6).
//
// #2 Response arrival — milestone-batched so founders hear "responses
//    are piling up" without an email per submission.
// #3 Weekly digest — startDigestCron(), env-gated like the calibration
//    cron. Sends a per-user summary of their workspaces' last 7 days.
//
// Everything here is fire-and-forget + non-fatal: notification
// bookkeeping must never fail the action that triggered it. Email
// transport no-ops without RESEND_API_KEY (services/email.ts).

import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { emailEnabled, sendEmail } from './email.js';
import { logger } from '../logger.js';

const log = logger.child({ service: 'notify' });

const WEB_BASE = () => process.env.WEB_PUBLIC_URL || 'https://app.project-rpm.xyz';

/** Exported for tests — email fires when the response count lands
 *  exactly on a milestone (1st response = proof of life, then growth
 *  beats, capped where the reward cap caps). */
export const RESPONSE_MILESTONES = [1, 5, 10, 20, 30] as const;

export function isResponseMilestone(count: number): boolean {
  return (RESPONSE_MILESTONES as readonly number[]).includes(count);
}

/**
 * Survey-response arrival notification. Counts the scan's responses;
 * when the count sits exactly on a milestone, emails the scan owner
 * with a Compare CTA. Call fire-and-forget after a FIRST submission
 * (edits don't re-notify since they don't change the count).
 */
export function notifySurveyMilestone(scanId: string): void {
  void (async () => {
    try {
      if (!emailEnabled()) return;
      const [scan] = await db
        .select({
          userId: schema.audienceFitScans.userId,
          targetUrl: schema.audienceFitScans.targetUrl,
        })
        .from(schema.audienceFitScans)
        .where(eq(schema.audienceFitScans.id, scanId));
      if (!scan?.userId) return;
      const [cnt] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.surveyResponses)
        .where(eq(schema.surveyResponses.scanId, scanId));
      const n = cnt?.n ?? 0;
      if (!isResponseMilestone(n)) return;
      const [user] = await db
        .select({ email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, scan.userId));
      if (!user?.email) return;
      const host = scan.targetUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      const compareUrl = `${WEB_BASE()}/validator/compare/${scanId}`;
      await sendEmail({
        to: user.email,
        subject: `${n} survey response${n === 1 ? '' : 's'} for ${host}`,
        html: `
          <div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#2c2a26">
            <p style="margin:0 0 12px"><b>${n}</b> human response${n === 1 ? ' has' : 's have'} arrived for <b>${host}</b>.</p>
            <p style="margin:0 0 16px">See how they compare with the AI persona predictions.</p>
            <p style="margin:0">
              <a href="${compareUrl}" style="background:#c96442;color:#fff;text-decoration:none;padding:10px 18px;border-radius:7px;font-weight:600">Compare with humans →</a>
            </p>
          </div>`,
      });
    } catch (err) {
      log.warn({ scanId, err }, 'survey milestone notify failed (non-fatal)');
    }
  })();
}

// ─── Weekly digest (#3) ─────────────────────────────────────────────
// Habit-forming loop borrowed from GA's weekly email. Gated by
// DIGEST_CRON_ENABLED so dev/test never schedules timers. In-process
// week guard only — a redeploy on send-day can double-send; accepted
// for the pilot (single instance, low stakes).

let lastSentWeek: string | null = null;

function isoWeek(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

export async function runWeeklyDigest(): Promise<number> {
  if (!emailEnabled()) return 0;
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const workspaces = await db.select().from(schema.siteWorkspaces);
  if (workspaces.length === 0) return 0;

  // Per-workspace 7d facts in two grouped queries.
  const wsIds = workspaces.map((w) => w.id);
  const scanRows = await db
    .select({
      workspaceId: schema.audienceFitScans.workspaceId,
      score: schema.audienceFitScans.audienceFitScore,
      completedAt: schema.audienceFitScans.completedAt,
    })
    .from(schema.audienceFitScans)
    .where(
      and(
        inArray(schema.audienceFitScans.workspaceId, wsIds),
        eq(schema.audienceFitScans.status, 'completed'),
        gte(schema.audienceFitScans.completedAt, cutoff),
      ),
    )
    .orderBy(desc(schema.audienceFitScans.completedAt));
  const ev = schema.partnerBehaviorEvents;
  const eventRows = await db
    .select({
      source: ev.source,
      visitors: sql<number>`count(distinct ${ev.anonId})::int`,
    })
    .from(ev)
    .where(and(gte(ev.occurredAt, cutoff), sql`${ev.source} like 'ws:%'`))
    .groupBy(ev.source);
  const visitorsByWs = new Map(
    eventRows.map((r) => [r.source.slice(3), r.visitors]),
  );

  // Group workspaces by owner; one digest per user.
  const byUser = new Map<string, typeof workspaces>();
  for (const w of workspaces) {
    if (!byUser.has(w.userId)) byUser.set(w.userId, []);
    byUser.get(w.userId)!.push(w);
  }

  let sent = 0;
  for (const [userId, list] of byUser) {
    const lines: string[] = [];
    for (const w of list) {
      const scans = scanRows.filter((s) => s.workspaceId === w.id);
      const visitors = visitorsByWs.get(w.id) ?? 0;
      if (scans.length === 0 && visitors === 0) continue; // nothing to say
      const latest = scans.find((s) => s.score != null);
      const bits = [
        latest ? `fit ${Math.round(latest.score!)}` : null,
        scans.length ? `${scans.length} scan${scans.length === 1 ? '' : 's'}` : null,
        visitors ? `${visitors} visitors` : null,
      ].filter(Boolean);
      lines.push(`<li><b>${w.urlHost}</b> — ${bits.join(' · ')}</li>`);
    }
    if (lines.length === 0) continue;
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    if (!user?.email) continue;
    const ok = await sendEmail({
      to: user.email,
      subject: 'Your 41R week in review',
      html: `
        <div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#2c2a26">
          <p style="margin:0 0 12px">Last 7 days across your sites:</p>
          <ul style="margin:0 0 16px;padding-left:18px">${lines.join('')}</ul>
          <p style="margin:0">
            <a href="${WEB_BASE()}/console" style="background:#c96442;color:#fff;text-decoration:none;padding:10px 18px;border-radius:7px;font-weight:600">Open the console →</a>
          </p>
        </div>`,
    });
    if (ok) sent += 1;
  }
  log.info({ sent }, 'weekly digest run finished');
  return sent;
}

/** Checks every 6h; sends Mondays (UTC), once per ISO week per process. */
export function startDigestCron(): void {
  if (process.env.DIGEST_CRON_ENABLED !== '1') {
    log.info('digest cron disabled (DIGEST_CRON_ENABLED != 1)');
    return;
  }
  const tick = async () => {
    const now = new Date();
    if (now.getUTCDay() !== 1) return; // Monday
    const week = isoWeek(now);
    if (lastSentWeek === week) return;
    lastSentWeek = week;
    await runWeeklyDigest().catch((err) =>
      log.warn({ err }, 'weekly digest run failed'),
    );
  };
  setInterval(() => void tick(), 6 * 60 * 60 * 1000);
  void tick();
  log.info('digest cron started (weekly, Mondays UTC)');
}
