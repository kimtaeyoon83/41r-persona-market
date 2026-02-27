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
        <Link href={`/company/test/${testId}`} className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)] mb-2 inline-block transition-colors">
          &larr; Back to Test
        </Link>
        <h1 className="font-display text-2xl font-bold mb-1">Manual vs AI Persona Report</h1>
        <p className="text-sm text-[var(--text-secondary)] font-mono">{testUrl}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="p-5 rounded-xl border border-sol-blue/20 bg-sol-blue/5">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-sol-blue/20 text-sol-blue">Manual</span>
            <span className="text-xs text-[var(--text-tertiary)]">{data.manual.count} report(s)</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-xs text-[var(--text-tertiary)]">Quality</p>
              <p className={`text-2xl font-display font-bold ${data.manual.avg_quality >= 4 ? "text-sol-green" : data.manual.avg_quality >= 3 ? "text-[var(--status-warning)]" : "text-[var(--status-error)]"}`}>
                {data.manual.avg_quality.toFixed(1)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-[var(--text-tertiary)]">Passed</p>
              <p className="text-2xl font-display font-bold text-sol-green">{data.manual.issues.passed}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-[var(--text-tertiary)]">Issues</p>
              <p className="text-2xl font-display font-bold text-[var(--status-error)]">{data.manual.issues.failed + data.manual.issues.blocked}</p>
            </div>
          </div>
        </div>

        <div className="p-5 rounded-xl border border-sol-green/20 bg-sol-green/5">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-sol-green/20 text-sol-green">AI Persona</span>
            <span className="text-xs text-[var(--text-tertiary)]">{data.persona.count} report(s)</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-xs text-[var(--text-tertiary)]">Quality</p>
              <p className={`text-2xl font-display font-bold ${data.persona.avg_quality >= 4 ? "text-sol-green" : data.persona.avg_quality >= 3 ? "text-[var(--status-warning)]" : "text-[var(--status-error)]"}`}>
                {data.persona.avg_quality.toFixed(1)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-[var(--text-tertiary)]">Passed</p>
              <p className="text-2xl font-display font-bold text-sol-green">{data.persona.issues.passed}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-[var(--text-tertiary)]">Issues</p>
              <p className="text-2xl font-display font-bold text-[var(--status-error)]">{data.persona.issues.failed + data.persona.issues.blocked}</p>
            </div>
          </div>
        </div>
      </div>

      {(manualReport || personaReport) && (
        <div className="mb-8">
          <h2 className="font-display text-lg font-semibold mb-4">Checklist Results</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-sol-blue mb-2 font-mono font-medium">Manual Tester</p>
              <div className="space-y-2">
                {manualReport?.checklistResults?.map((item) => (
                  <div key={item.id} className="p-2.5 rounded-lg bg-surface border border-border-dim flex items-start gap-2">
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium ${
                      item.status === "passed" ? "text-sol-green bg-sol-green/10" :
                      item.status === "failed" ? "text-[var(--status-error)] bg-[var(--status-error)]/10" :
                      "text-[var(--status-warning)] bg-[var(--status-warning)]/10"
                    }`}>
                      {item.status}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-mono text-[var(--text-tertiary)]">{item.id}</span>
                      <p className="text-xs text-[var(--text-secondary)] truncate">{item.memo}</p>
                    </div>
                  </div>
                )) || <p className="text-xs text-[var(--text-tertiary)]">No manual reports yet</p>}
              </div>
            </div>

            <div>
              <p className="text-xs text-sol-green mb-2 font-mono font-medium">AI Persona</p>
              <div className="space-y-2">
                {personaReport?.checklistResults?.map((item) => (
                  <div key={item.id} className="p-2.5 rounded-lg bg-surface border border-border-dim flex items-start gap-2">
                    <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono font-medium ${
                      item.status === "passed" ? "text-sol-green bg-sol-green/10" :
                      item.status === "failed" ? "text-[var(--status-error)] bg-[var(--status-error)]/10" :
                      "text-[var(--status-warning)] bg-[var(--status-warning)]/10"
                    }`}>
                      {item.status}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-mono text-[var(--text-tertiary)]">{item.id}</span>
                      <p className="text-xs text-[var(--text-secondary)] truncate">{item.memo}</p>
                    </div>
                  </div>
                )) || <p className="text-xs text-[var(--text-tertiary)]">No persona reports yet</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {(manualActions.length > 0 || personaActions.length > 0) && (
        <div className="mb-8">
          <h2 className="font-display text-lg font-semibold mb-4">Action Timeline</h2>
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
          <h2 className="font-display text-lg font-semibold mb-4">Screenshots</h2>
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
