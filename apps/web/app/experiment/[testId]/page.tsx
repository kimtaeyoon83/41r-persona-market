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
  };
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
        <h1 className="font-display text-2xl font-bold mb-4">Experiment Dashboard</h1>
        <div className="text-red-500">Error: {err}</div>
      </div>
    );
  }

  if (!data) {
    return <div className="max-w-5xl p-6">Loading…</div>;
  }

  const { manual, persona, comparison } = data;

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
          <h1 className="font-display text-2xl font-bold">AI Persona vs Human — Agreement Dashboard</h1>
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
        <section className="rounded-xl border border-border-dim bg-surface p-5">
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

      {/* ─── Convergence ─────────────────────────────────────────── */}
      <section className="rounded-xl border border-border-dim bg-surface p-5">
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

      {/* ─── Confusion matrix ───────────────────────────────────── */}
      <section className="rounded-xl border border-border-dim bg-surface p-5">
        <h2 className="font-display font-semibold mb-1">Agreement matrix</h2>
        <p className="text-xs text-[var(--text-secondary)] mb-4">
          Rows = persona majority, columns = human majority. Counts are per checklist item.
        </p>
        <ConfusionMatrix matrix={comparison.confusion_matrix} />
      </section>

      {/* ─── Quality score scatter ───────────────────────────────── */}
      <section className="rounded-xl border border-border-dim bg-surface p-5">
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

      {/* ─── Rating distribution histogram ──────────────────────── */}
      <section className="rounded-xl border border-border-dim bg-surface p-5">
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

      {/* ─── Per-item details (debug / transparency) ─────────────── */}
      <section className="rounded-xl border border-border-dim bg-surface p-5">
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
    <div className="rounded-xl border border-border-dim bg-surface p-4">
      <div className="text-xs uppercase tracking-wider text-[var(--text-secondary)] font-mono">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-bold">{value}</div>
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
