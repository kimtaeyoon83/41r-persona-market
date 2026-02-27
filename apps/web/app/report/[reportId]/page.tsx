"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { reportApi } from "@/lib/api";
import Link from "next/link";
import { LoadingSpinner } from "@/components/loading";

interface ChecklistResult {
  id: string;
  status: "passed" | "failed" | "blocked";
  memo: string;
}

interface ScenarioLogEntry {
  time: string;
  action: string;
  screenshot?: string;
}

interface ScenarioLog {
  id: string;
  timeline: ScenarioLogEntry[];
}

interface QuestionnaireAnswer {
  id: string;
  answer: string | number;
}

interface Report {
  id: string;
  testerAddr: string;
  testId: string;
  checklistResults: ChecklistResult[];
  scenarioLog: ScenarioLog[];
  questionnaireAnswers: QuestionnaireAnswer[];
  qualityScore: number | null;
  isPersonaTest: boolean;
  screenshots: string[];
  createdAt: string;
}

const statusColor = {
  passed: "text-green-400 bg-green-500/10",
  failed: "text-red-400 bg-red-500/10",
  blocked: "text-yellow-400 bg-yellow-500/10",
};

export default function ReportDetailPage() {
  const params = useParams();
  const reportId = params.reportId as string;
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!reportId) return;
    (reportApi.get(reportId) as Promise<Report>)
      .then(setReport)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [reportId]);

  if (loading) return <LoadingSpinner text="Loading report..." />;
  if (!report) return <div className="text-red-400 text-center py-12">Report not found</div>;

  const passed = report.checklistResults?.filter(c => c.status === "passed").length || 0;
  const total = report.checklistResults?.length || 0;

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold">Test Report</h1>
          {report.isPersonaTest && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20">
              AI Persona Test
            </span>
          )}
        </div>
        <p className="text-xs text-gray-500 font-mono">{report.id}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <p className="text-xs text-gray-500">Quality Score</p>
          <p className={`text-2xl font-bold ${
            (report.qualityScore || 0) >= 4 ? "text-green-400" :
            (report.qualityScore || 0) >= 3 ? "text-yellow-400" : "text-red-400"
          }`}>
            {report.qualityScore?.toFixed(1) || "N/A"}<span className="text-sm text-gray-500">/5</span>
          </p>
        </div>
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <p className="text-xs text-gray-500">Checklist</p>
          <p className="text-2xl font-bold text-cyan-400">{passed}<span className="text-sm text-gray-500">/{total}</span></p>
        </div>
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <p className="text-xs text-gray-500">Tester</p>
          <p className="text-sm font-mono text-gray-300 truncate">{report.testerAddr.slice(0, 12)}...</p>
        </div>
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <p className="text-xs text-gray-500">Date</p>
          <p className="text-sm">{new Date(report.createdAt).toLocaleString("ko-KR")}</p>
        </div>
      </div>

      {/* Screenshots */}
      {report.screenshots && report.screenshots.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Screenshots</h2>
          <div className="grid grid-cols-2 gap-3">
            {report.screenshots.map((ss, i) => (
              <div key={i} className="rounded-lg overflow-hidden border border-gray-800 bg-gray-900">
                {ss.startsWith("autotest_") || ss.endsWith(".png") ? (
                  <div className="p-3">
                    <a
                      href={`http://localhost:4100/screenshots/${ss}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-cyan-400 hover:underline"
                    >
                      {ss}
                    </a>
                    <img
                      src={`http://localhost:4100/screenshots/${ss}`}
                      alt={`Screenshot ${i + 1}`}
                      className="mt-2 rounded w-full"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  </div>
                ) : (
                  <p className="p-3 text-xs text-gray-500">{ss}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Checklist Results */}
      {report.checklistResults && report.checklistResults.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Checklist Results</h2>
          <div className="space-y-2">
            {report.checklistResults.map((item) => (
              <div key={item.id} className="p-3 rounded-lg bg-gray-900 border border-gray-800 flex items-start gap-3">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor[item.status]}`}>
                  {item.status}
                </span>
                <div className="flex-1">
                  <span className="text-xs font-mono text-gray-500 mr-2">{item.id}</span>
                  <p className="text-sm text-gray-300 mt-1">{item.memo}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scenario Log */}
      {report.scenarioLog && report.scenarioLog.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Scenario Timeline</h2>
          {report.scenarioLog.map((scenario) => (
            <div key={scenario.id} className="p-4 rounded-lg bg-gray-900 border border-gray-800 mb-3">
              <p className="text-xs font-mono text-purple-400 mb-3">{scenario.id}</p>
              <div className="space-y-2 border-l-2 border-gray-700 pl-4">
                {scenario.timeline.map((entry, i) => (
                  <div key={i} className="relative">
                    <div className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-gray-600" />
                    <p className="text-xs text-gray-500">{entry.time ? new Date(entry.time).toLocaleTimeString("ko-KR") : ""}</p>
                    <p className="text-sm text-gray-300">{entry.action}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Questionnaire Answers */}
      {report.questionnaireAnswers && report.questionnaireAnswers.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">Questionnaire Answers</h2>
          <div className="space-y-2">
            {report.questionnaireAnswers.map((qa) => (
              <div key={qa.id} className="p-3 rounded-lg bg-gray-900 border border-gray-800">
                <span className="text-xs font-mono text-green-400">{qa.id}</span>
                <p className="text-sm mt-1">
                  {typeof qa.answer === "number" ? (
                    <span className="flex items-center gap-2">
                      <span className="text-lg font-bold text-yellow-400">{qa.answer}</span>
                      <span className="text-xs text-gray-500">/ 5</span>
                    </span>
                  ) : (
                    <span className="text-gray-300">{String(qa.answer)}</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Links */}
      <div className="flex gap-3 text-sm">
        <Link href={`/company/test/${report.testId}`} className="text-purple-400 hover:underline">
          View Test Details
        </Link>
      </div>
    </div>
  );
}
