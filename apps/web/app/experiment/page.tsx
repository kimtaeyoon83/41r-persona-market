'use client';

/**
 * Experiment index. Lists every test that has at least one report and
 * deep-links to /experiment/[testId] with a tiny preview (N humans, M
 * personas, paired count). Avoids the "memorise the test_id" friction
 * that the initial dashboard required.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { API_BASE } from '@/lib/api';

interface TestSummary {
  id: string;
  targetUrl: string;
  requirements: string | null;
  status: string;
  manualCount: number;
  personaCount: number;
  pairedCount: number;
}

export default function ExperimentIndex() {
  const [tests, setTests] = useState<TestSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const listResp = await fetch(`${API_BASE}/api/tests`).then((r) => r.json());
        const list: Array<{ id: string; targetUrl: string; requirements: string | null; status: string }> =
          Array.isArray(listResp) ? listResp : listResp?.tests ?? [];

        // Fetch per-test compare summaries in parallel. This doubles as a
        // cheap "is there any data here?" filter.
        const summaries = await Promise.all(
          list.map(async (t) => {
            try {
              const c = await fetch(`${API_BASE}/api/reports/compare/${t.id}`);
              if (!c.ok) return null;
              const body = (await c.json()) as {
                manual: { count: number };
                persona: { count: number };
                comparison: { correlation: { paired_count: number } };
              };
              return {
                id: t.id,
                targetUrl: t.targetUrl,
                requirements: t.requirements,
                status: t.status,
                manualCount: body.manual?.count ?? 0,
                personaCount: body.persona?.count ?? 0,
                pairedCount: body.comparison?.correlation?.paired_count ?? 0,
              } satisfies TestSummary;
            } catch {
              return null;
            }
          }),
        );
        setTests(summaries.filter((s): s is TestSummary => s !== null));
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  return (
    <div className="max-w-5xl p-6 space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Experiments</h1>
        <p className="text-sm text-[var(--text-secondary)] mt-1">
          Each test below carries a manual+persona pair. Click to see the full agreement dashboard.
        </p>
      </header>

      {err && <div className="text-red-500 text-sm">Error: {err}</div>}
      {!tests && !err && <div className="text-[var(--text-secondary)]">Loading…</div>}

      {tests && tests.length === 0 && (
        <div className="text-[var(--text-secondary)] italic">
          No tests with comparable reports yet. Run seed-data.ts and run-persona-batch.ts.
        </div>
      )}

      {tests && tests.length > 0 && (
        <div className="space-y-3">
          {tests.map((t) => (
            <Link
              key={t.id}
              href={`/experiment/${t.id}`}
              className="block p-5 rounded-xl border border-border-dim bg-surface hover:border-sol-green/30 hover:bg-surface-elevated transition-all"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-display font-semibold truncate">{t.targetUrl}</div>
                  <div className="text-xs text-[var(--text-secondary)] font-mono mt-0.5 truncate">
                    {t.id}
                  </div>
                  {t.requirements && (
                    <p className="text-sm text-[var(--text-secondary)] mt-2 line-clamp-2">
                      {t.requirements}
                    </p>
                  )}
                </div>
                <div className="flex gap-6 shrink-0 text-right">
                  <Pill label="Humans" value={t.manualCount} />
                  <Pill label="Personas" value={t.personaCount} />
                  <Pill label="Paired" value={t.pairedCount} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Pill({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-display text-xl font-bold">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)] font-mono">
        {label}
      </div>
    </div>
  );
}
