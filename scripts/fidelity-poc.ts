#!/usr/bin/env npx tsx
/**
 * Fidelity PoC runner (Stage 1 / T0) — design doc RPM v0.4 §11 entry point.
 *
 * Read-only. For each scan, prints PER-COHORT AI↔human |Δ| (never a single
 * mixed-cohort number — §8 honesty contract). With ≥2 scans, also prints
 * the "which variant wins" ranking accuracy (does AI order the variants
 * the way humans do?).
 *
 * A scan only contributes a cohort comparison where BOTH AI personas and
 * matched humans exist; cohorts/variants missing a side are shown as gaps,
 * not silently dropped.
 *
 * Usage:
 *   DATABASE_URL=... pnpm tsx scripts/fidelity-poc.ts <scanId> [<scanId> ...]
 */
import 'dotenv/config';
import {
  computeScanFidelity,
  computeVariantRanking,
} from '../apps/api/src/services/fidelity/index.js';
import { DIMENSIONS } from '../apps/api/src/services/fidelity/metrics.js';
import { pool } from '../apps/api/src/db/index.js';

const fmt = (x: number | null | undefined, d = 1): string =>
  x == null ? '—' : x.toFixed(d);

async function main(): Promise<void> {
  const scanIds = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (scanIds.length === 0) {
    console.error(
      'Usage: DATABASE_URL=... pnpm tsx scripts/fidelity-poc.ts <scanId> [<scanId> ...]',
    );
    process.exitCode = 1;
    return;
  }

  for (const scanId of scanIds) {
    const f = await computeScanFidelity(scanId);
    console.log('\n' + '═'.repeat(72));
    if (!f) {
      console.log(`scan ${scanId}: NOT FOUND`);
      continue;
    }
    console.log(
      `scan ${scanId}  [mode ${f.mode}]  AI personas=${f.nAiPersonas}  ` +
        `humans=${f.nHumans} (matched ${f.nHumansMatched}, unmatched ${f.nHumansUnmatched})`,
    );
    console.log(
      `overall |Δ| (cohorts compared=${f.nCohortsCompared}): ${fmt(f.overallAbsDeltaMean)}` +
        '   ← by-cohort below is the honest signal, not this single number',
    );

    const compared = f.cohorts.filter((c) => c.absDeltaMean != null);
    const gaps = f.cohorts.filter((c) => c.absDeltaMean == null);

    if (compared.length > 0) {
      console.log('\n  cohort               nAI  nHu   |Δ|   conf   per-dim Δ (ai-hu)');
      console.log('  ' + '─'.repeat(68));
      // Closest fit first — lowest |Δ| cohorts are where AI is trustworthy.
      compared.sort((a, b) => (a.absDeltaMean ?? 0) - (b.absDeltaMean ?? 0));
      for (const c of compared) {
        const perDim = DIMENSIONS.map(
          (d) => `${d.slice(0, 3)}:${fmt(c.delta?.[d], 0)}`,
        ).join(' ');
        console.log(
          `  ${c.cohortLabel.padEnd(20).slice(0, 20)} ` +
            `${String(c.nAi).padStart(3)}  ${String(c.nHuman).padStart(3)}  ` +
            `${fmt(c.absDeltaMean).padStart(5)}  ${fmt(c.matchConfidenceMean, 2).padStart(5)}  ${perDim}`,
        );
      }
    }
    if (gaps.length > 0) {
      console.log(
        `\n  gaps (one side only, no Δ): ` +
          gaps
            .map((c) => `${c.cohortLabel}(AI:${c.nAi}/Hu:${c.nHuman})`)
            .join(', '),
      );
    }
  }

  if (scanIds.length >= 2) {
    const vr = await computeVariantRanking(scanIds);
    console.log('\n' + '═'.repeat(72));
    console.log('VARIANT RANKING — "which variant wins" (AI vs human order)');
    console.log(`  rankable variants: ${vr.ranking.nVariants}`);
    if (vr.points.length > 0) {
      for (const p of vr.points) {
        console.log(
          `    ${p.variantId}  AI=${fmt(p.aiFit)}  human=${fmt(p.humanFit)}`,
        );
      }
    }
    if (vr.ranking.nVariants >= 2) {
      console.log(
        `  spearman=${fmt(vr.ranking.spearman, 3)}  kendallτ=${fmt(vr.ranking.kendallTau, 3)}  ` +
          `pairwise-agreement=${fmt(vr.ranking.pairwiseAgreement, 3)}`,
      );
    }
    if (vr.ranking.topPick) {
      const t = vr.ranking.topPick;
      console.log(
        `  top pick: AI→${t.aiTop}  human→${t.humanTop}  ` +
          (t.agree ? 'AGREE ✓' : 'DISAGREE ✗'),
      );
    }
    if (vr.skipped.length > 0) {
      console.log(
        `  skipped (need both AI fit + human aggregate): ` +
          vr.skipped.map((s) => `${s.scanId}(${s.reason})`).join(', '),
      );
    }
  }

  console.log('');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
