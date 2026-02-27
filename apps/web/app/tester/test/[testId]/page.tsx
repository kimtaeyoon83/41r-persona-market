"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { testApi, reportApi } from "@/lib/api";
import { LoadingSpinner } from "@/components/loading";
import { useWalletContext } from "@/components/wallet-provider";

interface ChecklistItem { id: string; task: string; expected: string }
interface ScenarioItem { id: string; persona_type: string; narrative: string; evaluation_points: string[] }
interface QuestionnaireItem { id: string; question: string; type: string }

interface TestData {
  test: { id: string; targetUrl: string; requirements: string };
  test_cases: {
    checklist: ChecklistItem[];
    scenarios: ScenarioItem[];
    questionnaire: QuestionnaireItem[];
  };
}

export default function TesterTestPage() {
  const params = useParams();
  const router = useRouter();
  const { publicKey, connect } = useWalletContext();
  const testId = params.testId as string;
  const [data, setData] = useState<TestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const [checklistResults, setChecklistResults] = useState<Record<string, { status: string; memo: string }>>({});
  const [scenarioLogs, setScenarioLogs] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string | number>>({});

  useEffect(() => {
    if (!testId) return;
    (testApi.get(testId) as Promise<TestData>)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [testId]);

  const handleSubmit = async () => {
    if (!data) return;

    let testerWallet = publicKey;
    if (!testerWallet) {
      await connect();
      return; // connect will update publicKey, user clicks submit again
    }

    setSubmitting(true);
    try {

      const report = await reportApi.submit({
        tester_addr: testerWallet,
        test_id: testId,
        checklist_results: data.test_cases.checklist.map(c => ({
          id: c.id,
          status: checklistResults[c.id]?.status || 'blocked',
          memo: checklistResults[c.id]?.memo || '',
        })),
        scenario_log: data.test_cases.scenarios.map(s => ({
          id: s.id,
          timeline: [{ time: new Date().toISOString(), action: scenarioLogs[s.id] || 'No log recorded' }],
        })),
        questionnaire_answers: data.test_cases.questionnaire.map(q => ({
          id: q.id,
          answer: answers[q.id] ?? '',
        })),
      });

      setResult(report as Record<string, unknown>);
      setSubmitted(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <LoadingSpinner text="Loading test session..." />;
  if (!data) return <div className="text-[var(--status-error)] text-center py-12">Test not found</div>;

  if (submitted && result) {
    const isRejected = result.rejected === true;
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
          isRejected
            ? 'bg-[var(--status-error)]/10 border border-[var(--status-error)]/20'
            : 'bg-sol-green/10 border border-sol-green/20'
        }`}>
          {isRejected ? (
            <svg className="w-8 h-8 text-[var(--status-error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-8 h-8 text-sol-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <h1 className="font-display text-2xl font-bold mb-2">
          {isRejected ? 'Report Needs Improvement' : 'Report Submitted!'}
        </h1>
        <p className="text-[var(--text-secondary)] mb-6">
          {isRejected
            ? 'Your report was recorded but did not meet the quality threshold for a reward.'
            : 'Your test report has been recorded and rewarded.'}
        </p>
        <div className={`p-5 rounded-xl text-left space-y-2 ${
          isRejected
            ? 'bg-[var(--status-error)]/5 border border-[var(--status-error)]/20'
            : 'bg-surface border border-border-dim'
        }`}>
          <p className="text-sm">
            <span className="text-[var(--text-tertiary)]">Quality Score:</span>{' '}
            <span className={`font-display font-bold ${
              isRejected ? 'text-[var(--status-error)]' : Number(result.quality_score) >= 3.5 ? 'text-sol-green' : 'text-sol-blue'
            }`}>{String(result.quality_score)}/5.0</span>
          </p>
          {result.quality_reason ? (
            <p className="text-sm text-[var(--text-secondary)]">{String(result.quality_reason)}</p>
          ) : null}
          <p className="text-sm">
            <span className="text-[var(--text-tertiary)]">Reward:</span>{' '}
            <span className={`font-display font-bold ${isRejected ? 'text-[var(--status-error)]' : 'text-sol-blue'}`}>
              {isRejected ? '$0 (rejected)' : `$${String(result.reward_amount)} USDC`}
            </span>
          </p>
          {!isRejected && result.tx_signature ? (
            <p className="text-sm"><span className="text-[var(--text-tertiary)]">TX:</span> <span className="font-mono text-xs text-[var(--text-secondary)]">{String(result.tx_signature)}</span></p>
          ) : null}
          {isRejected && result.rejection_message ? (
            <p className="text-sm text-[var(--status-warning)] mt-2 pt-2 border-t border-[var(--status-error)]/10">
              {String(result.rejection_message)}
            </p>
          ) : null}
          {Boolean(result.persona_triggered) && (
            <p className="text-sm text-sol-green font-semibold mt-2 pt-2 border-t border-border-dim">
              Persona generation triggered! You completed 3 tests.
            </p>
          )}
        </div>
        <button onClick={() => router.push('/tester/tests')} className="mt-6 px-6 py-2.5 bg-sol-blue hover:bg-sol-blue/80 rounded-lg text-sm font-medium transition-colors">
          {isRejected ? 'Try Another Test' : 'Back to Tests'}
        </button>
      </div>
    );
  }

  const { test, test_cases } = data;

  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold mb-2">Test Session</h1>
        <p className="text-[var(--text-secondary)] font-mono text-sm">{test.targetUrl}</p>
        <a href={test.targetUrl} target="_blank" rel="noopener noreferrer" className="text-sol-blue text-sm hover:text-sol-blue/80 transition-colors">
          Open target site in new tab &rarr;
        </a>
      </div>

      {/* Checklist Section */}
      <section className="mb-8">
        <h2 className="font-display text-lg font-semibold mb-4 text-sol-purple">Checklist</h2>
        <div className="space-y-3">
          {test_cases.checklist?.map((item) => (
            <div key={item.id} className="p-4 rounded-xl bg-surface border border-border-dim">
              <div className="flex items-start gap-3">
                <span className="text-xs font-mono text-sol-purple mt-1">{item.id}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{item.task}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">Expected: {item.expected}</p>
                  <div className="flex gap-2 mt-3">
                    {['passed', 'failed', 'blocked'].map(status => (
                      <button
                        key={status}
                        onClick={() => setChecklistResults(prev => ({
                          ...prev,
                          [item.id]: { ...prev[item.id], status, memo: prev[item.id]?.memo || '' },
                        }))}
                        className={`px-3 py-1 rounded-md text-xs font-mono transition-colors ${
                          checklistResults[item.id]?.status === status
                            ? status === 'passed' ? 'bg-sol-green/15 text-sol-green border border-sol-green/30'
                              : status === 'failed' ? 'bg-[var(--status-error)]/15 text-[var(--status-error)] border border-[var(--status-error)]/30'
                              : 'bg-[var(--status-warning)]/15 text-[var(--status-warning)] border border-[var(--status-warning)]/30'
                            : 'bg-surface-elevated text-[var(--text-tertiary)] border border-border-dim hover:border-border-hover'
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                  <input
                    placeholder="Add a note..."
                    className="mt-2 w-full"
                    value={checklistResults[item.id]?.memo || ''}
                    onChange={(e) => setChecklistResults(prev => ({
                      ...prev,
                      [item.id]: { ...prev[item.id], status: prev[item.id]?.status || 'blocked', memo: e.target.value },
                    }))}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Scenario Section */}
      <section className="mb-8">
        <h2 className="font-display text-lg font-semibold mb-4 text-sol-blue">Scenarios</h2>
        <div className="space-y-3">
          {test_cases.scenarios?.map((item) => (
            <div key={item.id} className="p-4 rounded-xl bg-surface border border-border-dim">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-sol-blue">{item.id}</span>
                <span className="text-xs text-[var(--text-tertiary)]">{item.persona_type}</span>
              </div>
              <p className="text-sm text-[var(--text-primary)] mb-3">{item.narrative}</p>
              <textarea
                placeholder="Record your journey (timeline, observations, issues...)"
                rows={4}
                className="w-full resize-none"
                value={scenarioLogs[item.id] || ''}
                onChange={(e) => setScenarioLogs(prev => ({ ...prev, [item.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Questionnaire Section */}
      <section className="mb-8">
        <h2 className="font-display text-lg font-semibold mb-4 text-sol-green">Questionnaire</h2>
        <div className="space-y-3">
          {test_cases.questionnaire?.map((item) => (
            <div key={item.id} className="p-4 rounded-xl bg-surface border border-border-dim">
              <div className="flex items-start gap-3">
                <span className="text-xs font-mono text-sol-green mt-0.5">{item.id}</span>
                <div className="flex-1">
                  <p className="text-sm text-[var(--text-primary)] mb-2">{item.question}</p>
                  {item.type === 'free_text' ? (
                    <textarea
                      rows={2}
                      className="w-full resize-none"
                      value={String(answers[item.id] || '')}
                      onChange={(e) => setAnswers(prev => ({ ...prev, [item.id]: e.target.value }))}
                    />
                  ) : (
                    <div className="flex gap-1">
                      {Array.from({ length: item.type === 'rating_1_10' ? 10 : 5 }, (_, i) => i + 1).map(n => (
                        <button
                          key={n}
                          onClick={() => setAnswers(prev => ({ ...prev, [item.id]: n }))}
                          className={`w-8 h-8 rounded-md text-xs font-mono transition-colors ${
                            answers[item.id] === n
                              ? 'bg-sol-green/15 text-sol-green border border-sol-green/30'
                              : 'bg-surface-elevated text-[var(--text-tertiary)] border border-border-dim hover:border-border-hover'
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {publicKey && (
        <div className="mb-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-sol-green/5 border border-sol-green/15">
          <div className="w-2 h-2 rounded-full bg-sol-green" />
          <span className="text-xs text-[var(--text-secondary)]">Submitting as</span>
          <span className="text-xs font-mono text-sol-green">{publicKey.slice(0, 4)}...{publicKey.slice(-4)}</span>
        </div>
      )}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-3 bg-sol-blue hover:bg-sol-blue/80 disabled:bg-surface-card disabled:text-[var(--text-tertiary)] rounded-lg font-medium transition-colors text-lg"
      >
        {submitting ? "Submitting report..." : publicKey ? "Submit Test Report" : "Connect Wallet & Submit"}
      </button>
    </div>
  );
}
