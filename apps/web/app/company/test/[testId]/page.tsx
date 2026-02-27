"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { testApi, reportApi } from "@/lib/api";
import { LoadingSpinner } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";

interface TestDetail {
  test: {
    id: string;
    targetUrl: string;
    requirements: string;
    budgetUsdc: number;
    status: string;
    createdAt: string;
  };
  test_cases: {
    checklist: Array<{ id: string; task: string; expected: string }>;
    scenarios: Array<{ id: string; persona_type: string; narrative: string }>;
    questionnaire: Array<{ id: string; question: string; type: string }>;
  };
}

export default function TestDetailPage() {
  const params = useParams();
  const testId = params.testId as string;
  const [data, setData] = useState<TestDetail | null>(null);
  const [reports, setReports] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = () => {
    if (!testId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      testApi.get(testId) as Promise<TestDetail>,
      reportApi.byTest(testId) as Promise<Array<Record<string, unknown>>>,
    ])
      .then(([testData, reportData]) => {
        setData(testData);
        setReports(reportData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load test details"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId]);

  if (loading) return <LoadingSpinner text="Loading test details..." />;
  if (error) return <ErrorDisplay message={error} onRetry={loadData} />;
  if (!data) return <ErrorDisplay message="Test not found" />;

  const { test, test_cases } = data;

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="font-display text-2xl font-bold">Test Details</h1>
          <span className={`px-2 py-0.5 rounded-md text-[11px] font-mono ${
            test.status === 'active' ? 'bg-sol-green/10 text-sol-green border border-sol-green/20' : 'bg-surface-elevated text-[var(--text-tertiary)] border border-border-dim'
          }`}>
            {test.status}
          </span>
        </div>
        <p className="text-[var(--text-secondary)] font-mono text-sm">{test.targetUrl}</p>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Budget</p>
          <p className="text-lg font-display font-semibold mt-1">${test.budgetUsdc} USDC</p>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Reports</p>
          <p className="text-lg font-display font-semibold mt-1">{reports.length}</p>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Total Paid</p>
          <p className="text-lg font-display font-semibold mt-1 text-sol-green">
            {reports.reduce((sum, r) => {
              const ss = ((r.settlements || []) as Array<{ amountToken?: number; settlementType?: string }>);
              const usdcTotal = ss.filter(s => s.settlementType !== '41r').reduce((a, s) => a + (s.amountToken || 0), 0);
              return sum + usdcTotal;
            }, 0).toFixed(1)}
            <span className="text-xs text-[var(--text-tertiary)] ml-1">USDC</span>
          </p>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Created</p>
          <p className="text-sm mt-1">{new Date(test.createdAt).toLocaleDateString()}</p>
        </div>
      </div>

      {reports.filter(r => Number(r.qualityScore) >= 1.5).some(r => r.isPersonaTest) && reports.filter(r => Number(r.qualityScore) >= 1.5).some(r => !r.isPersonaTest) && (
        <a
          href={`/company/test/${testId}/compare`}
          className="block mb-6 p-4 rounded-xl border border-dashed border-sol-green/30 bg-sol-green/5 hover:bg-sol-green/8 transition-colors text-center"
        >
          <p className="text-sm font-medium text-sol-green">Compare Manual vs AI Persona Reports</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">Side-by-side analysis of human tester and AI persona findings</p>
        </a>
      )}

      {reports.length > 0 && (
        <div className="mb-8">
          <h2 className="font-display text-lg font-semibold mb-3">Submitted Reports</h2>
          <div className="space-y-2">
            {reports.map((r) => {
              const rSettlements = (r.settlements || []) as Array<{ amountToken?: number; settlementType?: string; txSignature?: string }>;
              const rejected = Number(r.qualityScore) < 1.5;
              return (
                <a
                  key={String(r.id)}
                  href={`/report/${r.id}`}
                  className={`block p-3 rounded-xl border transition-colors ${
                    rejected
                      ? 'bg-[var(--status-error)]/5 border-[var(--status-error)]/15 opacity-60 hover:opacity-80'
                      : 'bg-surface border-border-dim hover:border-border-hover'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {rejected ? (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-[var(--status-error)]/10 text-[var(--status-error)] border border-[var(--status-error)]/20">
                          Rejected
                        </span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded-md text-[11px] font-mono ${
                          r.isPersonaTest ? 'bg-sol-green/10 text-sol-green border border-sol-green/20' : 'bg-sol-blue/10 text-sol-blue border border-sol-blue/20'
                        }`}>
                          {r.isPersonaTest ? 'AI Persona' : 'Manual'}
                        </span>
                      )}
                      <span className="text-sm text-[var(--text-secondary)] font-mono">{String(r.testerAddr).slice(0, 16)}...</span>
                    </div>
                    <div className="flex items-center gap-4">
                      {!rejected && rSettlements.length > 0 && (
                        <span className="flex items-center gap-2 text-xs font-mono">
                          {rSettlements.map((s, si) => (
                            <span key={si} className={`flex items-center gap-1 ${s.settlementType === '41r' ? 'text-sol-purple' : 'text-sol-green'}`}>
                              <span className="font-medium">
                                {s.amountToken} {s.settlementType === '41r' ? '41R' : 'USDC'}
                              </span>
                            </span>
                          ))}
                        </span>
                      )}
                      {rejected && (
                        <span className="text-xs text-[var(--status-error)]">No reward</span>
                      )}
                      <span className={`text-sm font-semibold ${
                        Number(r.qualityScore) >= 4 ? 'text-sol-green' :
                        Number(r.qualityScore) >= 3 ? 'text-[var(--status-warning)]' : 'text-[var(--status-error)]'
                      }`}>
                        {Number(r.qualityScore).toFixed(1)}
                      </span>
                      <span className="text-xs text-[var(--text-tertiary)]">{new Date(String(r.createdAt)).toLocaleDateString()}</span>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {test.requirements && (
        <div className="mb-8 p-4 rounded-xl bg-surface border border-border-dim">
          <h2 className="text-sm font-mono text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Requirements</h2>
          <p className="text-sm text-[var(--text-primary)]">{test.requirements}</p>
        </div>
      )}

      <div className="space-y-6">
        <div>
          <h2 className="font-display text-lg font-semibold mb-3">Checklist ({test_cases.checklist?.length || 0})</h2>
          <div className="space-y-2">
            {test_cases.checklist?.map((item) => (
              <div key={item.id} className="p-3 rounded-xl bg-surface border border-border-dim flex gap-3">
                <span className="text-xs font-mono text-sol-purple mt-0.5">{item.id}</span>
                <div>
                  <p className="text-sm text-[var(--text-primary)]">{item.task}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">Expected: {item.expected}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">Scenarios ({test_cases.scenarios?.length || 0})</h2>
          <div className="space-y-2">
            {test_cases.scenarios?.map((item) => (
              <div key={item.id} className="p-3 rounded-xl bg-surface border border-border-dim">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-sol-blue">{item.id}</span>
                  <span className="text-xs text-[var(--text-tertiary)]">{item.persona_type}</span>
                </div>
                <p className="text-sm text-[var(--text-primary)]">{item.narrative}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="font-display text-lg font-semibold mb-3">Questionnaire ({test_cases.questionnaire?.length || 0})</h2>
          <div className="space-y-2">
            {test_cases.questionnaire?.map((item) => (
              <div key={item.id} className="p-3 rounded-xl bg-surface border border-border-dim flex gap-3">
                <span className="text-xs font-mono text-sol-green mt-0.5">{item.id}</span>
                <div>
                  <p className="text-sm text-[var(--text-primary)]">{item.question}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">Type: {item.type}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
