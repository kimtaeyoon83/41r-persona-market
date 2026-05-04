"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { reportApi, testApi, API_BASE } from "@/lib/api";
import { LoadingSpinner } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";
import Link from "next/link";

interface ChecklistResult {
  id: string;
  status: "passed" | "failed" | "blocked";
  memo: string;
}

interface Report {
  id: string;
  testerAddr: string;
  testId: string;
  checklistResults: ChecklistResult[];
  scenarioLog: Array<{ id: string; timeline: Array<{ time: string; action: string }> }>;
  questionnaireAnswers: Array<{ id: string; answer: string | number }>;
  qualityScore: number | null;
  isPersonaTest: boolean;
  screenshots: string[];
  createdAt: string;
}

interface CompareData {
  test_id: string;
  manual: {
    count: number;
    reports: Report[];
    avg_quality: number;
    issues: { passed: number; failed: number; blocked: number };
  };
  persona: {
    count: number;
    reports: Report[];
    avg_quality: number;
    issues: { passed: number; failed: number; blocked: number };
  };
}

export default function CompareReportsPage() {
  const params = useParams();
  const testId = params.testId as string;
  const [data, setData] = useState<CompareData | null>(null);
  const [testUrl, setTestUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = () => {
    if (!testId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      reportApi.compare(testId) as Promise<CompareData>,
      testApi.get(testId) as Promise<{ test: { targetUrl: string } }>,
    ])
      .then(([compareData, testData]) => {
        setData(compareData);
        setTestUrl(testData.test?.targetUrl || "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load comparison data"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId]);

  if (loading) return <LoadingSpinner text="Loading comparison..." />;
  if (error) return <ErrorDisplay message={error} onRetry={loadData} />;
  if (!data) return <ErrorDisplay message="No comparison data available" />;

  const manualReport = data.manual.reports[0];
  const personaReport = data.persona.reports[0];

  const personaActions = personaReport?.scenarioLog?.flatMap(s => s.timeline.map(t => t.action)) || [];
  const manualActions = manualReport?.scenarioLog?.flatMap(s => s.timeline.map(t => t.action)) || [];

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <Link href={`/company/test/${testId}`} className="t-caption hover:text-[var(--fg-0)] mb-2 inline-block transition-colors">
          ← Back to Test
        </Link>
        <h1 className="t-display-m mb-1">Manual vs AI Persona Report</h1>
        <p className="addr">{testUrl}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        {[
          { label: "Manual", data: data.manual, variant: "info" as const, toneSet: ["text-sol-blue", "text-[var(--info)]"] },
          { label: "AI Persona", data: data.persona, variant: "success" as const, toneSet: ["text-sol-green", "text-[var(--success)]"] },
        ].map((panel) => (
          <div key={panel.label} className="hf-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <span className={`chip ${panel.variant}`}>{panel.label}</span>
              <span className="t-caption">{panel.data.count} report(s)</span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <div className="t-label">Quality</div>
                <p className={`money text-2xl font-semibold mt-1 ${panel.data.avg_quality >= 4 ? "text-sol-green" : panel.data.avg_quality >= 3 ? "text-[var(--warn)]" : "text-[var(--danger)]"}`}>
                  {panel.data.avg_quality.toFixed(1)}
                </p>
              </div>
              <div className="text-center">
                <div className="t-label">Passed</div>
                <p className="money text-2xl font-semibold mt-1 text-sol-green">{panel.data.issues.passed}</p>
              </div>
              <div className="text-center">
                <div className="t-label">Issues</div>
                <p className="money text-2xl font-semibold mt-1 text-[var(--danger)]">{panel.data.issues.failed + panel.data.issues.blocked}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(manualReport || personaReport) && (() => {
        // Pair checklist items by id to show agreement at a glance.
        const manualById = new Map((manualReport?.checklistResults || []).map((c) => [c.id, c]));
        const personaById = new Map((personaReport?.checklistResults || []).map((c) => [c.id, c]));
        const allIds = Array.from(new Set([...manualById.keys(), ...personaById.keys()]));
        const pairs = allIds.map((id) => {
          const m = manualById.get(id);
          const p = personaById.get(id);
          const agree = m && p && m.status === p.status;
          const disagree = m && p && m.status !== p.status;
          return { id, m, p, agree, disagree };
        });
        const agreeCount = pairs.filter((x) => x.agree).length;
        const disagreeCount = pairs.filter((x) => x.disagree).length;
        const pairedCount = pairs.filter((x) => x.m && x.p).length;

        const statusPill = (status?: string) => {
          if (!status) return <span className="text-[10px] font-mono text-[var(--text-tertiary)]">—</span>;
          const cls = status === 'passed' ? 'text-sol-green bg-sol-green/10'
            : status === 'failed' ? 'text-[var(--status-error)] bg-[var(--status-error)]/10'
            : 'text-[var(--status-warning)] bg-[var(--status-warning)]/10';
          return <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium ${cls}`}>{status}</span>;
        };

        return (
          <div className="mb-8">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="t-display-s">Checklist — agreement</h2>
              {pairedCount > 0 && (
                <span className="text-xs font-mono text-[var(--text-tertiary)]">
                  <span className="text-sol-green">{agreeCount} agree</span>
                  {' · '}
                  <span className="text-[var(--status-error)]">{disagreeCount} disagree</span>
                  {' · '}
                  {pairedCount} paired
                </span>
              )}
            </div>
            <div className="hf-card overflow-hidden">
              <div className="grid grid-cols-[80px_1fr_1fr] gap-px bg-border-dim text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                <div className="bg-surface px-3 py-2">Item</div>
                <div className="bg-surface px-3 py-2">Manual</div>
                <div className="bg-surface px-3 py-2">AI Persona</div>
              </div>
              <div className="divide-y divide-border-dim">
                {pairs.map((row) => {
                  const bg = row.agree ? 'bg-sol-green/5' : row.disagree ? 'bg-[var(--status-error)]/5' : 'bg-surface';
                  return (
                    <div key={row.id} className={`grid grid-cols-[80px_1fr_1fr] gap-0 items-start ${bg}`}>
                      <div className="px-3 py-2 text-[10px] font-mono text-[var(--text-tertiary)] border-r border-border-dim">{row.id}</div>
                      <div className="px-3 py-2 space-y-1 border-r border-border-dim">
                        {statusPill(row.m?.status)}
                        {row.m?.memo && <p className="text-xs text-[var(--text-secondary)] leading-snug">{row.m.memo}</p>}
                      </div>
                      <div className="px-3 py-2 space-y-1">
                        {statusPill(row.p?.status)}
                        {row.p?.memo && <p className="text-xs text-[var(--text-secondary)] leading-snug">{row.p.memo}</p>}
                      </div>
                    </div>
                  );
                })}
                {pairs.length === 0 && (
                  <div className="px-3 py-4 text-xs text-[var(--text-tertiary)]">No checklist items recorded yet.</div>
                )}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
              Rows are tinted when both sides reported the same item: green if they agree on pass/fail/blocked, pink if they disagree.
            </p>
          </div>
        );
      })()}

      {(manualActions.length > 0 || personaActions.length > 0) && (
        <div className="mb-8">
          <h2 className="t-display-s mb-4">Action Timeline</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-sol-blue mb-2 font-mono font-medium">Manual Tester ({manualActions.length} actions)</p>
              <div className="space-y-1 border-l-2 border-sol-blue/20 pl-3">
                {manualActions.map((action, i) => (
                  <p key={i} className="text-xs text-[var(--text-secondary)]">{action}</p>
                ))}
                {manualActions.length === 0 && <p className="text-xs text-[var(--text-tertiary)]">No actions recorded</p>}
              </div>
            </div>

            <div>
              <p className="text-xs text-sol-green mb-2 font-mono font-medium">AI Persona ({personaActions.length} actions)</p>
              <div className="space-y-1 border-l-2 border-sol-green/20 pl-3">
                {personaActions.map((action, i) => (
                  <p key={i} className="text-xs text-[var(--text-secondary)]">{action}</p>
                ))}
                {personaActions.length === 0 && <p className="text-xs text-[var(--text-tertiary)]">No actions recorded</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {(manualReport?.screenshots?.length > 0 || personaReport?.screenshots?.length > 0) && (
        <div className="mb-8">
          <h2 className="t-display-s mb-4">Screenshots</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-sol-blue mb-2 font-mono font-medium">Manual</p>
              <div className="space-y-2">
                {manualReport?.screenshots?.map((ss, i) => (
                  <img
                    key={i}
                    src={`${API_BASE}/screenshots/${ss}`}
                    alt={`Manual screenshot ${i + 1}`}
                    className="w-full rounded-lg border border-border-dim"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )) || <p className="text-xs text-[var(--text-tertiary)]">No screenshots</p>}
              </div>
            </div>
            <div>
              <p className="text-xs text-sol-green mb-2 font-mono font-medium">AI Persona</p>
              <div className="space-y-2">
                {personaReport?.screenshots?.slice(0, 4).map((ss, i) => (
                  <img
                    key={i}
                    src={`${API_BASE}/screenshots/${ss}`}
                    alt={`Persona screenshot ${i + 1}`}
                    className="w-full rounded-lg border border-border-dim"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )) || <p className="text-xs text-[var(--text-tertiary)]">No screenshots</p>}
                {(personaReport?.screenshots?.length || 0) > 4 && (
                  <p className="text-xs text-[var(--text-tertiary)] text-center">
                    +{(personaReport?.screenshots?.length || 0) - 4} more screenshots
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-4 text-sm">
        {manualReport && (
          <Link href={`/report/${manualReport.id}`} className="text-sol-blue hover:text-sol-blue/80 transition-colors">
            View Manual Report &rarr;
          </Link>
        )}
        {personaReport && (
          <Link href={`/report/${personaReport.id}`} className="text-sol-green hover:text-sol-green/80 transition-colors">
            View AI Persona Report &rarr;
          </Link>
        )}
      </div>
    </div>
  );
}
