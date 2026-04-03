"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { reportApi, API_BASE } from "@/lib/api";
import Link from "next/link";
import { LoadingSpinner } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";

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

interface Settlement {
  id: string;
  testId: string;
  reportId: string;
  payerAddr: string;
  payeeAddr: string;
  amountToken: number;
  feeCollected: number;
  txSignature: string;
  settlementType: string;
  settledAt: string;
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
  settlements: Settlement[];
}

const statusColor = {
  passed: "text-sol-green bg-sol-green/10 border border-sol-green/20",
  failed: "text-[var(--status-error)] bg-[var(--status-error)]/10 border border-[var(--status-error)]/20",
  blocked: "text-[var(--status-warning)] bg-[var(--status-warning)]/10 border border-[var(--status-warning)]/20",
};

function SolanaExplorerLink({ signature, label }: { signature: string; label?: string }) {
  const isPending = signature.startsWith("pending_");
  if (isPending) {
    return (
      <span className="text-xs font-mono text-[var(--status-warning)]">
        Pending
      </span>
    );
  }
  return (
    <a
      href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs font-mono text-sol-blue hover:text-sol-blue/70 transition-colors inline-flex items-center gap-1"
    >
      {label || `${signature.slice(0, 16)}...${signature.slice(-8)}`}
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

export default function ReportDetailPage() {
  const params = useParams();
  const reportId = params.reportId as string;
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = () => {
    if (!reportId) return;
    setLoading(true);
    setError(null);
    (reportApi.get(reportId) as Promise<Report>)
      .then(setReport)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load report"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  if (loading) return <LoadingSpinner text="Loading report..." />;
  if (error) return <ErrorDisplay message={error} onRetry={loadReport} />;
  if (!report) return <ErrorDisplay message="Report not found" />;

  const passed = report.checklistResults?.filter(c => c.status === "passed").length || 0;
  const total = report.checklistResults?.length || 0;
  const settlements = report.settlements || [];
  const isRejected = (report.qualityScore ?? 0) < 1.5;

  return (
    <div className="max-w-4xl">
      {/* Rejected banner */}
      {isRejected && (
        <div className="mb-6 p-4 rounded-xl bg-[var(--status-error)]/8 border border-[var(--status-error)]/20">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-[var(--status-error)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
            <p className="text-sm font-medium text-[var(--status-error)]">Rejected Report</p>
          </div>
          <p className="text-xs text-[var(--text-tertiary)] mt-1 ml-7">
            This report was rejected due to insufficient quality (score {report.qualityScore?.toFixed(1)}/5.0). No reward was paid.
          </p>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="font-display text-2xl font-bold">Test Report</h1>
          {isRejected && (
            <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-[var(--status-error)]/10 text-[var(--status-error)] border border-[var(--status-error)]/20">
              Rejected
            </span>
          )}
          {report.isPersonaTest && (
            <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-sol-green/10 text-sol-green border border-sol-green/20">
              AI Persona Test
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--text-tertiary)] font-mono">{report.id}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Quality</p>
          <p className={`text-2xl font-display font-bold mt-1 ${
            (report.qualityScore || 0) >= 4 ? "text-sol-green" :
            (report.qualityScore || 0) >= 3 ? "text-[var(--status-warning)]" : "text-[var(--status-error)]"
          }`}>
            {report.qualityScore?.toFixed(1) || "N/A"}<span className="text-sm text-[var(--text-tertiary)]">/5</span>
          </p>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Checklist</p>
          <p className="text-2xl font-display font-bold mt-1 text-sol-blue">{passed}<span className="text-sm text-[var(--text-tertiary)]">/{total}</span></p>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Tester</p>
          <p className="text-sm font-mono text-[var(--text-primary)] truncate mt-1">{report.testerAddr.slice(0, 12)}...</p>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Date</p>
          <p className="text-sm mt-1">{new Date(report.createdAt).toLocaleString("ko-KR")}</p>
        </div>
      </div>

      {/* Settlements / Payment Info */}
      {settlements.length > 0 && (
        <div className="mb-8 p-5 rounded-xl bg-surface border border-border-dim">
          <h2 className="font-display text-lg font-semibold mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-sol-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Settlement ({settlements.length})
          </h2>

          <div className="space-y-4">
            {settlements.map((s) => (
              <div key={s.id} className="p-4 rounded-lg border border-border-dim/60 bg-[var(--bg-base)]">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`inline-block px-2 py-0.5 rounded-md text-[11px] font-mono font-medium ${
                    s.settlementType === "41r"
                      ? "bg-sol-purple/10 text-sol-purple border border-sol-purple/20"
                      : "bg-sol-blue/10 text-sol-blue border border-sol-blue/20"
                  }`}>
                    {s.settlementType === "41r" ? "41R Token Mint" : "USDC Transfer"}
                  </span>
                  <span className="text-xl font-display font-bold text-sol-green ml-auto">
                    {s.amountToken}
                    <span className="text-sm font-normal text-[var(--text-secondary)] ml-1">
                      {s.settlementType === "41r" ? "41R" : "USDC"}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Fee</span>
                    <p className="font-mono text-[var(--text-secondary)] mt-0.5">
                      {s.feeCollected > 0
                        ? `${s.feeCollected.toFixed(4)} (${Math.round(s.feeCollected / s.amountToken * 100)}%)`
                        : "0"}
                    </p>
                  </div>
                  <div>
                    <span className="text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Settled At</span>
                    <p className="text-[var(--text-secondary)] mt-0.5">{new Date(s.settledAt).toLocaleString("ko-KR")}</p>
                  </div>
                  <div>
                    <span className="text-[var(--text-tertiary)] font-mono uppercase tracking-wider">From</span>
                    <p className="font-mono text-[var(--text-secondary)] mt-0.5 truncate">{s.payerAddr}</p>
                  </div>
                  <div>
                    <span className="text-[var(--text-tertiary)] font-mono uppercase tracking-wider">To</span>
                    <p className="font-mono text-[var(--text-secondary)] mt-0.5 truncate">{s.payeeAddr}</p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Transaction</span>
                    <p className="mt-0.5"><SolanaExplorerLink signature={s.txSignature} /></p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Screenshots */}
      {report.screenshots && report.screenshots.length > 0 && (
        <div className="mb-8">
          <h2 className="font-display text-lg font-semibold mb-3">Screenshots</h2>
          <div className="grid grid-cols-2 gap-3">
            {report.screenshots.map((ss, i) => {
              const imgUrl = ss.startsWith("http") ? ss : `${API_BASE}/screenshots/${ss}`;
              return (
                <div key={i} className="rounded-xl overflow-hidden border border-border-dim bg-surface">
                  {ss.endsWith(".png") || ss.startsWith("http") ? (
                    <div className="p-3">
                      <a
                        href={imgUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-sol-blue hover:text-sol-blue/80"
                      >
                        {ss.startsWith("http") ? ss.split("/").pop() : ss}
                      </a>
                      <img
                        src={imgUrl}
                        alt={`Screenshot ${i + 1}`}
                        className="mt-2 rounded-lg w-full"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    </div>
                  ) : (
                    <p className="p-3 text-xs text-[var(--text-tertiary)]">{ss}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Checklist Results */}
      {report.checklistResults && report.checklistResults.length > 0 && (
        <div className="mb-8">
          <h2 className="font-display text-lg font-semibold mb-3">Checklist Results</h2>
          <div className="space-y-2">
            {report.checklistResults.map((item) => (
              <div key={item.id} className="p-3 rounded-xl bg-surface border border-border-dim flex items-start gap-3">
                <span className={`px-2 py-0.5 rounded-md text-[11px] font-mono font-medium ${statusColor[item.status]}`}>
                  {item.status}
                </span>
                <div className="flex-1">
                  <span className="text-xs font-mono text-[var(--text-tertiary)] mr-2">{item.id}</span>
                  <p className="text-sm text-[var(--text-primary)] mt-1">{item.memo}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scenario Log */}
      {report.scenarioLog && report.scenarioLog.length > 0 && (
        <div className="mb-8">
          <h2 className="font-display text-lg font-semibold mb-3">Scenario Timeline</h2>
          {report.scenarioLog.map((scenario) => (
            <div key={scenario.id} className="p-4 rounded-xl bg-surface border border-border-dim mb-3">
              <p className="text-xs font-mono text-sol-purple mb-3">{scenario.id}</p>
              <div className="space-y-2 border-l-2 border-border-dim pl-4">
                {scenario.timeline.map((entry, i) => (
                  <div key={i} className="relative">
                    <div className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-border" />
                    <p className="text-xs text-[var(--text-tertiary)]">{entry.time ? new Date(entry.time).toLocaleTimeString("ko-KR") : ""}</p>
                    <p className="text-sm text-[var(--text-primary)]">{entry.action}</p>
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
          <h2 className="font-display text-lg font-semibold mb-3">Questionnaire Answers</h2>
          <div className="space-y-2">
            {report.questionnaireAnswers
              .filter((qa) => String(qa.answer) !== "[object Object]")
              .map((qa) => (
              <div key={qa.id} className="p-3 rounded-xl bg-surface border border-border-dim">
                <span className="text-xs font-mono text-sol-green">{qa.id.replace(/_/g, " ")}</span>
                <p className="text-sm mt-1">
                  {typeof qa.answer === "number" ? (
                    <span className="flex items-center gap-2">
                      <span className="text-lg font-display font-bold text-[var(--status-warning)]">{qa.answer}</span>
                      <span className="text-xs text-[var(--text-tertiary)]">/ 5</span>
                    </span>
                  ) : (
                    <span className="text-[var(--text-primary)] leading-relaxed">{String(qa.answer)}</span>
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Links */}
      <div className="flex gap-3 text-sm">
        <Link href={`/company/test/${report.testId}`} className="text-sol-purple hover:text-sol-purple/80 transition-colors">
          View Test Details &rarr;
        </Link>
      </div>
    </div>
  );
}
