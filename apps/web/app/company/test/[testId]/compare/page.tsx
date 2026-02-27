"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { reportApi, testApi } from "@/lib/api";
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

  useEffect(() => {
    if (!testId) return;
    Promise.all([
      reportApi.compare(testId) as Promise<CompareData>,
      testApi.get(testId) as Promise<{ test: { targetUrl: string } }>,
    ])
      .then(([compareData, testData]) => {
        setData(compareData);
        setTestUrl(testData.test?.targetUrl || "");
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [testId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="w-8 h-8 border-2 border-gray-700 border-t-orange-500 rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Loading comparison...</p>
      </div>
    );
  }
  if (!data) return <div className="text-red-400 text-center py-12">No comparison data available</div>;

  const manualReport = data.manual.reports[0];
  const personaReport = data.persona.reports[0];

  // Extract unique action logs from persona scenario timelines
  const personaActions = personaReport?.scenarioLog?.flatMap(s => s.timeline.map(t => t.action)) || [];
  const manualActions = manualReport?.scenarioLog?.flatMap(s => s.timeline.map(t => t.action)) || [];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <Link href={`/company/test/${testId}`} className="text-xs text-gray-500 hover:text-gray-300 mb-2 inline-block">
          &larr; Back to Test
        </Link>
        <h1 className="text-2xl font-bold mb-1">Manual vs AI Persona Report</h1>
        <p className="text-sm text-gray-400 font-mono">{testUrl}</p>
      </div>

      {/* Summary comparison cards */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {/* Manual side */}
        <div className="p-5 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-0.5 rounded text-xs bg-cyan-500/20 text-cyan-400">Manual</span>
            <span className="text-xs text-gray-500">{data.manual.count} report(s)</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-xs text-gray-500">Quality</p>
              <p className={`text-2xl font-bold ${data.manual.avg_quality >= 4 ? "text-green-400" : data.manual.avg_quality >= 3 ? "text-yellow-400" : "text-red-400"}`}>
                {data.manual.avg_quality.toFixed(1)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Passed</p>
              <p className="text-2xl font-bold text-green-400">{data.manual.issues.passed}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Issues</p>
              <p className="text-2xl font-bold text-red-400">{data.manual.issues.failed + data.manual.issues.blocked}</p>
            </div>
          </div>
        </div>

        {/* Persona side */}
        <div className="p-5 rounded-xl border border-orange-500/20 bg-orange-500/5">
          <div className="flex items-center gap-2 mb-4">
            <span className="px-2 py-0.5 rounded text-xs bg-orange-500/20 text-orange-400">AI Persona</span>
            <span className="text-xs text-gray-500">{data.persona.count} report(s)</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-xs text-gray-500">Quality</p>
              <p className={`text-2xl font-bold ${data.persona.avg_quality >= 4 ? "text-green-400" : data.persona.avg_quality >= 3 ? "text-yellow-400" : "text-red-400"}`}>
                {data.persona.avg_quality.toFixed(1)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Passed</p>
              <p className="text-2xl font-bold text-green-400">{data.persona.issues.passed}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500">Issues</p>
              <p className="text-2xl font-bold text-red-400">{data.persona.issues.failed + data.persona.issues.blocked}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Side-by-side checklist comparison */}
      {(manualReport || personaReport) && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Checklist Results</h2>
          <div className="grid grid-cols-2 gap-4">
            {/* Manual checklist */}
            <div>
              <p className="text-xs text-cyan-400 mb-2 font-medium">Manual Tester</p>
              <div className="space-y-2">
                {manualReport?.checklistResults?.map((item) => (
                  <div key={item.id} className="p-2.5 rounded-lg bg-gray-900 border border-gray-800 flex items-start gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      item.status === "passed" ? "text-green-400 bg-green-500/10" :
                      item.status === "failed" ? "text-red-400 bg-red-500/10" :
                      "text-yellow-400 bg-yellow-500/10"
                    }`}>
                      {item.status}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-mono text-gray-600">{item.id}</span>
                      <p className="text-xs text-gray-400 truncate">{item.memo}</p>
                    </div>
                  </div>
                )) || <p className="text-xs text-gray-600">No manual reports yet</p>}
              </div>
            </div>

            {/* Persona checklist */}
            <div>
              <p className="text-xs text-orange-400 mb-2 font-medium">AI Persona</p>
              <div className="space-y-2">
                {personaReport?.checklistResults?.map((item) => (
                  <div key={item.id} className="p-2.5 rounded-lg bg-gray-900 border border-gray-800 flex items-start gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      item.status === "passed" ? "text-green-400 bg-green-500/10" :
                      item.status === "failed" ? "text-red-400 bg-red-500/10" :
                      "text-yellow-400 bg-yellow-500/10"
                    }`}>
                      {item.status}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-mono text-gray-600">{item.id}</span>
                      <p className="text-xs text-gray-400 truncate">{item.memo}</p>
                    </div>
                  </div>
                )) || <p className="text-xs text-gray-600">No persona reports yet</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Side-by-side action timeline */}
      {(manualActions.length > 0 || personaActions.length > 0) && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Action Timeline</h2>
          <div className="grid grid-cols-2 gap-4">
            {/* Manual timeline */}
            <div>
              <p className="text-xs text-cyan-400 mb-2 font-medium">Manual Tester ({manualActions.length} actions)</p>
              <div className="space-y-1 border-l-2 border-cyan-500/20 pl-3">
                {manualActions.map((action, i) => (
                  <p key={i} className="text-xs text-gray-400">{action}</p>
                ))}
                {manualActions.length === 0 && <p className="text-xs text-gray-600">No actions recorded</p>}
              </div>
            </div>

            {/* Persona timeline */}
            <div>
              <p className="text-xs text-orange-400 mb-2 font-medium">AI Persona ({personaActions.length} actions)</p>
              <div className="space-y-1 border-l-2 border-orange-500/20 pl-3">
                {personaActions.map((action, i) => (
                  <p key={i} className="text-xs text-gray-400">{action}</p>
                ))}
                {personaActions.length === 0 && <p className="text-xs text-gray-600">No actions recorded</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Side-by-side screenshots */}
      {(manualReport?.screenshots?.length > 0 || personaReport?.screenshots?.length > 0) && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Screenshots</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-cyan-400 mb-2 font-medium">Manual</p>
              <div className="space-y-2">
                {manualReport?.screenshots?.map((ss, i) => (
                  <img
                    key={i}
                    src={`http://localhost:4100/screenshots/${ss}`}
                    alt={`Manual screenshot ${i + 1}`}
                    className="w-full rounded-lg border border-gray-800"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )) || <p className="text-xs text-gray-600">No screenshots</p>}
              </div>
            </div>
            <div>
              <p className="text-xs text-orange-400 mb-2 font-medium">AI Persona</p>
              <div className="space-y-2">
                {personaReport?.screenshots?.slice(0, 4).map((ss, i) => (
                  <img
                    key={i}
                    src={`http://localhost:4100/screenshots/${ss}`}
                    alt={`Persona screenshot ${i + 1}`}
                    className="w-full rounded-lg border border-gray-800"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                )) || <p className="text-xs text-gray-600">No screenshots</p>}
                {(personaReport?.screenshots?.length || 0) > 4 && (
                  <p className="text-xs text-gray-500 text-center">
                    +{(personaReport?.screenshots?.length || 0) - 4} more screenshots
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Links to individual reports */}
      <div className="flex gap-4 text-sm">
        {manualReport && (
          <Link href={`/report/${manualReport.id}`} className="text-cyan-400 hover:underline">
            View Manual Report &rarr;
          </Link>
        )}
        {personaReport && (
          <Link href={`/report/${personaReport.id}`} className="text-orange-400 hover:underline">
            View AI Persona Report &rarr;
          </Link>
        )}
      </div>
    </div>
  );
}
