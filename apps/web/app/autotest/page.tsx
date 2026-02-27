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

interface AutoTestResult {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress?: number;
  report_id?: string;
  error?: string;
  result?: {
    screenshots: string[];
    actionLog: string[];
    textReport: string;
    uxFeedback: Record<string, unknown>;
    txSignature?: string;
  };
}

export default function AutoTestPage() {
  const [tests, setTests] = useState<Test[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedTest, setSelectedTest] = useState("");
  const [selectedPersona, setSelectedPersona] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutoTestResult | null>(null);
  const [polling, setPolling] = useState(false);

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

  return (
    <div className="max-w-4xl mx-auto">
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
            <h3 className="text-sm font-medium text-green-400 mb-1">Auto Test Complete</h3>
            {result.report_id && (
              <a href={`/report/${result.report_id}`} className="text-xs text-cyan-400 hover:underline">
                View full report
              </a>
            )}
          </div>

          {/* Screenshots */}
          {result.result.screenshots.length > 0 && (
            <div>
              <h3 className="text-lg font-semibold mb-3">Screenshots</h3>
              <div className="grid grid-cols-2 gap-3">
                {result.result.screenshots.map((ss, i) => (
                  <div key={i} className="rounded-lg overflow-hidden border border-gray-800 bg-gray-900">
                    <img
                      src={`http://localhost:4100/screenshots/${ss}`}
                      alt={`Screenshot ${i + 1}`}
                      className="w-full"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
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
            <div className="text-sm">
              <span className="text-gray-400">Settlement TX: </span>
              <a
                href={`https://explorer.solana.com/tx/${result.result.txSignature}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline font-mono text-xs"
              >
                {result.result.txSignature.slice(0, 20)}...
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
