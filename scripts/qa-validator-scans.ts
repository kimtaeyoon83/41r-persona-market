#!/usr/bin/env npx tsx
/**
 * Cross-scan QA (Layer 2 detection) — CLAUDE.md Known Limitation §5
 * plus the score-vs-voice consistency check the behavior-sim spike
 * surfaced (gate-label vs utterance mismatch pattern, 2026-06-10).
 *
 * Read-only. Pulls the last N completed scans and flags:
 *   (a) crypto vocabulary in friction quotes on non-crypto scans
 *       (fabrication OR honest self-ID — both listed for human review)
 *   (b) rank-1 friction cluster with audience-misfit semantics
 *       covering >30% of personas (cohort-pool tilt signal, §1)
 *   (c) visitor-weighted AARRR collapsing to all-zero n_passing
 *       (would have caught the 2026-05-07 n_passing=0 regression)
 *   (d) numeric-vs-voice contradictions per persona: high adoption
 *       with strongly negative voice, or abandon-level engagement
 *       with meaningful adoption
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/qa-validator-scans.ts [--max=10] [--scan=<id>]
 */
import 'dotenv/config';
import pg from 'pg';
import {
  computeAarrrWeightedFromRows,
  type AarrrWeightedInputRow,
} from '../apps/api/src/services/aarrr.js';
import { getAcquisitionPriorsFor } from '../packages/shared/src/acquisition_priors.js';

const argvFlag = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const MAX = Number(argvFlag('max') ?? 10);
const ONLY_SCAN = argvFlag('scan');

const CRYPTO_CATEGORIES = new Set(['DeFi', 'NFT', 'Crypto Wallet']);
// Vocab list mirrors the 2026-05-07 contamination audit terms.
const CRYPTO_VOCAB =
  /지갑|월렛|wallet|web3|on-?chain|온체인|defi|디파이|슬리피지|slippage|가스비|gas fee|seed phrase|시드 ?문구|민팅|minting|에어드랍|airdrop|스테이킹|staking|MEV/i;
const MISFIT_SEMANTICS =
  /wrong audience|misalign|not (the |my |for )|관심사|타깃|target audience|쓸 이유가|내가 여기서|relevance|irrelevant/i;
const STRONG_NEGATIVE =
  /절대 (안|않)|안 쓸|쓰지 않을|다시는|다신 (안|않)|never (use|return|come back)|won'?t (use|return|come back)|wouldn'?t (use|return)|no reason to (return|come back)/i;

interface ScanRow {
  id: string;
  target_url: string;
  mode: string;
  category: string | null;
  category_confidence: number | null;
  personas_completed: number;
  frictions_json:
    | Array<{ rank: number; title: string; summary: string; n: number; quote: string }>
    | null;
}

interface PersonaRow {
  cohort_id: string;
  is_flagged: boolean;
  happiness_score: number | null;
  task_success_score: number | null;
  adoption_score: number | null;
  retention_d7: number | null;
  engagement_score: number | null;
  voice_biggest_friction: string | null;
  voice_would_return_because: string | null;
}

async function main() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const scanFilter = ONLY_SCAN ? 'AND id = $2' : '';
  const params: unknown[] = [MAX];
  if (ONLY_SCAN) params.push(ONLY_SCAN);
  const { rows: scans } = await client.query<ScanRow>(
    `SELECT id, target_url, mode, category, category_confidence,
            personas_completed, frictions_json
     FROM audience_fit_scans
     WHERE status = 'completed' ${scanFilter}
     ORDER BY created_at DESC
     LIMIT $1`,
    params,
  );

  let totalFlags = 0;
  for (const scan of scans) {
    const { rows: personas } = await client.query<PersonaRow>(
      `SELECT cohort_id, is_flagged, happiness_score, task_success_score,
              adoption_score, retention_d7, engagement_score,
              voice_biggest_friction, voice_would_return_because
       FROM scan_persona_responses WHERE scan_id = $1`,
      [scan.id],
    );
    const active = personas.filter((p) => !p.is_flagged);
    const flags: string[] = [];

    // (a) crypto vocab on a non-crypto site
    if (scan.category && !CRYPTO_CATEGORIES.has(scan.category)) {
      const hits: string[] = [];
      for (const f of scan.frictions_json ?? []) {
        const t = `${f.title} ${f.summary} ${f.quote}`;
        if (CRYPTO_VOCAB.test(t)) hits.push(`cluster#${f.rank}: ${f.title.slice(0, 50)}`);
      }
      for (const p of active) {
        const v = p.voice_biggest_friction ?? '';
        if (CRYPTO_VOCAB.test(v)) hits.push(`${p.cohort_id}: "${v.slice(0, 60)}"`);
      }
      if (hits.length > 0) {
        flags.push(
          `(a) crypto vocab on ${scan.category} site — ${hits.length} hit(s); fabrication vs honest self-ID needs human read:\n` +
            hits.slice(0, 4).map((h) => `        ${h}`).join('\n'),
        );
      }
    }

    // (b) rank-1 misfit cluster > 30% of personas
    const rank1 = (scan.frictions_json ?? []).find((f) => f.rank === 1);
    if (rank1 && scan.personas_completed > 0) {
      const share = rank1.n / scan.personas_completed;
      if (share > 0.3 && MISFIT_SEMANTICS.test(`${rank1.title} ${rank1.summary}`)) {
        flags.push(
          `(b) rank-1 friction is audience-misfit at ${(share * 100).toFixed(0)}% ` +
            `("${rank1.title.slice(0, 50)}") — cohort-pool tilt signal (Known Limitation §1)`,
        );
      }
    }

    // (c) weighted AARRR all-zero n_passing (Mode A only)
    if (scan.mode === 'A' && active.length > 0) {
      const weightedRows: AarrrWeightedInputRow[] = personas.map((p) => ({
        isFlagged: p.is_flagged,
        happiness: p.happiness_score,
        taskSuccess: p.task_success_score,
        adoption: p.adoption_score,
        retentionD7: p.retention_d7,
        cohortId: p.cohort_id,
      }));
      const priors = getAcquisitionPriorsFor(scan.category, scan.category_confidence ?? 0);
      const weighted = computeAarrrWeightedFromRows(weightedRows, priors);
      if (weighted) {
        const allZero = weighted.stages.every((s) => s.n_passing === 0);
        if (allZero) {
          flags.push('(c) visitor-weighted AARRR collapsed to all-zero n_passing — regression signature');
        }
      }
    }

    // (d) numeric-vs-voice contradictions
    const contradictions: string[] = [];
    for (const p of active) {
      const voice = `${p.voice_would_return_because ?? ''} ${p.voice_biggest_friction ?? ''}`;
      if ((p.adoption_score ?? 0) >= 70 && STRONG_NEGATIVE.test(voice)) {
        contradictions.push(
          `${p.cohort_id}: adoption ${p.adoption_score} but voice "${voice.trim().slice(0, 50)}"`,
        );
      }
      if ((p.engagement_score ?? 100) <= 10 && (p.adoption_score ?? 0) >= 50) {
        contradictions.push(
          `${p.cohort_id}: abandon-level engagement (${p.engagement_score}) but adoption ${p.adoption_score}`,
        );
      }
    }
    if (contradictions.length > 0) {
      const pct = ((contradictions.length / Math.max(1, active.length)) * 100).toFixed(1);
      flags.push(
        `(d) ${contradictions.length} numeric-vs-voice contradiction(s) (${pct}% of personas):\n` +
          contradictions.slice(0, 3).map((c) => `        ${c}`).join('\n'),
      );
    }

    const head = `${scan.id.slice(0, 8)} ${scan.target_url} [${scan.category ?? '?'} · mode ${scan.mode} · n=${scan.personas_completed}]`;
    if (flags.length === 0) {
      console.log(`✓ ${head}`);
    } else {
      totalFlags += flags.length;
      console.log(`⚠ ${head}`);
      for (const f of flags) console.log(`    ${f}`);
    }
  }

  console.log(`\n${scans.length} scan(s) checked · ${totalFlags} flag(s)`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
