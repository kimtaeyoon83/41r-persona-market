// Transactional email (Console Sprint 2 — console-ia-redesign.md §6).
//
// Thin Resend HTTP wrapper — no SDK dependency, env-gated no-op:
// without RESEND_API_KEY every send resolves false with a debug log,
// so local dev / tests never need email config. Sending is always
// non-fatal — a notification must never fail the pipeline that
// triggered it.
//
// S2 ships the scan-complete email (push loop #1). Response-arrival
// + weekly digest land in S3.

import { logger } from '../logger.js';

const log = logger.child({ service: 'email' });

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const DEFAULT_FROM = '41R <noreply@project-rpm.xyz>';

export function emailEnabled(): boolean {
  const key = process.env.RESEND_API_KEY;
  return Boolean(key && key.length >= 12);
}

/** Returns true when the provider accepted the message. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  if (!emailEnabled()) {
    log.debug({ to: opts.to, subject: opts.subject }, 'email disabled — skipping');
    return false;
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || DEFAULT_FROM,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!res.ok) {
      log.warn({ status: res.status, to: opts.to }, 'email send rejected');
      return false;
    }
    return true;
  } catch (err) {
    log.warn(
      { to: opts.to, err: err instanceof Error ? err.message : 'unknown' },
      'email send failed (non-fatal)',
    );
    return false;
  }
}

/** Scan-complete notification — the report headline is the discovered
 *  audience, not the score (repositioning §0.1: "who" leads). */
export async function sendScanCompleteEmail(opts: {
  to: string;
  targetUrl: string;
  scanId: string;
  bestCohortLabel: string | null;
  audienceFitScore: number | null;
}): Promise<boolean> {
  const webBase = process.env.WEB_PUBLIC_URL || 'https://app.project-rpm.xyz';
  const reportUrl = `${webBase}/validator/report/${opts.scanId}`;
  const host = opts.targetUrl.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const bestLine = opts.bestCohortLabel
    ? `<p style="margin:0 0 6px">Best-fit audience: <b>${escapeHtml(opts.bestCohortLabel)}</b></p>`
    : '';
  const scoreLine =
    opts.audienceFitScore != null
      ? `<p style="margin:0 0 6px">Audience fit: <b>${Math.round(opts.audienceFitScore)}</b> / 100</p>`
      : '';
  return sendEmail({
    to: opts.to,
    subject: `Your report for ${host} is ready`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#2c2a26">
        <p style="margin:0 0 12px">112 AI personas finished reacting to <b>${escapeHtml(host)}</b>.</p>
        ${bestLine}${scoreLine}
        <p style="margin:16px 0">
          <a href="${reportUrl}" style="background:#c96442;color:#fff;text-decoration:none;padding:10px 18px;border-radius:7px;font-weight:600">Open the report →</a>
        </p>
        <p style="margin:16px 0 0;font-size:12px;color:#9a9489">41R — find your customers before launch.</p>
      </div>`,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
