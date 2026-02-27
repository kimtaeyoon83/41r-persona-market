"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { testApi, reportApi } from "@/lib/api";
import { LoadingSpinner } from "@/components/loading";

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
  const testId = params.testId as string;
  const [data, setData] = useState<TestData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  // Test state
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
    setSubmitting(true);
    try {
      const testerWallet = prompt("Enter your wallet address:");
      if (!testerWallet) return;

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
  if (!data) return <div className="text-red-400 text-center py-12">Test not found</div>;

  if (submitted && result) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <div className="text-4xl mb-4">&#x2705;</div>
        <h1 className="text-2xl font-bold mb-2">Report Submitted!</h1>
        <p className="text-gray-400 mb-6">Your test report has been recorded.</p>
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800 text-left space-y-2">
          <p className="text-sm"><span className="text-gray-500">Quality Score:</span> {String(result.quality_score)}/5.0</p>
          <p className="text-sm"><span className="text-gray-500">Reward:</span> ${String(result.reward_amount)} USDC</p>
          <p className="text-sm"><span className="text-gray-500">TX:</span> <span className="font-mono text-xs">{String(result.tx_signature)}</span></p>
          {Boolean(result.persona_triggered) && (
            <p className="text-sm text-green-400 font-semibold mt-2">
              Persona generation triggered! You completed 3 tests.
            </p>
          )}
        </div>
        <button onClick={() => router.push('/tester/tests')} className="mt-6 px-6 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm">
          Back to Tests
        </button>
      </div>
    );
  }

  const { test, test_cases } = data;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Test Session</h1>
        <p className="text-gray-400 font-mono text-sm">{test.targetUrl}</p>
        <a href={test.targetUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-400 text-sm hover:underline">
          Open target site in new tab &rarr;
        </a>
      </div>

      {/* Checklist Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4 text-purple-300">Checklist</h2>
        <div className="space-y-3">
          {test_cases.checklist?.map((item) => (
            <div key={item.id} className="p-4 rounded-lg bg-gray-900 border border-gray-800">
              <div className="flex items-start gap-3">
                <span className="text-xs font-mono text-purple-400 mt-1">{item.id}</span>
                <div className="flex-1">
                  <p className="text-sm font-medium">{item.task}</p>
                  <p className="text-xs text-gray-500 mt-1">Expected: {item.expected}</p>
                  <div className="flex gap-2 mt-3">
                    {['passed', 'failed', 'blocked'].map(status => (
                      <button
                        key={status}
                        onClick={() => setChecklistResults(prev => ({
                          ...prev,
                          [item.id]: { ...prev[item.id], status, memo: prev[item.id]?.memo || '' },
                        }))}
                        className={`px-3 py-1 rounded text-xs transition-colors ${
                          checklistResults[item.id]?.status === status
                            ? status === 'passed' ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                              : status === 'failed' ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30'
                            : 'bg-gray-800 text-gray-500 border border-gray-700 hover:bg-gray-700'
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                  <input
                    placeholder="Add a note..."
                    className="mt-2 w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs focus:border-purple-500 focus:outline-none"
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
        <h2 className="text-lg font-semibold mb-4 text-cyan-300">Scenarios</h2>
        <div className="space-y-3">
          {test_cases.scenarios?.map((item) => (
            <div key={item.id} className="p-4 rounded-lg bg-gray-900 border border-gray-800">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono text-cyan-400">{item.id}</span>
                <span className="text-xs text-gray-500">{item.persona_type}</span>
              </div>
              <p className="text-sm mb-3">{item.narrative}</p>
              <textarea
                placeholder="Record your journey (timeline, observations, issues...)"
                rows={4}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-cyan-500 focus:outline-none resize-none"
                value={scenarioLogs[item.id] || ''}
                onChange={(e) => setScenarioLogs(prev => ({ ...prev, [item.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </section>

      {/* Questionnaire Section */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-4 text-green-300">Questionnaire</h2>
        <div className="space-y-3">
          {test_cases.questionnaire?.map((item) => (
            <div key={item.id} className="p-4 rounded-lg bg-gray-900 border border-gray-800">
              <div className="flex items-start gap-3">
                <span className="text-xs font-mono text-green-400 mt-0.5">{item.id}</span>
                <div className="flex-1">
                  <p className="text-sm mb-2">{item.question}</p>
                  {item.type === 'free_text' ? (
                    <textarea
                      rows={2}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-sm focus:border-green-500 focus:outline-none resize-none"
                      value={String(answers[item.id] || '')}
                      onChange={(e) => setAnswers(prev => ({ ...prev, [item.id]: e.target.value }))}
                    />
                  ) : (
                    <div className="flex gap-1">
                      {Array.from({ length: item.type === 'rating_1_10' ? 10 : 5 }, (_, i) => i + 1).map(n => (
                        <button
                          key={n}
                          onClick={() => setAnswers(prev => ({ ...prev, [item.id]: n }))}
                          className={`w-8 h-8 rounded text-xs transition-colors ${
                            answers[item.id] === n
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                              : 'bg-gray-800 text-gray-500 border border-gray-700 hover:bg-gray-700'
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

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors text-lg"
      >
        {submitting ? "Submitting report..." : "Submit Test Report"}
      </button>
    </div>
  );
}
