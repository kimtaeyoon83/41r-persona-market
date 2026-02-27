"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { testerApi } from "@/lib/api";
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
  primary_device?: string;
  design_matters?: boolean;
  frustration_triggers?: string[];
}

interface TesterStats {
  totalReports: number;
  validReports: number;
  rejectedReports: number;
  avgQuality: number;
  usdcEarned: number;
  tokenEarned: number;
}

interface TesterWithStats {
  walletAddress: string;
  displayName: string;
  profile: TesterProfile | null;
  testsDone: number;
  personaId: string | null;
  createdAt: string;
  stats: TesterStats;
  persona: { id: string; isActive: boolean; hasAttestation: boolean } | null;
}

export default function TesterListPage() {
  const [testers, setTesters] = useState<TesterWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"reports" | "quality" | "earned" | "recent">("reports");

  useEffect(() => {
    testerApi.list()
      .then((data) => setTesters(data as TesterWithStats[]))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load testers"))
      .finally(() => setLoading(false));
  }, []);

  const sorted = useMemo(() =>
    [...testers].sort((a, b) => {
      switch (sortBy) {
        case "reports": return b.stats.totalReports - a.stats.totalReports;
        case "quality": return b.stats.avgQuality - a.stats.avgQuality;
        case "earned": return b.stats.usdcEarned - a.stats.usdcEarned;
        case "recent": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default: return 0;
      }
    }),
    [testers, sortBy]
  );

  const { totalUsdc, totalReports, withPersona } = useMemo(() => ({
    totalUsdc: testers.reduce((sum, t) => sum + t.stats.usdcEarned, 0),
    totalReports: testers.reduce((sum, t) => sum + t.stats.totalReports, 0),
    withPersona: testers.filter(t => t.persona).length,
  }), [testers]);

  if (loading) return <Loading variant="skeleton" />;
  if (error) return <ErrorDisplay message={error} />;

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold mb-2">All Testers</h1>
        <p className="text-[var(--text-secondary)] text-sm">Registered testers and their testing activity</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Total Testers</p>
          <p className="text-2xl font-display font-bold text-[var(--text-primary)] mt-1">{testers.length}</p>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Total Reports</p>
          <p className="text-2xl font-display font-bold text-sol-blue mt-1">{totalReports}</p>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">With Persona</p>
          <p className="text-2xl font-display font-bold text-sol-purple mt-1">{withPersona}</p>
        </div>
        <div className="p-4 rounded-xl bg-surface border border-border-dim">
          <p className="text-xs text-[var(--text-tertiary)] font-mono uppercase tracking-wider">Total Earned</p>
          <p className="text-2xl font-display font-bold text-sol-green mt-1">${totalUsdc.toFixed(0)}</p>
        </div>
      </div>

      {/* Sort Controls */}
      <div className="flex gap-2 mb-4">
        {(["reports", "quality", "earned", "recent"] as const).map(s => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
              sortBy === s
                ? "bg-sol-green/10 text-sol-green border border-sol-green/20"
                : "bg-surface-elevated text-[var(--text-tertiary)] border border-border-dim hover:border-border-hover"
            }`}
          >
            {s === "reports" ? "Most Active" : s === "quality" ? "Top Quality" : s === "earned" ? "Top Earners" : "Recent"}
          </button>
        ))}
      </div>

      {/* Tester List */}
      {sorted.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">No testers registered yet</div>
      ) : (
        <div className="space-y-3">
          {sorted.map((tester) => (
            <Link
              key={tester.walletAddress}
              href={`/tester/${tester.walletAddress}`}
              className="block p-5 rounded-xl border border-border-dim bg-surface hover:border-sol-green/30 hover:bg-surface-elevated transition-all card-hover"
            >
              <div className="flex items-start justify-between gap-4">
                {/* Left: Name + Profile */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sol-purple/20 to-sol-blue/20 border border-border-dim flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-display font-bold text-sol-purple">
                        {tester.displayName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <h3 className="font-medium text-[var(--text-primary)] text-sm">{tester.displayName}</h3>
                      <p className="text-[11px] font-mono text-[var(--text-tertiary)]">
                        {tester.walletAddress.slice(0, 8)}...{tester.walletAddress.slice(-6)}
                      </p>
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {tester.profile?.expertise?.slice(0, 3).map(e => (
                      <span key={e} className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-sol-blue/8 text-sol-blue border border-sol-blue/15">
                        {e}
                      </span>
                    ))}
                    {tester.profile?.age_range && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-sol-purple/8 text-sol-purple/80">
                        {tester.profile.age_range}
                      </span>
                    )}
                    {tester.profile?.primary_device && (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-surface-elevated text-[var(--text-tertiary)]">
                        {tester.profile.primary_device}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: Stats */}
                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    {tester.persona && (
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono border ${
                        tester.persona.hasAttestation
                          ? "bg-sol-green/10 text-sol-green border-sol-green/20"
                          : "bg-sol-purple/10 text-sol-purple border-sol-purple/20"
                      }`}>
                        {tester.persona.hasAttestation ? "SAS" : "Persona"}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono ${
                      tester.testsDone >= 3
                        ? "bg-sol-green/8 text-sol-green"
                        : "bg-surface-elevated text-[var(--text-tertiary)]"
                    }`}>
                      {tester.testsDone} tests
                    </span>
                  </div>

                  <div className="flex gap-3 text-[11px] text-[var(--text-tertiary)]">
                    {tester.stats.avgQuality > 0 && (
                      <span>
                        Q: <span className={`font-semibold ${
                          tester.stats.avgQuality >= 4 ? "text-sol-green" :
                          tester.stats.avgQuality >= 3 ? "text-[var(--status-warning)]" : "text-[var(--status-error)]"
                        }`}>{tester.stats.avgQuality.toFixed(1)}</span>
                      </span>
                    )}
                    {tester.stats.usdcEarned > 0 && (
                      <span className="text-sol-green font-mono">${tester.stats.usdcEarned.toFixed(1)}</span>
                    )}
                    {tester.stats.tokenEarned > 0 && (
                      <span className="text-sol-purple font-mono">{tester.stats.tokenEarned.toFixed(0)} 41R</span>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
