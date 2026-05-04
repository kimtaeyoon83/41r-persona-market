"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { testerApi, reportApi } from "@/lib/api";
import { Loading } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";

interface TesterProfile {
  age_range?: string;
  region?: string;
  occupation?: string;
  expertise: string[];
  experience_level: string;
  crypto_experience?: string;
  preferred_domains: string[];
  ui_preference?: string;
  languages?: string[];
  device_types?: string[];
  primary_device?: string;
  design_matters?: boolean;
  frustration_triggers?: string[];
}

interface Tester {
  walletAddress: string;
  displayName: string;
  profile: TesterProfile | null;
  testsDone: number;
  personaId: string | null;
  createdAt: string;
}

interface Settlement {
  id: string;
  amountToken: number;
  settlementType: string;
  txSignature: string;
  settledAt: string;
}

interface ReportWithTest {
  id: string;
  testerAddr: string;
  testId: string;
  checklistResults: Array<{ id: string; status: string; memo: string }>;
  scenarioLog: Array<{ id: string; timeline: Array<{ time: string; action: string }> }>;
  questionnaireAnswers: Array<{ id: string; answer: string | number }>;
  qualityScore: number;
  isPersonaTest: boolean;
  createdAt: string;
  test: { id: string; targetUrl: string; requirements: string; status: string } | null;
  settlements: Settlement[];
}

interface Persona {
  id: string;
  vector: Record<string, unknown>;
  isActive: boolean;
  sasAttestId: string | null;
}

export default function TesterDetailPage() {
  const params = useParams();
  const wallet = params.wallet as string;
  const [tester, setTester] = useState<Tester | null>(null);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [reports, setReports] = useState<ReportWithTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTester = () => {
    if (!wallet) return;
    setLoading(true);
    setError(null);

    Promise.all([
      testerApi.get(wallet) as Promise<{ tester: Tester; persona: Persona | null }>,
      reportApi.byTester(wallet) as Promise<ReportWithTest[]>,
    ])
      .then(([testerData, reportsData]) => {
        setTester(testerData.tester);
        setPersona(testerData.persona);
        setReports(reportsData);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load tester"))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadTester(); }, [wallet]);

  if (loading) return <Loading variant="skeleton" />;
  if (error) return <ErrorDisplay message={error} onRetry={loadTester} />;
  if (!tester) return <ErrorDisplay message="Tester not found" />;

  const profile = tester.profile;
  const validReports = reports.filter(r => (r.qualityScore ?? 0) >= 1.5);
  const lowCoverageReports = reports.filter(r => (r.qualityScore ?? 0) < 1.5);
  const sessionLimitedCount = lowCoverageReports.filter(r => r.isPersonaTest).length;
  const manualLowCount = lowCoverageReports.length - sessionLimitedCount;
  const avgQuality = validReports.length > 0
    ? validReports.reduce((sum, r) => sum + (r.qualityScore ?? 0), 0) / validReports.length
    : 0;
  const totalUsdc = reports.flatMap(r => r.settlements || [])
    .filter(s => s.settlementType === "usdc")
    .reduce((sum, s) => sum + s.amountToken, 0);
  const totalToken = reports.flatMap(r => r.settlements || [])
    .filter(s => s.settlementType === "41r")
    .reduce((sum, s) => sum + s.amountToken, 0);

  const checklistStats = reports.reduce(
    (acc, r) => {
      for (const c of (r.checklistResults || [])) {
        if (c.status === "passed") acc.passed++;
        else if (c.status === "failed") acc.failed++;
        else acc.blocked++;
      }
      return acc;
    },
    { passed: 0, failed: 0, blocked: 0 }
  );

  return (
    <div className="max-w-4xl">
      {/* Breadcrumb */}
      <div className="mb-6 flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
        <Link href="/tester/list" className="hover:text-[var(--text-secondary)] transition-colors">All Testers</Link>
        <span>/</span>
        <span className="text-[var(--text-secondary)]">{tester.displayName}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sol-purple/20 to-sol-blue/20 border border-border-dim flex items-center justify-center">
            <span className="text-xl font-display font-bold text-sol-purple">
              {tester.displayName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold">{tester.displayName}</h1>
            <p className="text-xs font-mono text-[var(--text-tertiary)] mt-0.5">
              {tester.walletAddress}
            </p>
            <p className="text-xs text-[var(--text-tertiary)] mt-1">
              Joined {new Date(tester.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {persona && (
            <Link
              href={`/persona/${persona.id}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono border transition-colors hover:opacity-80 ${
                persona.sasAttestId
                  ? "bg-sol-green/10 text-sol-green border-sol-green/20"
                  : "bg-sol-purple/10 text-sol-purple border-sol-purple/20"
              }`}
            >
              {persona.sasAttestId ? "SAS Verified" : "View Persona"}
            </Link>
          )}
          {!persona && tester.testsDone >= 3 && (
            <span className="px-3 py-1.5 rounded-lg text-xs font-mono bg-[var(--status-warning)]/10 text-[var(--status-warning)] border border-[var(--status-warning)]/20">
              Persona Ready
            </span>
          )}
        </div>
      </div>

      {/* Profile Info */}
      {profile && (
        <div className="p-5 rounded-xl bg-surface border border-border-dim mb-6">
          <h3 className="text-xs font-mono text-[var(--text-tertiary)] uppercase tracking-wider mb-3">Profile</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
            {profile.occupation && (
              <div>
                <span className="text-xs text-[var(--text-tertiary)]">Occupation</span>
                <p className="text-[var(--text-primary)]">{profile.occupation}</p>
              </div>
            )}
            {profile.age_range && (
              <div>
                <span className="text-xs text-[var(--text-tertiary)]">Age</span>
                <p className="text-[var(--text-primary)]">{profile.age_range}</p>
              </div>
            )}
            {profile.region && (
              <div>
                <span className="text-xs text-[var(--text-tertiary)]">Region</span>
                <p className="text-[var(--text-primary)]">{profile.region}</p>
              </div>
            )}
            {profile.experience_level && (
              <div>
                <span className="text-xs text-[var(--text-tertiary)]">Experience</span>
                <p className="text-[var(--text-primary)]">{profile.experience_level}</p>
              </div>
            )}
            {profile.crypto_experience && (
              <div>
                <span className="text-xs text-[var(--text-tertiary)]">Crypto</span>
                <p className="text-[var(--text-primary)]">{profile.crypto_experience}</p>
              </div>
            )}
            {profile.primary_device && (
              <div>
                <span className="text-xs text-[var(--text-tertiary)]">Device</span>
                <p className="text-[var(--text-primary)]">{profile.primary_device}</p>
              </div>
            )}
          </div>

          {profile.expertise?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border-dim">
              <span className="text-xs text-[var(--text-tertiary)]">Expertise</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {profile.expertise.map(e => (
                  <span key={e} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-sol-blue/8 text-sol-blue border border-sol-blue/15">
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}

          {profile.preferred_domains?.length > 0 && (
            <div className="mt-2">
              <span className="text-xs text-[var(--text-tertiary)]">Preferred Domains</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {profile.preferred_domains.map(d => (
                  <span key={d} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-sol-purple/8 text-sol-purple border border-sol-purple/15">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {profile.frustration_triggers && profile.frustration_triggers.length > 0 && (
            <div className="mt-2">
              <span className="text-xs text-[var(--text-tertiary)]">Frustration Triggers</span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {profile.frustration_triggers.map(f => (
                  <span key={f} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-[var(--status-error)]/8 text-[var(--status-error)]/80 border border-[var(--status-error)]/15">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono">Tests Done</p>
          <p className="text-xl font-display font-bold text-sol-blue mt-1">{tester.testsDone}</p>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono">Avg Quality</p>
          <p className={`text-xl font-display font-bold mt-1 ${
            avgQuality >= 4 ? "text-sol-green" :
            avgQuality >= 3 ? "text-[var(--status-warning)]" : "text-[var(--status-error)]"
          }`}>{avgQuality > 0 ? `${avgQuality.toFixed(1)}/5` : "—"}</p>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono">USDC Earned</p>
          <p className="text-xl font-display font-bold text-sol-green mt-1">${totalUsdc.toFixed(2)}</p>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono">41R Earned</p>
          <p className="text-xl font-display font-bold text-sol-purple mt-1">{totalToken > 0 ? totalToken.toFixed(0) : "—"}</p>
        </div>
      </div>

      {/* Checklist Performance */}
      {(checklistStats.passed + checklistStats.failed + checklistStats.blocked) > 0 && (
        <div className="p-4 rounded-xl bg-surface border border-border-dim mb-6">
          <h3 className="text-xs font-mono text-[var(--text-tertiary)] uppercase tracking-wider mb-3">Checklist Performance</h3>
          <div className="flex gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-sol-green" />
              <span className="text-[var(--text-secondary)]">Passed: <span className="font-semibold text-sol-green">{checklistStats.passed}</span></span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--status-error)]" />
              <span className="text-[var(--text-secondary)]">Failed: <span className="font-semibold text-[var(--status-error)]">{checklistStats.failed}</span></span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--status-warning)]" />
              <span className="text-[var(--text-secondary)]">Blocked: <span className="font-semibold text-[var(--status-warning)]">{checklistStats.blocked}</span></span>
            </div>
          </div>
          {/* Progress bar */}
          <div className="mt-3 h-2 rounded-full bg-surface-card overflow-hidden flex">
            {checklistStats.passed > 0 && (
              <div className="h-full bg-sol-green" style={{ width: `${(checklistStats.passed / (checklistStats.passed + checklistStats.failed + checklistStats.blocked)) * 100}%` }} />
            )}
            {checklistStats.failed > 0 && (
              <div className="h-full bg-[var(--status-error)]" style={{ width: `${(checklistStats.failed / (checklistStats.passed + checklistStats.failed + checklistStats.blocked)) * 100}%` }} />
            )}
            {checklistStats.blocked > 0 && (
              <div className="h-full bg-[var(--status-warning)]" style={{ width: `${(checklistStats.blocked / (checklistStats.passed + checklistStats.failed + checklistStats.blocked)) * 100}%` }} />
            )}
          </div>
        </div>
      )}

      {/* Test History */}
      <div>
        <h2 className="font-display text-lg font-semibold mb-4">Test History ({reports.length})</h2>

        {reports.length === 0 ? (
          <div className="text-center py-8 text-[var(--text-secondary)] text-sm">No test reports yet</div>
        ) : (
          <div className="space-y-3">
            {[...reports]
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((report) => {
                const isLowCoverage = (report.qualityScore ?? 0) < 1.5;
                // Persona sessions that get cut short on hard sites
                // end up here but aren't really "rejected" — they're
                // session-limited. Human manual submissions below the
                // threshold genuinely are low-coverage.
                const lowCovLabel = report.isPersonaTest ? 'Session limited' : 'Low coverage';
                const usdcSettlement = report.settlements?.find(s => s.settlementType === "usdc");
                const tokenSettlement = report.settlements?.find(s => s.settlementType === "41r");
                const passedCount = (report.checklistResults || []).filter(c => c.status === "passed").length;
                const failedCount = (report.checklistResults || []).filter(c => c.status === "failed").length;
                const totalChecklist = (report.checklistResults || []).length;

                return (
                  <Link
                    key={report.id}
                    href={`/report/${report.id}`}
                    className={`block p-4 rounded-xl border transition-all card-hover ${
                      isLowCoverage
                        ? "border-[var(--warn-line)] bg-surface opacity-60 hover:opacity-80"
                        : "border-border-dim bg-surface hover:border-sol-green/30 hover:bg-surface-elevated"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        {/* Target URL */}
                        <div className="flex items-center gap-2 mb-1.5">
                          {report.test ? (
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                              {report.test.targetUrl}
                            </p>
                          ) : (
                            <p className="text-sm text-[var(--text-tertiary)] font-mono">{report.testId.slice(0, 12)}...</p>
                          )}
                          {report.isPersonaTest && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-sol-purple/10 text-sol-purple flex-shrink-0">
                              AI
                            </span>
                          )}
                          {isLowCoverage && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[var(--warn-soft)] text-[var(--warn)] flex-shrink-0">
                              {lowCovLabel}
                            </span>
                          )}
                        </div>

                        {/* Checklist summary */}
                        {totalChecklist > 0 && (
                          <div className="flex items-center gap-3 text-[11px] text-[var(--text-tertiary)]">
                            <span className="text-sol-green">{passedCount} passed</span>
                            {failedCount > 0 && <span className="text-[var(--status-error)]">{failedCount} failed</span>}
                            <span>{totalChecklist} total</span>
                          </div>
                        )}

                        <p className="text-[11px] text-[var(--text-tertiary)] mt-1">
                          {new Date(report.createdAt).toLocaleDateString()} {new Date(report.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>

                      {/* Right: Score + Payments */}
                      <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                        <div className={`px-2 py-0.5 rounded-md text-xs font-mono font-semibold ${
                          isLowCoverage ? "bg-[var(--warn-soft)] text-[var(--warn)]" :
                          (report.qualityScore ?? 0) >= 4 ? "bg-sol-green/10 text-sol-green" :
                          (report.qualityScore ?? 0) >= 3 ? "bg-[var(--status-warning)]/10 text-[var(--status-warning)]" :
                          "bg-surface-elevated text-[var(--text-tertiary)]"
                        }`}>
                          {(report.qualityScore ?? 0).toFixed(1)}/5
                        </div>

                        {!isLowCoverage && (usdcSettlement || tokenSettlement) ? (
                          <div className="flex items-center gap-2 text-[11px]">
                            {usdcSettlement && (
                              <span className="text-sol-green font-mono">${usdcSettlement.amountToken.toFixed(2)}</span>
                            )}
                            {tokenSettlement && (
                              <span className="text-sol-purple font-mono">{tokenSettlement.amountToken.toFixed(0)} 41R</span>
                            )}
                          </div>
                        ) : isLowCoverage ? (
                          <span className="text-[11px] text-[var(--warn)]">Not rewarded</span>
                        ) : null}
                      </div>
                    </div>
                  </Link>
                );
              })}
          </div>
        )}
      </div>

      {/* Low-coverage reports note */}
      {lowCoverageReports.length > 0 && (
        <div className="mt-4 p-3 rounded-lg bg-[var(--warn-soft)] border border-[var(--warn-line)] text-xs text-[var(--text-tertiary)]">
          {sessionLimitedCount > 0 && (
            <p>
              {sessionLimitedCount} persona session{sessionLimitedCount > 1 ? 's' : ''} cut short on hard sites
              (score &lt; 1.5/5 — retry from the company test page).
            </p>
          )}
          {manualLowCount > 0 && (
            <p className={sessionLimitedCount > 0 ? 'mt-1' : ''}>
              {manualLowCount} manual report{manualLowCount > 1 ? 's' : ''} below reward threshold (score &lt; 1.5/5).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
