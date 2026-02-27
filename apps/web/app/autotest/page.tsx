"use client";

import { useEffect, useState, useCallback } from "react";
import { testApi, personaApi, autoTestApi } from "@/lib/api";

interface Test { id: string; targetUrl: string; status: string }
interface Persona {
  id: string;
  testerAddr: string;
  vector: {
    voice_sample: string;
    expertise: Record<string, number>;
    demographics?: { age_group: string };
  };
}

interface StepScreenshot {
  file: string;
  label: string;
  step: number;
  phase: "init" | "checklist" | "persona" | "final";
}

interface AutoTestResult {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress?: number;
  report_id?: string;
  error?: string;
  result?: {
    screenshots: string[];
    steps?: StepScreenshot[];
    actionLog: string[];
    textReport: string;
    uxFeedback: Record<string, unknown>;
    txSignature?: string;
  };
}

const PHASE_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  init: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/30", dot: "bg-blue-500" },
  checklist: { bg: "bg-orange-500/10", text: "text-orange-400", border: "border-orange-500/30", dot: "bg-orange-500" },
  persona: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/30", dot: "bg-purple-500" },
  final: { bg: "bg-green-500/10", text: "text-green-400", border: "border-green-500/30", dot: "bg-green-500" },
};

const PHASE_LABELS: Record<string, string> = {
  init: "Page Load",
  checklist: "Checklist",
  persona: "Persona Exploration",
  final: "Complete",
};

export default function AutoTestPage() {
  const [tests, setTests] = useState<Test[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedTest, setSelectedTest] = useState("");
  const [selectedPersona, setSelectedPersona] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutoTestResult | null>(null);
  const [polling, setPolling] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  useEffect(() => {
    Promise.all([
      testApi.list() as Promise<Test[]>,
      personaApi.list() as Promise<Persona[]>,
    ]).then(([t, p]) => {
      setTests(t.filter(x => x.status === "active"));
      setPersonas(p);
    });
  }, []);

  const pollStatus = useCallback(async (jobId: string) => {
    setPolling(true);
    const poll = async () => {
      try {
        const status = await autoTestApi.status(jobId) as AutoTestResult;
        setResult(status);
        if (status.status === "completed" || status.status === "failed") {
          setPolling(false);
          setRunning(false);
          return;
        }
        setTimeout(poll, 3000);
      } catch {
        setPolling(false);
        setRunning(false);
      }
    };
    poll();
  }, []);

  const handleRun = async () => {
    if (!selectedTest || !selectedPersona) return;
    setRunning(true);
    setResult(null);
    setExpandedStep(null);
    try {
      const res = await autoTestApi.run({ test_id: selectedTest, persona_id: selectedPersona }) as AutoTestResult;
      setResult(res);
      if (res.job_id) {
        pollStatus(res.job_id);
      }
    } catch (err) {
      setResult({ job_id: "", status: "failed", error: err instanceof Error ? err.message : "Unknown error" });
      setRunning(false);
    }
  };

  const selectedPersonaData = personas.find(p => p.id === selectedPersona);
  const topExpertise = selectedPersonaData
    ? Object.entries(selectedPersonaData.vector.expertise).sort(([, a], [, b]) => b - a).slice(0, 3)
    : [];

  const steps = result?.result?.steps || [];
  const hasSteps = steps.length > 0;

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Auto Test Engine</h1>
      <p className="text-gray-400 text-sm mb-8">AI Persona-driven automated browser testing with Stagehand</p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Test selector */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Select Test</label>
          <select
            value={selectedTest}
            onChange={(e) => setSelectedTest(e.target.value)}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:border-orange-500 focus:outline-none"
          >
            <option value="">Choose a test...</option>
            {tests.map(t => (
              <option key={t.id} value={t.id}>{t.targetUrl} ({t.id.slice(0, 8)})</option>
            ))}
          </select>
        </div>

        {/* Persona selector */}
        <div>
          <label className="block text-sm text-gray-400 mb-2">Select Persona</label>
          <select
            value={selectedPersona}
            onChange={(e) => setSelectedPersona(e.target.value)}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:border-orange-500 focus:outline-none"
          >
            <option value="">Choose a persona...</option>
            {personas.map(p => (
              <option key={p.id} value={p.id}>
                {p.id.slice(0, 8)} — {Object.entries(p.vector.expertise).sort(([, a], [, b]) => b - a)[0]?.[0] || "general"}
                {p.vector.demographics ? ` (${p.vector.demographics.age_group})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Selected persona preview */}
      {selectedPersonaData && (
        <div className="p-3 rounded-lg bg-gray-900/50 border border-gray-800 mb-4 text-sm">
          <div className="flex items-center gap-2 mb-1">
            {topExpertise.map(([k, v]) => (
              <span key={k} className="px-2 py-0.5 rounded-full text-xs bg-orange-500/10 text-orange-400">
                {k}: {(v * 100).toFixed(0)}%
              </span>
            ))}
            {selectedPersonaData.vector.demographics && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-purple-500/10 text-purple-400">
                {selectedPersonaData.vector.demographics.age_group}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 italic mt-1">&quot;{selectedPersonaData.vector.voice_sample.slice(0, 120)}...&quot;</p>
        </div>
      )}

      <button
        onClick={handleRun}
        disabled={running || !selectedTest || !selectedPersona}
        className="w-full py-3 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors mb-8"
      >
        {running ? "Running Auto Test..." : "Run Auto Test"}
      </button>

      {/* Progress bar */}
      {result && (result.status === "queued" || result.status === "running") && (
        <div className="mb-8">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-orange-400">{result.status === "queued" ? "Queued..." : "Running..."}</span>
            <span className="text-gray-500">{result.progress || 0}%</span>
          </div>
          <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-orange-500 rounded-full transition-all duration-500"
              style={{ width: `${result.progress || 0}%` }}
            />
          </div>
          {polling && <p className="text-xs text-gray-500 mt-2">Polling for updates every 3s...</p>}
        </div>
      )}

      {/* Error */}
      {result?.status === "failed" && (
        <div className="p-4 rounded-lg border border-red-500/20 bg-red-500/5 mb-8">
          <h3 className="text-sm font-medium text-red-400 mb-2">Test Failed</h3>
          <p className="text-sm text-gray-400">{result.error}</p>
        </div>
      )}

      {/* Results */}
      {result?.status === "completed" && result.result && (
        <div className="space-y-6">
          <div className="p-4 rounded-lg border border-green-500/20 bg-green-500/5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-green-400 mb-1">Auto Test Complete</h3>
                <p className="text-xs text-gray-500">
                  {steps.length} screenshots captured across {result.result.actionLog.length} actions
                </p>
              </div>
              {result.report_id && (
                <a href={`/report/${result.report_id}`} className="px-3 py-1.5 text-xs bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-lg hover:bg-cyan-500/20 transition-colors">
                  View Full Report
                </a>
              )}
            </div>
          </div>

          {/* Step-by-step screenshot timeline */}
          {hasSteps && (
            <div>
              <h3 className="text-lg font-semibold mb-4">Browser Session Timeline</h3>

              {/* Phase summary bar */}
              <div className="flex gap-3 mb-4 text-xs">
                {Object.entries(PHASE_LABELS).map(([phase, label]) => {
                  const count = steps.filter(s => s.phase === phase).length;
                  if (count === 0) return null;
                  const colors = PHASE_COLORS[phase];
                  return (
                    <span key={phase} className={`px-2 py-1 rounded ${colors.bg} ${colors.text}`}>
                      {label}: {count}
                    </span>
                  );
                })}
              </div>

              {/* Timeline */}
              <div className="relative">
                {/* Vertical line */}
                <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-800" />

                <div className="space-y-3">
                  {steps.map((step, i) => {
                    const colors = PHASE_COLORS[step.phase] || PHASE_COLORS.init;
                    const isExpanded = expandedStep === i;

                    return (
                      <div key={i} className="relative pl-10">
                        {/* Timeline dot */}
                        <div className={`absolute left-[11px] top-3 w-[10px] h-[10px] rounded-full ${colors.dot} ring-2 ring-gray-950`} />

                        {/* Step card */}
                        <div
                          className={`rounded-lg border ${colors.border} ${isExpanded ? colors.bg : "bg-gray-900/50"} cursor-pointer transition-all hover:bg-gray-900/80`}
                          onClick={() => setExpandedStep(isExpanded ? null : i)}
                        >
                          <div className="flex items-center gap-3 p-3">
                            <span className={`text-xs font-mono ${colors.text} w-6 text-center shrink-0`}>
                              {String(step.step).padStart(2, "0")}
                            </span>
                            <span className={`text-xs px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} shrink-0`}>
                              {PHASE_LABELS[step.phase]}
                            </span>
                            <p className="text-sm text-gray-300 truncate flex-1">{step.label}</p>
                            <svg
                              className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>

                          {/* Expanded: show screenshot */}
                          {isExpanded && (
                            <div className="px-3 pb-3">
                              <div className="rounded-lg overflow-hidden border border-gray-800 bg-black">
                                <img
                                  src={`http://localhost:4100/screenshots/${step.file}`}
                                  alt={step.label}
                                  className="w-full"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).alt = "Screenshot not available";
                                    (e.target as HTMLImageElement).style.height = "60px";
                                    (e.target as HTMLImageElement).style.display = "flex";
                                  }}
                                />
                              </div>
                              <p className="text-xs text-gray-600 mt-1 font-mono">{step.file}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Filmstrip view */}
              <div className="mt-6">
                <h4 className="text-sm text-gray-400 mb-3">Filmstrip Overview</h4>
                <div className="flex gap-2 overflow-x-auto pb-3">
                  {steps.map((step, i) => {
                    const colors = PHASE_COLORS[step.phase] || PHASE_COLORS.init;
                    return (
                      <div
                        key={i}
                        className={`shrink-0 w-40 cursor-pointer rounded-lg border ${expandedStep === i ? colors.border + " " + colors.bg : "border-gray-800"} overflow-hidden transition-all hover:border-gray-600`}
                        onClick={() => setExpandedStep(expandedStep === i ? null : i)}
                      >
                        <img
                          src={`http://localhost:4100/screenshots/${step.file}`}
                          alt={`Step ${step.step}`}
                          className="w-full h-24 object-cover object-top"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <div className="p-1.5">
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                            <span className="text-[10px] text-gray-500 font-mono">#{String(step.step).padStart(2, "0")}</span>
                          </div>
                          <p className="text-[10px] text-gray-400 line-clamp-2 leading-tight">{step.label}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Fallback: simple grid for legacy results without steps */}
          {!hasSteps && result.result.screenshots.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Screenshots</h3>
              <div className="grid grid-cols-2 gap-3">
                {result.result.screenshots.map((ss, i) => (
                  <div key={i} className="rounded-lg overflow-hidden border border-gray-800 bg-gray-900">
                    <img
                      src={`http://localhost:4100/screenshots/${ss}`}
                      alt={`Screenshot ${i + 1}`}
                      className="w-full"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                    <p className="p-2 text-xs text-gray-500">{ss}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Text Report */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Persona Report</h3>
            <div className="p-4 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
              {result.result.textReport}
            </div>
          </div>

          {/* UX Feedback scores */}
          {result.result.uxFeedback && (
            <div>
              <h3 className="text-lg font-semibold mb-3">UX Feedback</h3>
              <div className="grid grid-cols-4 gap-3 mb-4">
                {["overall_score", "usability", "visual_design", "performance"].map(key => {
                  const val = result.result!.uxFeedback[key];
                  if (val === undefined) return null;
                  return (
                    <div key={key} className="p-3 rounded-lg bg-gray-900 border border-gray-800 text-center">
                      <p className="text-xs text-gray-500 mb-1">{key.replace(/_/g, " ")}</p>
                      <p className={`text-xl font-bold ${
                        Number(val) >= 4 ? "text-green-400" :
                        Number(val) >= 3 ? "text-yellow-400" : "text-red-400"
                      }`}>
                        {String(val)}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Issues */}
              {Array.isArray(result.result.uxFeedback.issues_found) && (
                <div className="mb-3">
                  <p className="text-sm text-gray-400 mb-2">Issues Found:</p>
                  <ul className="space-y-1">
                    {(result.result.uxFeedback.issues_found as string[]).map((issue, i) => (
                      <li key={i} className="text-sm text-red-300 pl-3 border-l-2 border-red-500/30">{issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Suggestions */}
              {Array.isArray(result.result.uxFeedback.suggestions) && (
                <div>
                  <p className="text-sm text-gray-400 mb-2">Suggestions:</p>
                  <ul className="space-y-1">
                    {(result.result.uxFeedback.suggestions as string[]).map((sug, i) => (
                      <li key={i} className="text-sm text-cyan-300 pl-3 border-l-2 border-cyan-500/30">{sug}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Action Log */}
          <details className="rounded-lg bg-gray-900 border border-gray-800">
            <summary className="p-3 text-sm text-gray-400 cursor-pointer hover:text-gray-300">
              Action Log ({result.result.actionLog.length} entries)
            </summary>
            <div className="px-3 pb-3 space-y-1">
              {result.result.actionLog.map((action, i) => (
                <p key={i} className="text-xs text-gray-500 font-mono">{action}</p>
              ))}
            </div>
          </details>

          {/* TX Link */}
          {result.result.txSignature && !result.result.txSignature.startsWith("pending") && (
            <div className="flex items-center gap-2 text-sm p-3 rounded-lg bg-gray-900 border border-gray-800">
              <span className="text-gray-400">41R Token Settlement:</span>
              <a
                href={`https://explorer.solana.com/tx/${result.result.txSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline font-mono text-xs"
              >
                {result.result.txSignature.slice(0, 24)}...
              </a>
              <span className="ml-auto text-xs text-green-400">Confirmed on Devnet</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
