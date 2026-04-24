'use client';

/**
 * AI persona vs human agreement dashboard (investor view).
 *
 * Pulls /api/reports/compare/:testId and renders the five charts that
 * together answer "how similar are AI personas to real testers, and
 * does that similarity improve with N?":
 *   1. Headline numbers — manual/persona counts, agreement rate,
 *      correlation, KS.
 *   2. Convergence — as more reports accumulate, persona_mean
 *      approaches human_mean.
 *   3. Agreement confusion matrix — 4x4 heatmap, rows=persona majority,
 *      cols=human majority.
 *   4. Quality score scatter — paired (human, persona) dots with y=x
 *      reference line.
 *   5. Rating distribution — histogram overlay of questionnaire ratings.
 */

import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { reportApi } from '@/lib/api';

type ChecklistStatus = 'passed' | 'failed' | 'blocked';
type MatrixLabel = ChecklistStatus | 'none';

interface PerItemAgreement {
  itemId: string;
  humanMajority: ChecklistStatus | null;
  personaMajority: ChecklistStatus | null;
  agree: boolean;
  humanVotes: Record<ChecklistStatus, number>;
  personaVotes: Record<ChecklistStatus, number>;
}

interface Finding {
  id: string;
  severity: 'positive' | 'neutral' | 'negative';
  headline: string;
  detail?: string;
}

interface CompareResponse {
  test_id: string;
  manual: {
    count: number;
    reports: Array<{
      testerAddr: string;
      qualityScore: number | null;
      questionnaireAnswers?: Array<{ id: string; answer: string | number }>;
    }>;
    avg_quality: number;
    issues: { passed: number; failed: number; blocked: number };
  };
  persona: {
    count: number;
    reports: Array<{
      testerAddr: string;
      qualityScore: number | null;
      questionnaireAnswers?: Array<{ id: string; answer: string | number }>;
    }>;
    avg_quality: number;
    issues: { passed: number; failed: number; blocked: number };
  };
  comparison: {
    item_agreement_rate: number;
    item_agreement: PerItemAgreement[];
    confusion_matrix: Record<MatrixLabel, Record<MatrixLabel, number>>;
    correlation: { pearson: number; spearman: number; paired_count: number };
    rating_distribution: {
      ks_statistic: number;
      manual_count: number;
      persona_count: number;
      manual_mean: number;
      persona_mean: number;
    };
    convergence: Array<{ n: number; humanMean: number; personaMean: number; absDiff: number }>;
    findings?: Finding[];
    by_cohort?: CohortMetric[];
    by_cohort_item?: CohortItemMetric[];
  };
}

interface CohortMetric {
  cohort: string;
  humanCount: number;
  personaCount: number;
  // Null when the corresponding side of the cohort is empty — prevents
  // the "0 == real score" misread in the table.
  humanMeanQuality: number | null;
  personaMeanQuality: number | null;
  qualityAbsDiff: number | null;
  itemAgreementRate: number | null;
  ksStatisticQuality: number | null;
}

interface CohortItemMetric {
  cohort: string;
  itemId: string;
  humanN: number;
  personaN: number;
  humanFailRate: number | null;
  personaFailRate: number | null;
  flag: 'both-fail' | 'persona-worse' | 'human-worse' | 'both-pass' | 'split' | 'insufficient';
}

const MATRIX_LABELS: MatrixLabel[] = ['passed', 'failed', 'blocked', 'none'];

export default function ExperimentPage({ params }: { params: { testId: string } }) {
  const [data, setData] = useState<CompareResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    reportApi
      .compare(params.testId)
      .then((d) => setData(d as CompareResponse))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [params.testId]);

  if (err) {
    return (
      <div className="max-w-5xl p-6">
        <h1 className="t-display-m mb-4">Experiment Dashboard</h1>
        <div className="text-red-500">Error: {err}</div>
      </div>
    );
  }

  if (!data) {
    return <div className="max-w-5xl p-6">Loading…</div>;
  }

  const { manual, persona, comparison } = data;
  // A test with zero reports on one side can't generate meaningful
  // cohort-match / convergence / paired-scatter / rating-KS signals.
  // Hide those sections entirely and show a single banner instead —
  // previously we were rendering empty charts (and the rating histogram
  // misleadingly plotted persona=0 as a tall bar).
  const singleSide = manual.count === 0 || persona.count === 0;

  // Paired (human, persona) quality-score scatter points. The API gives
  // correlation aggregates but not the raw pairs, so we re-derive them
  // here from the reports arrays — same pairing rule as the server
  // (by testerAddr).
  const pairedScatter: Array<{ human: number; persona: number; tester: string }> = [];
  const manualByTester = new Map<string, number>();
  for (const r of manual.reports) {
    if (typeof r.qualityScore === 'number') manualByTester.set(r.testerAddr, r.qualityScore);
  }
  for (const r of persona.reports) {
    const m = manualByTester.get(r.testerAddr);
    if (typeof m === 'number' && typeof r.qualityScore === 'number') {
      pairedScatter.push({ human: m, persona: r.qualityScore, tester: r.testerAddr.slice(0, 6) });
    }
  }

  // Rating histogram — count votes per bucket from the first numeric
  // questionnaire answer in each report. Mirrors the server's KS input.
  const ratingBuckets: Record<number, { rating: number; human: number; persona: number }> = {};
  const bump = (kind: 'human' | 'persona', arr: CompareResponse['manual']['reports']) => {
    for (const r of arr) {
      const firstNum = (r.questionnaireAnswers ?? []).find(
        (a) => typeof a.answer === 'number',
      );
      if (!firstNum) continue;
      const v = Number(firstNum.answer);
      const key = Math.round(v);
      if (!ratingBuckets[key]) ratingBuckets[key] = { rating: key, human: 0, persona: 0 };
      ratingBuckets[key][kind] += 1;
    }
  };
  bump('human', manual.reports);
  bump('persona', persona.reports);
  const ratingHistogram = Object.values(ratingBuckets).sort((a, b) => a.rating - b.rating);

  return (
    <div className="max-w-6xl p-6 space-y-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="t-display-m">AI Persona vs Human — Agreement Dashboard</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1 font-mono">
            test_id: {params.testId}
          </p>
        </div>
        <button
          onClick={() => downloadJson(params.testId, data)}
          className="shrink-0 px-3 py-2 rounded-lg text-sm border border-border-dim bg-surface hover:border-sol-green/50 hover:bg-surface-elevated font-mono"
        >
          Export JSON
        </button>
      </header>

      {/* ─── Headline numbers ─────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="Humans (N)" value={manual.count} />
        <Stat label="Personas (M)" value={persona.count} />
        <Stat
          label="Item agreement"
          value={`${Math.round(comparison.item_agreement_rate * 100)}%`}
        />
        <Stat
          label="Quality ρ (Spearman)"
          value={
            comparison.correlation.paired_count >= 2
              ? comparison.correlation.spearman.toFixed(2)
              : '—'
          }
          sub={`paired=${comparison.correlation.paired_count}`}
        />
        <Stat
          label="Rating KS"
          value={comparison.rating_distribution.ks_statistic.toFixed(2)}
          sub={`${comparison.rating_distribution.manual_count} vs ${comparison.rating_distribution.persona_count}`}
        />
      </section>

      {/* ─── Findings — plain-English investor summary ───────────── */}
      {comparison.findings && comparison.findings.length > 0 && (
        <section className="hf-card p-5">
          <h2 className="font-display font-semibold mb-3">Key findings</h2>
          <ul className="space-y-3">
            {comparison.findings.map((f) => (
              <li key={f.id} className="flex gap-3">
                <span
                  className={`shrink-0 w-2 h-2 mt-2 rounded-full ${
                    f.severity === 'positive'
                      ? 'bg-sol-green'
                      : f.severity === 'negative'
                      ? 'bg-amber-500'
                      : 'bg-sol-blue'
                  }`}
                />
                <div>
                  <div className="text-sm">{f.headline}</div>
                  {f.detail && (
                    <div className="text-xs text-[var(--text-secondary)] mt-1">{f.detail}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── Single-side banner ──────────────────────────────────── */}
      {singleSide && (
        <section
          className="hf-card p-4 flex gap-3 items-start"
          style={{ borderColor: 'var(--warn-line)', background: 'var(--warn-soft)' }}
        >
          <span className="text-xl leading-none shrink-0" aria-hidden>ℹ️</span>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--fg-0)' }}>
              Comparative analysis unavailable
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--fg-2)' }}>
              This test has {manual.count} human{manual.count === 1 ? '' : 's'} and {persona.count} persona{persona.count === 1 ? '' : 's'}.
              Cohort agreement, convergence, rating distribution, and paired quality need at least one report on each side —
              those sections are hidden below.
              Submit a {manual.count === 0 ? 'manual report' : 'persona autotest'} against this test to unlock them.
            </p>
          </div>
        </section>
      )}

      {/* ─── Cohort matching ─────────────────────────────────────── */}
      {!singleSide && comparison.by_cohort && comparison.by_cohort.length > 0 && (
        <section className="hf-card p-5">
          <h2 className="font-display font-semibold mb-1">By cohort — demographic-matched agreement</h2>
          <p className="text-xs text-[var(--text-secondary)] mb-4">
            Reports grouped by persona profile (crypto_experience). A tight |Δ| + high agreement
            inside a cohort is the honest &ldquo;persona ≈ human&rdquo; signal — the same demographic on
            both sides.
          </p>
          <CohortBreakdown cohorts={comparison.by_cohort} />
        </section>
      )}

      {/* ─── Cohort × checklist matrix ───────────────────────────── */}
      {!singleSide && comparison.by_cohort_item && comparison.by_cohort_item.length > 0 && (
        <section className="hf-card p-5">
          <h2 className="font-display font-semibold mb-1">Cohort × checklist — who fails what</h2>
          <p className="text-xs text-[var(--text-secondary)] mb-4">
            Per-cohort, per-item fail rates. Cells flag whether a failure is confirmed by both
            sides (real product issue), persona-only (likely persona artifact — tuning target),
            or human-only (persona missed a real problem). Blocked attempts are excluded.
          </p>
          <CohortItemMatrix rows={comparison.by_cohort_item} />
        </section>
      )}

      {/* ─── Convergence ─────────────────────────────────────────── */}
      {!singleSide && (
      <section className="hf-card p-5">
        <h2 className="font-display font-semibold mb-1">Convergence</h2>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          As N grows, |human mean − persona mean| should trend toward 0 if personas are faithful.
        </p>
        {comparison.convergence.length === 0 ? (
          <EmptyNote text="Not enough paired samples yet — run more persona tests against this test_id." />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={comparison.convergence} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis dataKey="n" label={{ value: 'N', position: 'insideBottom', offset: -4 }} stroke="#8a8aa5" />
              <YAxis label={{ value: '|Δ mean|', angle: -90, position: 'insideLeft' }} stroke="#8a8aa5" />
              <Tooltip contentStyle={{ background: '#151528', border: '1px solid #2a2a3a' }} />
              <Line type="monotone" dataKey="absDiff" stroke="#14F195" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>
      )}

      {/* ─── Confusion matrix ───────────────────────────────────── */}
      {!singleSide && (
      <section className="hf-card p-5">
        <h2 className="font-display font-semibold mb-1">Agreement matrix</h2>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          Rows = persona majority, columns = human majority. Counts are per checklist item.
        </p>
        <ConfusionMatrix matrix={comparison.confusion_matrix} />
      </section>
      )}

      {/* ─── Quality score scatter ───────────────────────────────── */}
      {!singleSide && (
      <section className="hf-card p-5">
        <h2 className="font-display font-semibold mb-1">Quality score — paired</h2>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          Each dot = one tester who has both a manual and a persona report. y=x is perfect agreement.
        </p>
        {pairedScatter.length === 0 ? (
          <EmptyNote text="No tester has both a manual and persona report for this test yet." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ScatterChart margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis
                type="number"
                dataKey="human"
                name="Human"
                domain={[0, 5]}
                label={{ value: 'Human quality', position: 'insideBottom', offset: -4 }}
                stroke="#8a8aa5"
              />
              <YAxis
                type="number"
                dataKey="persona"
                name="Persona"
                domain={[0, 5]}
                label={{ value: 'Persona quality', angle: -90, position: 'insideLeft' }}
                stroke="#8a8aa5"
              />
              <ZAxis type="category" dataKey="tester" />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                contentStyle={{ background: '#151528', border: '1px solid #2a2a3a' }}
              />
              <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 5, y: 5 }]} stroke="#9945FF" strokeDasharray="4 4" />
              <Scatter name="paired reports" data={pairedScatter} fill="#14F195" />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </section>
      )}

      {/* ─── Rating distribution histogram ──────────────────────── */}
      {!singleSide && (
      <section className="hf-card p-5">
        <h2 className="font-display font-semibold mb-1">Questionnaire rating distribution</h2>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          First numeric answer per report. KS ={' '}
          <span className="font-mono">{comparison.rating_distribution.ks_statistic.toFixed(3)}</span>{' '}
          (0 = identical distributions).
        </p>
        {ratingHistogram.length === 0 ? (
          <EmptyNote text="No numeric ratings found in any report." />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={ratingHistogram} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
              <XAxis dataKey="rating" stroke="#8a8aa5" />
              <YAxis stroke="#8a8aa5" />
              <Tooltip contentStyle={{ background: '#151528', border: '1px solid #2a2a3a' }} />
              <Legend />
              <Bar dataKey="human" fill="#9945FF" />
              <Bar dataKey="persona" fill="#14F195" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </section>
      )}

      {/* ─── Per-item details (debug / transparency) ─────────────── */}
      <section className="hf-card p-5">
        <h2 className="font-display font-semibold mb-3">Per-item breakdown</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono">
            <thead className="text-xs uppercase text-[var(--text-secondary)]">
              <tr className="border-b border-border-dim">
                <th className="py-2 text-left">item</th>
                <th className="text-left">human majority</th>
                <th className="text-left">persona majority</th>
                <th className="text-left">agree</th>
                <th className="text-left">human votes</th>
                <th className="text-left">persona votes</th>
              </tr>
            </thead>
            <tbody>
              {comparison.item_agreement.map((it) => (
                <tr key={it.itemId} className="border-b border-border-dim/40">
                  <td className="py-2 pr-2">{it.itemId}</td>
                  <td>{it.humanMajority ?? '—'}</td>
                  <td>{it.personaMajority ?? '—'}</td>
                  <td className={it.agree ? 'text-sol-green' : 'text-amber-500'}>
                    {it.agree ? '✓' : '✗'}
                  </td>
                  <td className="text-xs">
                    {it.humanVotes.passed}/{it.humanVotes.failed}/{it.humanVotes.blocked}
                  </td>
                  <td className="text-xs">
                    {it.personaVotes.passed}/{it.personaVotes.failed}/{it.personaVotes.blocked}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-[var(--text-secondary)] mt-3">
          Vote counts: <span className="font-mono">passed/failed/blocked</span>
        </p>
      </section>
    </div>
  );
}

function CohortBreakdown({ cohorts }: { cohorts: CohortMetric[] }) {
  const chartData = cohorts
    .filter((c) => c.qualityAbsDiff !== null)
    .map((c) => ({ cohort: c.cohort, qualityAbsDiff: c.qualityAbsDiff as number }));
  const maxDiff = Math.max(0.01, ...chartData.map((c) => c.qualityAbsDiff));
  const fmt = (v: number | null, digits = 2) => v === null ? '—' : v.toFixed(digits);
  const fmtPct = (v: number | null) => v === null ? '—' : `${Math.round(v * 100)}%`;
  const labelFor = (k: string) => ({
    none: 'No crypto background',
    beginner: 'Crypto beginner',
    intermediate: 'Crypto intermediate',
    advanced: 'Crypto advanced',
    unknown: 'Unknown / no profile',
  } as Record<string, string>)[k] ?? k;

  return (
    <div className="space-y-4">
      {/* Bar chart — visualises mean-quality gap per cohort */}
      <div>
        <div className="text-xs text-[var(--text-secondary)] mb-2 font-mono">
          |human mean − persona mean| (closer to 0 = better match)
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
            <XAxis dataKey="cohort" stroke="#8a8aa5" />
            <YAxis stroke="#8a8aa5" domain={[0, Math.max(2, Math.ceil(maxDiff))]} />
            <Tooltip contentStyle={{ background: '#151528', border: '1px solid #2a2a3a' }} />
            <Bar dataKey="qualityAbsDiff" fill="#14F195" />
          </BarChart>
        </ResponsiveContainer>
        {chartData.length === 0 && (
          <div className="text-xs text-[var(--text-secondary)] italic">
            No cohort has reports on both human and persona sides yet — the |Δ| metric is undefined.
          </div>
        )}
      </div>

      {/* Table — full numbers with context */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-mono">
          <thead className="text-xs uppercase text-[var(--text-secondary)]">
            <tr className="border-b border-border-dim">
              <th className="py-2 text-left">cohort</th>
              <th className="text-right">n (h/p)</th>
              <th className="text-right">human q̄</th>
              <th className="text-right">persona q̄</th>
              <th className="text-right">|Δ|</th>
              <th className="text-right">agreement</th>
              <th className="text-right">quality KS</th>
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => {
              const underpowered = c.humanCount < 3 || c.personaCount < 3;
              const strong = !underpowered
                && c.qualityAbsDiff !== null && c.qualityAbsDiff <= 0.5
                && c.itemAgreementRate !== null && c.itemAgreementRate >= 0.6;
              const deltaColor = c.qualityAbsDiff === null
                ? 'text-[var(--text-secondary)]'
                : c.qualityAbsDiff < 0.5 ? 'text-sol-green'
                : c.qualityAbsDiff > 1.5 ? 'text-amber-500' : '';
              const agreeColor = c.itemAgreementRate !== null && c.itemAgreementRate >= 0.6
                ? 'text-sol-green' : '';
              return (
                <tr
                  key={c.cohort}
                  className={`border-b border-border-dim/40 ${strong ? 'bg-sol-green/5' : ''}`}
                >
                  <td className="py-2 pr-2">
                    <div>{labelFor(c.cohort)}</div>
                    <div className="text-[10px] text-[var(--text-secondary)]">{c.cohort}</div>
                  </td>
                  <td className="text-right">
                    {c.humanCount}/{c.personaCount}
                    {underpowered && (
                      <span className="text-amber-500 ml-1" title="N<3 underpowered">⚠</span>
                    )}
                  </td>
                  <td className="text-right">{fmt(c.humanMeanQuality)}</td>
                  <td className="text-right">{fmt(c.personaMeanQuality)}</td>
                  <td className={`text-right ${deltaColor}`}>{fmt(c.qualityAbsDiff)}</td>
                  <td className={`text-right ${agreeColor}`}>{fmtPct(c.itemAgreementRate)}</td>
                  <td className="text-right">{fmt(c.ksStatisticQuality)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-[10px] text-[var(--text-secondary)] mt-2">
          Rows in green highlight cohorts where persona tracks human closely (|Δ| ≤ 0.5 and
          agreement ≥ 60%). ⚠ marks underpowered cohorts (n&lt;3 on either side).
        </p>
      </div>
    </div>
  );
}

function CohortItemMatrix({ rows }: { rows: CohortItemMetric[] }) {
  // Pivot to grid: unique cohorts (rows) × unique items (columns).
  const cohorts = [...new Set(rows.map((r) => r.cohort))].sort();
  const items = [...new Set(rows.map((r) => r.itemId))].sort();
  const byKey = new Map(rows.map((r) => [`${r.cohort}::${r.itemId}`, r]));

  const flagStyle: Record<CohortItemMetric['flag'], { bg: string; fg: string; label: string }> = {
    'both-fail':     { bg: 'rgba(248, 113, 113, 0.22)', fg: '#fecaca', label: 'both fail' },
    'persona-worse': { bg: 'rgba(251, 191, 36, 0.22)',  fg: '#fde68a', label: 'persona worse' },
    'human-worse':   { bg: 'rgba(96, 165, 250, 0.22)',  fg: '#bfdbfe', label: 'human worse' },
    'both-pass':     { bg: 'rgba(20, 241, 149, 0.18)',  fg: '#bbf7d0', label: 'both pass' },
    'split':         { bg: 'rgba(148, 163, 184, 0.18)', fg: '#cbd5e1', label: 'split' },
    'insufficient':  { bg: 'transparent',               fg: 'var(--text-secondary)', label: 'n<2' },
  };

  return (
    <div className="space-y-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(flagStyle) as Array<CohortItemMetric['flag']>).map((f) => (
          <span
            key={f}
            className="px-2 py-0.5 rounded text-[11px] font-mono"
            style={{ background: flagStyle[f].bg, color: flagStyle[f].fg }}
          >
            {flagStyle[f].label}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono border-separate border-spacing-0">
          <thead>
            <tr className="text-[var(--text-secondary)]">
              <th className="py-2 pr-3 text-left">cohort</th>
              {items.map((it) => (
                <th key={it} className="px-2 py-2 text-center">{it}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c}>
                <td className="py-1.5 pr-3 font-mono">{c}</td>
                {items.map((it) => {
                  const cell = byKey.get(`${c}::${it}`);
                  if (!cell) {
                    return <td key={it} className="px-2 py-1.5 text-center text-[var(--text-secondary)]">—</td>;
                  }
                  const s = flagStyle[cell.flag];
                  const pct = (v: number | null) => v === null ? '—' : `${Math.round(v * 100)}%`;
                  return (
                    <td
                      key={it}
                      className="px-2 py-1.5 text-center rounded"
                      style={{ background: s.bg, color: s.fg }}
                      title={`${cell.cohort} · ${cell.itemId}\nhumans: n=${cell.humanN}, fail=${pct(cell.humanFailRate)}\npersonas: n=${cell.personaN}, fail=${pct(cell.personaFailRate)}\nflag: ${cell.flag}`}
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>{pct(cell.humanFailRate)}</span>
                        <span className="opacity-50">/</span>
                        <span>{pct(cell.personaFailRate)}</span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[10px] text-[var(--text-secondary)] mt-2">
          Cell format: <span className="font-mono">human_fail% / persona_fail%</span>. Hover a cell
          for sample sizes. Cohort column is the <span className="font-mono">crypto_experience</span>
          {' '}key; item column is the checklist id.
        </p>
      </div>
    </div>
  );
}

function downloadJson(testId: string, data: CompareResponse) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `experiment-${testId}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="hf-card p-4">
      <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-mono">
        {label}
      </div>
      <div className="mt-1 t-display-m">{value}</div>
      {sub && <div className="text-[11px] text-[var(--text-secondary)] font-mono mt-0.5">{sub}</div>}
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="text-sm text-[var(--text-secondary)] italic py-6 text-center">{text}</div>
  );
}

function ConfusionMatrix({ matrix }: { matrix: Record<MatrixLabel, Record<MatrixLabel, number>> }) {
  // Find max for color scaling.
  let max = 0;
  for (const r of MATRIX_LABELS) for (const c of MATRIX_LABELS) max = Math.max(max, matrix[r][c]);
  const cellBg = (n: number) => {
    if (max === 0) return 'transparent';
    const t = n / max;
    // interpolate green (sol-green) alpha
    return `rgba(20, 241, 149, ${Math.min(0.08 + t * 0.7, 0.8)})`;
  };
  return (
    <div className="overflow-x-auto">
      <table className="text-sm font-mono">
        <thead>
          <tr>
            <th className="pr-3 text-xs text-[var(--text-secondary)] uppercase">persona \ human</th>
            {MATRIX_LABELS.map((c) => (
              <th key={c} className="px-3 py-1 text-xs text-[var(--text-secondary)] uppercase">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MATRIX_LABELS.map((row) => (
            <tr key={row}>
              <td className="pr-3 text-xs text-[var(--text-secondary)] uppercase font-semibold">
                {row}
              </td>
              {MATRIX_LABELS.map((col) => (
                <td
                  key={col}
                  className="w-16 h-12 text-center border border-border-dim/50 align-middle"
                  style={{ backgroundColor: cellBg(matrix[row][col]) }}
                >
                  {matrix[row][col]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
