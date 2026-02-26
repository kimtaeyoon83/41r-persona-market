"use client";

interface ChecklistResult {
  id: string;
  status: string;
  memo?: string;
}

interface Report {
  quality_score: number;
  checklist_results?: ChecklistResult[];
  text?: string;
  summary?: string;
}

interface ReportComparisonProps {
  manualReport: Report;
  autoReport: Report;
}

function ScoreDisplay({ score, label, color }: { score: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-gray-400">{label}</span>
      <div className="flex items-center gap-2">
        <div className="w-24 h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${(score / 5) * 100}%`, backgroundColor: color }}
          />
        </div>
        <span className="text-sm font-semibold" style={{ color }}>
          {score.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "passed") {
    return <span className="text-green-400 text-xs font-medium">PASS</span>;
  }
  if (status === "failed") {
    return <span className="text-red-400 text-xs font-medium">FAIL</span>;
  }
  return <span className="text-yellow-400 text-xs font-medium">BLOCK</span>;
}

export function ReportComparison({ manualReport, autoReport }: ReportComparisonProps) {
  const scoreDiff = autoReport.quality_score - manualReport.quality_score;
  const diffColor = scoreDiff > 0 ? "text-green-400" : scoreDiff < 0 ? "text-red-400" : "text-gray-400";

  return (
    <div className="space-y-6">
      {/* Score Comparison Header */}
      <div className="p-5 rounded-lg bg-gray-900 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-300 mb-4">Quality Score Comparison</h3>
        <div className="grid grid-cols-2 gap-6">
          <ScoreDisplay score={manualReport.quality_score} label="Manual" color="#22d3ee" />
          <ScoreDisplay score={autoReport.quality_score} label="Auto" color="#fb923c" />
        </div>
        <div className="mt-3 pt-3 border-t border-gray-800 text-center">
          <span className="text-xs text-gray-500">Difference: </span>
          <span className={`text-sm font-semibold ${diffColor}`}>
            {scoreDiff > 0 ? "+" : ""}{scoreDiff.toFixed(1)}
          </span>
        </div>
      </div>

      {/* Side-by-side Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Manual Report */}
        <div className="p-4 rounded-lg bg-gray-900 border border-cyan-500/20">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-cyan-400" />
            <h4 className="text-sm font-medium text-cyan-300">Manual Report</h4>
          </div>

          {manualReport.checklist_results && manualReport.checklist_results.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-2">Checklist Results</p>
              <div className="space-y-1.5">
                {manualReport.checklist_results.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-2 py-1 rounded bg-gray-800/50">
                    <span className="text-xs font-mono text-gray-400">{item.id}</span>
                    <StatusIcon status={item.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(manualReport.text || manualReport.summary) && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Report Text</p>
              <p className="text-xs text-gray-300 leading-relaxed">
                {manualReport.text || manualReport.summary}
              </p>
            </div>
          )}
        </div>

        {/* Auto Report */}
        <div className="p-4 rounded-lg bg-gray-900 border border-orange-500/20">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-orange-400" />
            <h4 className="text-sm font-medium text-orange-300">Auto Report</h4>
          </div>

          {autoReport.checklist_results && autoReport.checklist_results.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-gray-500 mb-2">Checklist Results</p>
              <div className="space-y-1.5">
                {autoReport.checklist_results.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-2 py-1 rounded bg-gray-800/50">
                    <span className="text-xs font-mono text-gray-400">{item.id}</span>
                    <StatusIcon status={item.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(autoReport.text || autoReport.summary) && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Report Text</p>
              <p className="text-xs text-gray-300 leading-relaxed">
                {autoReport.text || autoReport.summary}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Checklist Agreement Analysis */}
      {manualReport.checklist_results && autoReport.checklist_results && (
        <div className="p-4 rounded-lg bg-gray-900/50 border border-gray-800">
          <h4 className="text-sm font-medium text-gray-300 mb-3">Agreement Analysis</h4>
          <div className="space-y-1.5">
            {manualReport.checklist_results.map((manual) => {
              const auto = autoReport.checklist_results?.find((a) => a.id === manual.id);
              const agree = auto && auto.status === manual.status;
              return (
                <div
                  key={manual.id}
                  className={`flex items-center justify-between px-3 py-1.5 rounded text-xs ${
                    agree ? "bg-green-500/5 border border-green-500/10" : "bg-red-500/5 border border-red-500/10"
                  }`}
                >
                  <span className="font-mono text-gray-400">{manual.id}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-cyan-400">{manual.status}</span>
                    <span className="text-gray-600">vs</span>
                    <span className="text-orange-400">{auto?.status || "n/a"}</span>
                    <span className={agree ? "text-green-400" : "text-red-400"}>
                      {agree ? "Agree" : "Disagree"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
