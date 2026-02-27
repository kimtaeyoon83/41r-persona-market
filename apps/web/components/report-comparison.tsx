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
      <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      <div className="flex items-center gap-2">
        <div className="w-24 h-2 bg-surface-card rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${(score / 5) * 100}%`, backgroundColor: color }}
          />
        </div>
        <span className="text-sm font-mono font-semibold" style={{ color }}>
          {score.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "passed") {
    return <span className="text-sol-green text-[11px] font-mono font-medium">PASS</span>;
  }
  if (status === "failed") {
    return <span className="text-[var(--status-error)] text-[11px] font-mono font-medium">FAIL</span>;
  }
  return <span className="text-[var(--status-warning)] text-[11px] font-mono font-medium">BLOCK</span>;
}

export function ReportComparison({ manualReport, autoReport }: ReportComparisonProps) {
  const scoreDiff = autoReport.quality_score - manualReport.quality_score;
  const diffColor = scoreDiff > 0 ? "text-sol-green" : scoreDiff < 0 ? "text-[var(--status-error)]" : "text-[var(--text-tertiary)]";

  return (
    <div className="space-y-6">
      <div className="p-5 rounded-xl bg-surface border border-border-dim">
        <h3 className="text-sm font-mono text-[var(--text-primary)] mb-4">Quality Score Comparison</h3>
        <div className="grid grid-cols-2 gap-6">
          <ScoreDisplay score={manualReport.quality_score} label="Manual" color="#00C2FF" />
          <ScoreDisplay score={autoReport.quality_score} label="Auto" color="#14F195" />
        </div>
        <div className="mt-3 pt-3 border-t border-border-dim text-center">
          <span className="text-xs text-[var(--text-tertiary)]">Difference: </span>
          <span className={`text-sm font-mono font-semibold ${diffColor}`}>
            {scoreDiff > 0 ? "+" : ""}{scoreDiff.toFixed(1)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-xl bg-surface border border-sol-blue/20">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-sol-blue" />
            <h4 className="text-sm font-mono font-medium text-sol-blue">Manual Report</h4>
          </div>

          {manualReport.checklist_results && manualReport.checklist_results.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-[var(--text-tertiary)] mb-2 font-mono">Checklist Results</p>
              <div className="space-y-1.5">
                {manualReport.checklist_results.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-2 py-1 rounded-lg bg-surface-elevated/50">
                    <span className="text-xs font-mono text-[var(--text-secondary)]">{item.id}</span>
                    <StatusIcon status={item.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(manualReport.text || manualReport.summary) && (
            <div>
              <p className="text-xs text-[var(--text-tertiary)] mb-2 font-mono">Report Text</p>
              <p className="text-xs text-[var(--text-primary)] leading-relaxed">
                {manualReport.text || manualReport.summary}
              </p>
            </div>
          )}
        </div>

        <div className="p-4 rounded-xl bg-surface border border-sol-green/20">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-sol-green" />
            <h4 className="text-sm font-mono font-medium text-sol-green">Auto Report</h4>
          </div>

          {autoReport.checklist_results && autoReport.checklist_results.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-[var(--text-tertiary)] mb-2 font-mono">Checklist Results</p>
              <div className="space-y-1.5">
                {autoReport.checklist_results.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-2 py-1 rounded-lg bg-surface-elevated/50">
                    <span className="text-xs font-mono text-[var(--text-secondary)]">{item.id}</span>
                    <StatusIcon status={item.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(autoReport.text || autoReport.summary) && (
            <div>
              <p className="text-xs text-[var(--text-tertiary)] mb-2 font-mono">Report Text</p>
              <p className="text-xs text-[var(--text-primary)] leading-relaxed">
                {autoReport.text || autoReport.summary}
              </p>
            </div>
          )}
        </div>
      </div>

      {manualReport.checklist_results && autoReport.checklist_results && (
        <div className="p-4 rounded-xl bg-surface/50 border border-border-dim">
          <h4 className="text-sm font-mono font-medium text-[var(--text-primary)] mb-3">Agreement Analysis</h4>
          <div className="space-y-1.5">
            {manualReport.checklist_results.map((manual) => {
              const auto = autoReport.checklist_results?.find((a) => a.id === manual.id);
              const agree = auto && auto.status === manual.status;
              return (
                <div
                  key={manual.id}
                  className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs ${
                    agree ? "bg-sol-green/5 border border-sol-green/10" : "bg-[var(--status-error)]/5 border border-[var(--status-error)]/10"
                  }`}
                >
                  <span className="font-mono text-[var(--text-secondary)]">{manual.id}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-sol-blue font-mono">{manual.status}</span>
                    <span className="text-[var(--text-tertiary)]">vs</span>
                    <span className="text-sol-green font-mono">{auto?.status || "n/a"}</span>
                    <span className={agree ? "text-sol-green font-mono" : "text-[var(--status-error)] font-mono"}>
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
