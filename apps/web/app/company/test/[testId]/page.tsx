"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { testApi, reportApi } from "@/lib/api";
import { LoadingSpinner } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";
import { VarTabs } from "@/components/var-tabs";
import { useWalletContext } from "@/components/wallet-provider";

interface TestDetail {
  test: {
    id: string;
    targetUrl: string;
    requirements: string;
    budgetUsdc: number;
    status: string;
    createdAt: string;
    companyAddr?: string;
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
  // Tab default: 0 (Reports) normally, 2 (Test cases) when there are no reports
  // yet — otherwise the page looks empty for a freshly-registered test.
  const [tab, setTab] = useState(0);
  const [userPickedTab, setUserPickedTab] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const [retryIncludeSessionLimited, setRetryIncludeSessionLimited] = useState(false);
  const [diagnosis, setDiagnosis] = useState<{
    markdown: string | null;
    generatedAt: string | null;
    generatedForReportCount: number | null;
    currentReportCount: number;
    stale: boolean;
  } | null>(null);
  const [diagnosing, setDiagnosing] = useState(false);
  const [diagnosisMsg, setDiagnosisMsg] = useState<string | null>(null);
  const { publicKey, signMessage } = useWalletContext();

  const loadData = () => {
    if (!testId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      testApi.get(testId) as Promise<TestDetail>,
      reportApi.byTest(testId) as Promise<Array<Record<string, unknown>>>,
      testApi.getDiagnosis(testId).catch(() => null) as Promise<{
        markdown: string | null;
        generated_at: string | null;
        generated_for_report_count: number | null;
        current_report_count: number;
        stale: boolean;
      } | null>,
    ])
      .then(([testData, reportData, diagResp]) => {
        setData(testData);
        setReports(reportData);
        if (diagResp) {
          setDiagnosis({
            markdown: diagResp.markdown,
            generatedAt: diagResp.generated_at,
            generatedForReportCount: diagResp.generated_for_report_count,
            currentReportCount: diagResp.current_report_count,
            stale: diagResp.stale,
          });
        }
        if (!userPickedTab && reportData.length === 0) {
          setTab(2); // Test cases
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load test details"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testId]);

  async function handleRetryAutotest() {
    if (!publicKey || !signMessage || !data) return;
    setRetrying(true);
    setRetryMsg(null);
    try {
      const result = await testApi.retryAutotest(
        testId,
        {
          company_wallet: publicKey,
          force_retry_low_quality: retryIncludeSessionLimited,
        },
        signMessage,
      ) as {
        queued: number;
        skipped_existing: number;
        deleted_low_quality?: number;
        message?: string;
      };
      const deletedNote = (result.deleted_low_quality ?? 0) > 0
        ? ` ${result.deleted_low_quality} session-limited report${result.deleted_low_quality! > 1 ? 's' : ''} cleared.`
        : '';
      if (result.queued > 0) {
        setRetryMsg(
          `Queued ${result.queued} persona run${result.queued > 1 ? 's' : ''}. ` +
          `Reports will appear in 3-10 minutes.` +
          deletedNote +
          (result.skipped_existing > 0 ? ` (${result.skipped_existing} already complete.)` : ''),
        );
      } else {
        setRetryMsg((result.message ?? 'All matched personas already have reports.') + deletedNote);
      }
      // Reload reports so the UI reflects the deletions / new queue state.
      loadData();
    } catch (err) {
      setRetryMsg(`Retry failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setRetrying(false);
    }
  }

  const canRetry =
    !!publicKey &&
    !!data &&
    (data.test.companyAddr ? data.test.companyAddr === publicKey : true);

  async function handleGenerateDiagnosis() {
    if (!publicKey || !signMessage || !data) return;
    setDiagnosing(true);
    setDiagnosisMsg(null);
    try {
      const result = await testApi.generateDiagnosis(
        testId,
        { company_wallet: publicKey },
        signMessage,
      ) as {
        markdown: string;
        generated_at: string;
        generated_for_report_count: number;
      };
      setDiagnosis({
        markdown: result.markdown,
        generatedAt: result.generated_at,
        generatedForReportCount: result.generated_for_report_count,
        currentReportCount: reports.length,
        stale: false,
      });
      setDiagnosisMsg('Final diagnosis ready.');
    } catch (err) {
      setDiagnosisMsg(`Generation failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setDiagnosing(false);
    }
  }

  if (loading) return <LoadingSpinner text="Loading test details..." />;
  if (error) return <ErrorDisplay message={error} onRetry={loadData} />;
  if (!data) return <ErrorDisplay message="Test not found" />;

  const { test, test_cases } = data;

  return (
    <div className="max-w-4xl">
      <div className="mb-7">
        <div className="flex items-center gap-2 mb-2">
          <h1 className="t-display-m">Test Details</h1>
          <span className={`chip ${test.status === 'active' ? 'success' : ''}`}>
            {test.status === 'active' && <span className="chip-dot" />}
            {test.status}
          </span>
        </div>
        <p className="addr">{test.targetUrl}</p>
      </div>

      <div className="grid grid-cols-5 gap-4 mb-8">
        <div className="hf-card p-4">
          <div className="t-label">Budget</div>
          <p className="money text-lg font-semibold mt-1">${test.budgetUsdc} <span className="text-[11px] text-[var(--fg-3)] font-normal">USDC</span></p>
        </div>
        <div className="hf-card p-4">
          <div className="t-label">Reports</div>
          <p className="money text-lg font-semibold mt-1">{reports.length}</p>
        </div>
        <div className="hf-card p-4">
          <div className="t-label">Avg Quality</div>
          {(() => {
            const scored = reports.filter(r => typeof r.qualityScore === 'number');
            if (scored.length === 0) {
              return <p className="money text-lg font-semibold mt-1 text-[var(--fg-3)]">—</p>;
            }
            const avg = scored.reduce((a, r) => a + Number(r.qualityScore), 0) / scored.length;
            const tone = avg >= 4 ? 'text-sol-green' : avg >= 3 ? 'text-[var(--warn)]' : 'text-[var(--danger)]';
            return (
              <p className={`money text-lg font-semibold mt-1 ${tone}`}>{avg.toFixed(1)}<span className="text-[11px] text-[var(--fg-3)] ml-1 font-normal">/ 5</span></p>
            );
          })()}
        </div>
        <div className="hf-card p-4">
          <div className="t-label">Total Paid</div>
          <p className="money text-lg font-semibold mt-1 text-sol-green">
            {reports.reduce((sum, r) => {
              const ss = ((r.settlements || []) as Array<{ amountToken?: number; settlementType?: string }>);
              const usdcTotal = ss.filter(s => s.settlementType !== '41r').reduce((a, s) => a + (s.amountToken || 0), 0);
              return sum + usdcTotal;
            }, 0).toFixed(1)}
            <span className="text-[11px] text-[var(--fg-3)] ml-1 font-normal">USDC</span>
          </p>
        </div>
        <div className="hf-card p-4">
          <div className="t-label">Created</div>
          <p className="t-body mt-1">{new Date(test.createdAt).toLocaleDateString()}</p>
        </div>
      </div>

      {canRetry && (() => {
        const sessionLimited = reports.filter(
          (r) => r.isPersonaTest && Number(r.qualityScore) < 1.5,
        ).length;
        return (
          <div className="mb-6 hf-card p-4 flex items-start justify-between gap-4">
            <div>
              <p className="t-body-s font-medium">Re-run auto-test personas</p>
              <p className="t-caption mt-0.5">
                Personas that already have a report for this test are skipped.
                Use this when a previous run got stuck on a redirect wall or timed out.
              </p>
              {sessionLimited > 0 && (
                <label className="flex items-center gap-2 mt-2 t-caption cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={retryIncludeSessionLimited}
                    onChange={(e) => setRetryIncludeSessionLimited(e.target.checked)}
                    className="w-3.5 h-3.5 accent-sol-blue"
                  />
                  <span>
                    Include {sessionLimited} session-limited report{sessionLimited > 1 ? 's' : ''}
                    {' '}
                    <span className="text-[var(--fg-3)]">(old rows will be cleared)</span>
                  </span>
                </label>
              )}
              {retryMsg && <p className="t-caption mt-1 text-sol-blue">{retryMsg}</p>}
            </div>
            <button
              onClick={handleRetryAutotest}
              disabled={retrying}
              className="hf-btn sm shrink-0"
            >
              {retrying ? 'Queuing...' : 'Retry auto-test'}
            </button>
          </div>
        );
      })()}

      {reports.filter(r => Number(r.qualityScore) >= 1.5).some(r => r.isPersonaTest) && reports.filter(r => Number(r.qualityScore) >= 1.5).some(r => !r.isPersonaTest) && (
        <a
          href={`/company/test/${testId}/compare`}
          className="block mb-6 p-4 rounded-xl border border-dashed border-sol-green/30 bg-sol-green/5 hover:bg-sol-green/8 transition-colors text-center"
        >
          <p className="text-sm font-medium text-sol-green">Compare Manual vs AI Persona Reports</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">Side-by-side analysis of human tester and AI persona findings</p>
        </a>
      )}

      <div className="mb-5">
        <VarTabs
          variants={["Reports", "Issues", "Test cases", "Diagnosis"]}
          active={tab}
          onChange={(next) => { setUserPickedTab(true); setTab(next); }}
        />
      </div>

      {tab === 0 && reports.length === 0 && (
        <div className="hf-card p-6 text-center mb-8">
          <p className="t-body-s text-[var(--fg-1)] mb-1">No reports submitted yet.</p>
          <p className="t-caption">
            Once testers submit reports, they&rsquo;ll appear here.
            {" "}Preview the auto-generated test cases on the{" "}
            <button
              onClick={() => { setUserPickedTab(true); setTab(2); }}
              className="text-sol-blue hover:underline"
            >
              Test cases
            </button> tab.
          </p>
        </div>
      )}

      {tab === 1 && (() => {
        type CheckTally = { id: string; task: string; failed: number; blocked: number };
        const taskById = new Map<string, string>();
        for (const c of test_cases.checklist || []) taskById.set(c.id, c.task);
        const tally = new Map<string, CheckTally>();
        for (const r of reports) {
          const items = (r.checklistResults as Array<{ id: string; status: string }> | null) || [];
          for (const it of items) {
            if (!tally.has(it.id)) {
              tally.set(it.id, { id: it.id, task: taskById.get(it.id) ?? it.id, failed: 0, blocked: 0 });
            }
            const t = tally.get(it.id)!;
            if (it.status === 'failed') t.failed += 1;
            else if (it.status === 'blocked') t.blocked += 1;
          }
        }
        const critical: CheckTally[] = [];
        const medium: CheckTally[] = [];
        const nits: CheckTally[] = [];
        for (const t of tally.values()) {
          if (t.failed >= 2) critical.push(t);
          else if (t.failed === 1 || t.blocked >= 2) medium.push(t);
          else if (t.blocked === 1) nits.push(t);
        }
        // Low-rating questionnaire answers (numeric, <= 2 on any scale up to 5) become Medium signals
        const lowRatings: string[] = [];
        for (const r of reports) {
          const qa = (r.questionnaireAnswers as Array<{ id: string; answer: string | number }> | null) || [];
          for (const a of qa) {
            if (typeof a.answer === 'number' && a.answer > 0 && a.answer <= 2) {
              lowRatings.push(a.id);
            }
          }
        }

        const hasAny = critical.length + medium.length + nits.length + lowRatings.length > 0;
        if (!hasAny) return null;

        return (
          <div className="mb-8">
            <h2 className="t-display-s mb-3">Issues by severity</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-4 rounded-xl border border-[var(--status-error)]/25 bg-[var(--status-error)]/5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--status-error)]" />
                  <h3 className="text-sm font-display font-semibold text-[var(--status-error)]">Critical ({critical.length})</h3>
                </div>
                {critical.length === 0 && <p className="text-xs text-[var(--text-tertiary)]">No items failed by multiple testers.</p>}
                <ul className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                  {critical.map((t) => (
                    <li key={t.id}>
                      <span className="font-mono text-[var(--text-tertiary)]">{t.id}</span> {t.task}
                      <span className="ml-1 text-[var(--status-error)]">· failed ×{t.failed}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-4 rounded-xl border border-[var(--status-warning)]/25 bg-[var(--status-warning)]/5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-[var(--status-warning)]" />
                  <h3 className="text-sm font-display font-semibold text-[var(--status-warning)]">Medium ({medium.length + lowRatings.length})</h3>
                </div>
                {medium.length + lowRatings.length === 0 && <p className="text-xs text-[var(--text-tertiary)]">No medium-severity signals.</p>}
                <ul className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                  {medium.map((t) => (
                    <li key={t.id}>
                      <span className="font-mono text-[var(--text-tertiary)]">{t.id}</span> {t.task}
                      <span className="ml-1 text-[var(--status-warning)]">· failed ×{t.failed} · blocked ×{t.blocked}</span>
                    </li>
                  ))}
                  {lowRatings.length > 0 && (
                    <li className="text-[var(--text-tertiary)]">+ {lowRatings.length} low rating{lowRatings.length === 1 ? '' : 's'} (≤ 2)</li>
                  )}
                </ul>
              </div>
              <div className="p-4 rounded-xl border border-sol-green/20 bg-sol-green/5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-sol-green" />
                  <h3 className="text-sm font-display font-semibold text-sol-green">Nits ({nits.length})</h3>
                </div>
                {nits.length === 0 && <p className="text-xs text-[var(--text-tertiary)]">Nothing minor either.</p>}
                <ul className="space-y-1.5 text-xs text-[var(--text-secondary)]">
                  {nits.map((t) => (
                    <li key={t.id}>
                      <span className="font-mono text-[var(--text-tertiary)]">{t.id}</span> {t.task}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })()}

      {tab === 0 && reports.length > 0 && (
        <div className="mb-8">
          <h2 className="t-display-s mb-3">Submitted Reports</h2>
          <div className="space-y-2">
            {reports.map((r) => {
              const rSettlements = (r.settlements || []) as Array<{ amountToken?: number; settlementType?: string; txSignature?: string }>;
              const lowCoverage = Number(r.qualityScore) < 1.5;
              // Persona runs hit the low-coverage bucket when the browser
              // session gets cut short (patience_exceeded on a hard SPA,
              // signin wall, etc.) — not because the persona itself is
              // bad. Label them accordingly so the company can tell
              // "the site was hard to drive" from "the tester phoned it in".
              const lowCoverageLabel = r.isPersonaTest ? 'Session limited' : 'Low coverage';
              const lowCoverageHint = r.isPersonaTest
                ? 'Session cut short — site was hard to navigate'
                : 'Below reward threshold';
              return (
                <a
                  key={String(r.id)}
                  href={`/report/${r.id}`}
                  className={`hf-card block p-3 transition-colors hover:border-[var(--line-2)] ${lowCoverage ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      {lowCoverage ? (
                        <span className="chip warn">{lowCoverageLabel}</span>
                      ) : (
                        <span className={`chip ${r.isPersonaTest ? 'success' : 'info'}`}>
                          {r.isPersonaTest ? 'AI Persona' : 'Manual'}
                        </span>
                      )}
                      <span className="addr">{String(r.testerAddr).slice(0, 16)}…</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {!lowCoverage && rSettlements.length > 0 && (
                        <span className="flex items-center gap-2">
                          {rSettlements.map((s, si) => (
                            <span key={si} className={`money text-[12px] ${s.settlementType === '41r' ? 'text-sol-purple' : 'text-sol-green'}`}>
                              {s.amountToken} {s.settlementType === '41r' ? '41R' : 'USDC'}
                            </span>
                          ))}
                        </span>
                      )}
                      {lowCoverage && <span className="t-caption text-[var(--warn)]" title={lowCoverageHint}>Not rewarded</span>}
                      <span className={`money text-[13px] font-semibold ${
                        Number(r.qualityScore) >= 4 ? 'text-sol-green' :
                        Number(r.qualityScore) >= 3 ? 'text-[var(--warn)]' : 'text-[var(--danger)]'
                      }`}>
                        {Number(r.qualityScore).toFixed(1)}
                      </span>
                      <span className="addr">{new Date(String(r.createdAt)).toLocaleDateString()}</span>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {test.requirements && (
        <div className="mb-8 hf-card p-4">
          <div className="t-label mb-2">Requirements</div>
          <p className="t-body">{test.requirements}</p>
        </div>
      )}

      <div className={`space-y-6 ${tab === 2 ? '' : 'hidden'}`}>
        <div>
          <h2 className="t-display-s mb-3">Checklist ({test_cases.checklist?.length || 0})</h2>
          <div className="space-y-2">
            {test_cases.checklist?.map((item) => (
              <div key={item.id} className="hf-card p-3 flex gap-3">
                <span className="addr text-sol-purple mt-0.5">{item.id}</span>
                <div>
                  <p className="t-body">{item.task}</p>
                  <p className="t-caption mt-1">Expected: {item.expected}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="t-display-s mb-3">Scenarios ({test_cases.scenarios?.length || 0})</h2>
          <div className="space-y-2">
            {test_cases.scenarios?.map((item) => (
              <div key={item.id} className="hf-card p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="addr text-sol-blue">{item.id}</span>
                  <span className="t-caption">{item.persona_type}</span>
                </div>
                <p className="t-body">{item.narrative}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="t-display-s mb-3">Questionnaire ({test_cases.questionnaire?.length || 0})</h2>
          <div className="space-y-2">
            {test_cases.questionnaire?.map((item) => (
              <div key={item.id} className="hf-card p-3 flex gap-3">
                <span className="addr text-sol-green mt-0.5">{item.id}</span>
                <div>
                  <p className="t-body">{item.question}</p>
                  <p className="t-caption mt-1">Type: {item.type}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={`space-y-4 ${tab === 3 ? '' : 'hidden'}`}>
        {reports.length < 3 ? (
          <div className="hf-card p-6 text-center">
            <p className="t-body-s text-[var(--fg-1)] mb-1">
              Need at least 3 reports before a synthesis report can be generated.
            </p>
            <p className="t-caption">
              Current: {reports.length} / 3. Persona auto-runs and human submissions both count.
            </p>
          </div>
        ) : (
          <>
            <div className="hf-card p-4 flex items-start justify-between gap-4">
              <div>
                <p className="t-body-s font-medium">UX Diagnosis</p>
                <p className="t-caption mt-0.5">
                  Consolidates {reports.length} reports into a single UX diagnosis —
                  key verdict, top friction points, and prioritized recommendations.
                  Generation takes 30-60 seconds.
                </p>
                {diagnosis?.generatedAt && (
                  <p className="t-caption mt-1">
                    {diagnosis.stale ? (
                      <span className="text-[var(--warn)]">
                        Last generated{' '}
                        {new Date(diagnosis.generatedAt).toLocaleString()}
                        {' '}from {diagnosis.generatedForReportCount} reports —
                        {' '}{reports.length - (diagnosis.generatedForReportCount ?? 0)} new report{reports.length - (diagnosis.generatedForReportCount ?? 0) > 1 ? 's' : ''} since.
                      </span>
                    ) : (
                      <span className="text-[var(--fg-3)]">
                        Generated {new Date(diagnosis.generatedAt).toLocaleString()}
                      </span>
                    )}
                  </p>
                )}
                {diagnosisMsg && <p className="t-caption mt-1 text-sol-blue">{diagnosisMsg}</p>}
              </div>
              {canRetry && (
                <button
                  onClick={handleGenerateDiagnosis}
                  disabled={diagnosing}
                  className="hf-btn sm shrink-0"
                >
                  {diagnosing
                    ? 'Generating...'
                    : diagnosis?.markdown
                      ? 'Regenerate'
                      : 'Generate diagnosis'}
                </button>
              )}
            </div>

            {diagnosis?.markdown ? (
              <div className="hf-card p-6">
                <div className="prose-diagnosis max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {diagnosis.markdown}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <div className="hf-card p-6 text-center">
                <p className="t-body-s text-[var(--fg-1)]">
                  No diagnosis generated yet.{' '}
                  {canRetry
                    ? 'Click the Generate button above to create one.'
                    : 'Only the owning company wallet can generate this.'}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
