"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { reportApi, testApi, API_BASE } from "@/lib/api";
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

// Shape mirrors persona-engine's StructuredReport payload (stored under
// the `_structured_report` sentinel inside questionnaireAnswers). Rendering
// this is what lets a reader see *why* a persona scored the way it did —
// summary, per-axis UX scores, observed pain points, positive signals,
// and recommendations. Before Task #22 these fields were only consumed
// by the diagnosis aggregator; the per-report page hid them entirely.
interface StructuredReport {
  summary?: string;
  ux_scores?: { clarity?: number; trust?: number; efficiency?: number; overall?: number };
  pain_points?: Array<{ severity: "high" | "medium" | "low"; description: string; evidence_turn?: number | null }>;
  positive_signals?: string[];
  recommendations?: string[];
}

interface QualityBreakdown {
  quality_score?: number;
  raw_score?: number;
  persona_faithfulness?: number;
  outcome_weight?: number;
  checklist_pass_rate?: number;
}

// Persisted under the `_session_video` sentinel by services/video.ts +
// routes/autotest.ts. URL points to a 854×480 @ 5fps webm on R2 CDN.
// Only present when CDP screencast captured frames AND ffmpeg encode +
// R2 upload both succeeded — the player block below gates on truthy.
interface SessionVideo {
  url: string;
  sizeBytes?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
}

function parseSentinel<T>(raw: string | number | undefined): T | null {
  if (typeof raw !== "string") return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
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

// Questionnaire item metadata we pull from test_cases so the answer
// renderer can pick the right rating scale (1-5 vs 1-10) instead of
// hardcoding "/ 5".
interface QuestionItem {
  id: string;
  question: string;
  type?: "rating_1_5" | "rating_1_10" | "free_text";
}

export default function ReportDetailPage() {
  const params = useParams();
  const reportId = params.reportId as string;
  const [report, setReport] = useState<Report | null>(null);
  const [questionById, setQuestionById] = useState<Map<string, QuestionItem>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = () => {
    if (!reportId) return;
    setLoading(true);
    setError(null);
    (reportApi.get(reportId) as Promise<Report>)
      .then(async (r) => {
        setReport(r);
        // Best-effort fetch of test_cases so the questionnaire renderer
        // can look up per-question type. Failure is non-fatal — we fall
        // back to scale inference below.
        try {
          const test = await (testApi.get(r.testId) as Promise<{ test_cases?: { questionnaire?: QuestionItem[] } }>);
          const map = new Map<string, QuestionItem>();
          for (const q of test?.test_cases?.questionnaire ?? []) {
            if (q?.id) map.set(q.id, q);
          }
          setQuestionById(map);
        } catch {
          /* ignore — rating scale falls back to inference */
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load report"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId]);

  // Pick the right scale for a numeric answer. Prefer the test_cases
  // declared type; if the test call failed, infer from the value —
  // answer > 5 is only valid on rating_1_10 anyway, and Q02/Q03-style
  // rating_1_10 items typically land there.
  function scaleFor(qid: string, answer: number): number {
    const q = questionById.get(qid);
    if (q?.type === "rating_1_10") return 10;
    if (q?.type === "rating_1_5") return 5;
    return answer > 5 ? 10 : 5;
  }

  if (loading) return <LoadingSpinner text="Loading report..." />;
  if (error) return <ErrorDisplay message={error} onRetry={loadReport} />;
  if (!report) return <ErrorDisplay message="Report not found" />;

  const passed = report.checklistResults?.filter(c => c.status === "passed").length || 0;
  const total = report.checklistResults?.length || 0;
  const settlements = report.settlements || [];
  // Low-coverage = quality below the reward threshold. For persona runs
  // this almost always means the browser session got cut short on a
  // hard SPA or signin wall (patience_exceeded outcome) rather than a
  // genuine low-effort submission, so the banner language differs.
  const isLowCoverage = (report.qualityScore ?? 0) < 1.5;
  const lowCoverageLabel = report.isPersonaTest ? 'Session limited' : 'Low coverage';

  // Coverage breakdown — shows *why* the quality score landed where it did.
  // These are derived signals, not separate LLM scores, hence framed as coverage.
  const scenarioEntries = (report.scenarioLog || []).reduce((sum, s) => sum + (s.timeline?.length || 0), 0);
  const scenarioWords = (report.scenarioLog || []).reduce(
    (sum, s) => sum + (s.timeline || []).reduce((a, t) => a + (t.action?.split(/\s+/).filter(Boolean).length ?? 0), 0),
    0,
  );
  const questionnaireAnswered = (report.questionnaireAnswers || []).filter(
    (qa) => qa.answer !== "" && qa.answer !== null && qa.answer !== undefined,
  ).length;
  const questionnaireTotal = (report.questionnaireAnswers || []).length;

  // Extract the persona-engine-produced structured report + quality
  // breakdown sentinels. Manual reports have neither of these; persona
  // reports carry both. Each gets its own dedicated section below.
  const structured = parseSentinel<StructuredReport>(
    (report.questionnaireAnswers || []).find((a) => a.id === "_structured_report")?.answer,
  );
  const breakdown = parseSentinel<QualityBreakdown>(
    (report.questionnaireAnswers || []).find((a) => a.id === "_quality_breakdown")?.answer,
  );
  const sessionVideo = parseSentinel<SessionVideo>(
    (report.questionnaireAnswers || []).find((a) => a.id === "_session_video")?.answer,
  );

  return (
    <div className="max-w-4xl">
      {/* Low-coverage banner */}
      {isLowCoverage && (
        <div className="mb-6 p-4 rounded-xl bg-[var(--warn-soft)] border border-[var(--warn-line)]">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-[var(--warn)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86a2 2 0 001.74-3L13.74 4a2 2 0 00-3.48 0L3.34 16a2 2 0 001.73 3z" />
            </svg>
            <p className="text-sm font-medium text-[var(--warn)]">{lowCoverageLabel}</p>
          </div>
          <p className="text-xs text-[var(--text-tertiary)] mt-1 ml-7">
            {report.isPersonaTest
              ? `Session was cut short before enough UI could be observed (quality ${report.qualityScore?.toFixed(1)}/5.0). This usually happens on SPAs with aggressive redirects or signin walls. Retry from the company test page.`
              : `Quality ${report.qualityScore?.toFixed(1)}/5.0 is below the reward threshold. No reward was paid.`}
          </p>
        </div>
      )}

      {/* Header */}
      <div className="mb-7">
        <div className="flex items-center gap-2 mb-2">
          <h1 className="t-display-m">Test Report</h1>
          {isLowCoverage && <span className="chip warn">{lowCoverageLabel}</span>}
          {report.isPersonaTest && <span className="chip success">AI Persona Test</span>}
        </div>
        <p className="addr">{report.id}</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 mb-7">
        <div className="hf-card p-4">
          <div className="t-label">Quality</div>
          <p className={`money text-2xl font-semibold mt-1 ${
            (report.qualityScore || 0) >= 4 ? "text-sol-green" :
            (report.qualityScore || 0) >= 3 ? "text-[var(--warn)]" : "text-[var(--danger)]"
          }`}>
            {report.qualityScore?.toFixed(1) || "N/A"}<span className="text-sm text-[var(--fg-3)] font-normal">/5</span>
          </p>
        </div>
        <div className="hf-card p-4">
          <div className="t-label">Checklist</div>
          <p className="money text-2xl font-semibold mt-1 text-sol-blue">{passed}<span className="text-sm text-[var(--fg-3)] font-normal">/{total}</span></p>
        </div>
        <div className="hf-card p-4">
          <div className="t-label">Tester</div>
          <p className="addr truncate mt-1.5">{report.testerAddr.slice(0, 12)}…</p>
        </div>
        <div className="hf-card p-4">
          <div className="t-label">Date</div>
          <p className="t-body-s mt-1">{new Date(report.createdAt).toLocaleString("ko-KR")}</p>
        </div>
      </div>

      {/* Quality coverage breakdown */}
      <div className="mb-8 hf-card p-4">
        <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider mb-3">Coverage breakdown</p>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-[var(--text-tertiary)] text-xs">Checklist</p>
            <p className="mt-1">
              <span className="font-display font-semibold text-[var(--text-primary)]">{passed}</span>
              <span className="text-[var(--text-tertiary)]"> / {total} passed</span>
            </p>
          </div>
          <div>
            <p className="text-[var(--text-tertiary)] text-xs">Scenarios</p>
            <p className="mt-1">
              <span className="font-display font-semibold text-[var(--text-primary)]">{scenarioEntries}</span>
              <span className="text-[var(--text-tertiary)]"> entries · {scenarioWords} words</span>
            </p>
          </div>
          <div>
            <p className="text-[var(--text-tertiary)] text-xs">Questionnaire</p>
            <p className="mt-1">
              <span className="font-display font-semibold text-[var(--text-primary)]">{questionnaireAnswered}</span>
              <span className="text-[var(--text-tertiary)]"> / {questionnaireTotal} answered</span>
            </p>
          </div>
        </div>
      </div>

      {/* Settlements / Payment Info */}
      {settlements.length > 0 && (
        <div className="mb-8 hf-card p-5">
          <h2 className="t-display-s mb-4 flex items-center gap-2">
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
          <h2 className="t-display-s mb-3">Screenshots</h2>
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

      {/* Session Replay — CDP-screencasted webm of the persona's actual
          browser session. 854×480 @ 5fps from services/video.ts. Only
          renders when the _session_video sentinel exists (i.e. the full
          capture+ffmpeg+R2 pipeline succeeded). */}
      {sessionVideo?.url && (
        <div className="mb-8 space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="t-display-s">Session Replay</h2>
            <span className="t-caption">
              {sessionVideo.width ?? 854}×{sessionVideo.height ?? 480} ·{" "}
              {sessionVideo.fps ?? 5}fps
              {sessionVideo.sizeBytes
                ? ` · ${(sessionVideo.sizeBytes / 1024 / 1024).toFixed(1)}MB`
                : ""}
              {sessionVideo.durationSec
                ? ` · ${Math.round(sessionVideo.durationSec)}s`
                : ""}
            </span>
          </div>
          <div className="hf-card p-2">
            <video
              controls
              preload="metadata"
              src={sessionVideo.url}
              className="w-full rounded-lg bg-black"
              style={{ aspectRatio: "854 / 480" }}
            >
              Your browser does not support the video tag.
            </video>
          </div>
          <p className="t-caption text-[var(--fg-3)]">
            페르소나가 실제로 본 화면입니다 — Phase A(discovery), B(scroll),
            C(checklist), D(persona-specific exploration) 전체가 한 영상에
            담겨 있습니다.
          </p>
        </div>
      )}

      {/* Structured Report — persona-engine's synthesized view over the
          session (summary + ux_scores + pain_points + signals + recs).
          Manual reports don't carry these sentinels, so this whole
          block is skipped for them. */}
      {(structured || breakdown) && (
        <div className="mb-8 space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="t-display-s">Structured Report</h2>
            <span className="t-caption">persona-engine synthesis</span>
          </div>

          {structured?.summary && (
            <div className="hf-card p-4">
              <p className="t-caption mb-2">Summary</p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--text-primary)]">
                {structured.summary}
              </p>
            </div>
          )}

          {structured?.ux_scores && (
            <div className="hf-card p-4">
              <p className="t-caption mb-3">UX scores (0–1)</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {(["clarity", "trust", "efficiency", "overall"] as const).map((k) => {
                  const v = structured.ux_scores?.[k];
                  if (typeof v !== "number") return null;
                  const pct = Math.max(0, Math.min(1, v));
                  const color = pct >= 0.7 ? "bg-sol-green" : pct >= 0.4 ? "bg-[var(--warn)]" : "bg-[var(--danger)]";
                  return (
                    <div key={k}>
                      <div className="flex items-baseline justify-between">
                        <span className="t-caption capitalize">{k}</span>
                        <span className="text-sm font-mono">{v.toFixed(2)}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded bg-[var(--bg-2)] overflow-hidden">
                        <div className={`h-full ${color}`} style={{ width: `${pct * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {breakdown && (
            <div className="hf-card p-4">
              <p className="t-caption mb-3">Quality breakdown</p>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {breakdown.quality_score !== undefined && (
                  <div>
                    <dt className="t-caption">quality_score</dt>
                    <dd className="font-mono">{breakdown.quality_score.toFixed(2)}</dd>
                  </div>
                )}
                {breakdown.raw_score !== undefined && (
                  <div>
                    <dt className="t-caption">raw_score</dt>
                    <dd className="font-mono">{breakdown.raw_score.toFixed(2)}</dd>
                  </div>
                )}
                {breakdown.outcome_weight !== undefined && (
                  <div>
                    <dt className="t-caption">outcome_weight</dt>
                    <dd className="font-mono">{breakdown.outcome_weight.toFixed(2)}</dd>
                  </div>
                )}
                {breakdown.checklist_pass_rate !== undefined && (
                  <div>
                    <dt className="t-caption">checklist_pass_rate</dt>
                    <dd className="font-mono">{(breakdown.checklist_pass_rate * 100).toFixed(0)}%</dd>
                  </div>
                )}
                {breakdown.persona_faithfulness !== undefined && (
                  <div>
                    <dt className="t-caption">persona_faithfulness</dt>
                    <dd className="font-mono">{breakdown.persona_faithfulness.toFixed(2)}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {structured?.pain_points && structured.pain_points.length > 0 && (
            <div className="hf-card p-4">
              <p className="t-caption mb-3">Pain points ({structured.pain_points.length})</p>
              <ul className="space-y-3">
                {structured.pain_points.map((pp, i) => {
                  const chip = pp.severity === "high" ? "danger"
                    : pp.severity === "medium" ? "warn"
                    : "info";
                  return (
                    <li key={i} className="flex gap-3">
                      <span className={`chip ${chip} shrink-0`}>{pp.severity}</span>
                      <div className="flex-1">
                        <p className="text-sm text-[var(--text-primary)]">{pp.description}</p>
                        {pp.evidence_turn !== null && pp.evidence_turn !== undefined && (
                          <p className="t-caption mt-1">
                            evidence turn {pp.evidence_turn}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {structured?.positive_signals && structured.positive_signals.length > 0 && (
            <div className="hf-card p-4">
              <p className="t-caption mb-2">Positive signals</p>
              <ul className="space-y-1 text-sm text-[var(--text-primary)] list-disc pl-5">
                {structured.positive_signals.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {structured?.recommendations && structured.recommendations.length > 0 && (
            <div className="hf-card p-4">
              <p className="t-caption mb-2">Recommendations</p>
              <ol className="space-y-1 text-sm text-[var(--text-primary)] list-decimal pl-5">
                {structured.recommendations.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          )}
        </div>
      )}

      {/* Checklist Results */}
      {report.checklistResults && report.checklistResults.length > 0 && (
        <div className="mb-8">
          <h2 className="t-display-s mb-3">Checklist Results</h2>
          <div className="space-y-2">
            {report.checklistResults.map((item) => (
              <div key={item.id} className="hf-card p-3 flex items-start gap-3">
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
          <h2 className="t-display-s mb-3">Scenario Timeline</h2>
          {report.scenarioLog.map((scenario) => (
            <div key={scenario.id} className="hf-card p-4 mb-3">
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
          <h2 className="t-display-s mb-3">Questionnaire Answers</h2>
          <div className="space-y-2">
            {report.questionnaireAnswers
              // Hide internal sentinels that ship alongside the real
              // answers (_structured_report / _quality_breakdown /
              // _source). Old "[object Object]" rows are also filtered.
              .filter((qa) => !qa.id.startsWith("_") && String(qa.answer) !== "[object Object]")
              .map((qa) => {
                const q = questionById.get(qa.id);
                return (
                  <div key={qa.id} className="hf-card p-3">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-mono text-sol-green">{qa.id}</span>
                      {q?.question && (
                        <span className="text-xs text-[var(--text-tertiary)] truncate">{q.question}</span>
                      )}
                    </div>
                    <p className="text-sm mt-1">
                      {typeof qa.answer === "number" ? (
                        <span className="flex items-center gap-2">
                          <span className="text-lg font-display font-bold text-[var(--status-warning)]">{qa.answer}</span>
                          <span className="text-xs text-[var(--text-tertiary)]">/ {scaleFor(qa.id, qa.answer)}</span>
                        </span>
                      ) : (
                        <span className="text-[var(--text-primary)] leading-relaxed">{String(qa.answer)}</span>
                      )}
                    </p>
                  </div>
                );
              })}
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
