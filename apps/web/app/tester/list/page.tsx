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

  const loadTesters = () => {
    setLoading(true);
    setError(null);
    testerApi.list()
      .then((data) => setTesters(data as TesterWithStats[]))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load testers"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTesters();
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
  if (error) return <ErrorDisplay message={error} onRetry={loadTesters} />;

  return (
    <div className="max-w-5xl">
      <div className="mb-7">
        <h1 className="t-display-m mb-1">All Testers</h1>
        <p className="t-caption">Registered testers and their testing activity</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: "Total Testers", value: testers.length, tone: "text-[var(--fg-0)]" },
          { label: "Total Reports", value: totalReports, tone: "text-sol-blue" },
          { label: "With Persona", value: withPersona, tone: "text-sol-purple" },
          { label: "Total Earned", value: `$${totalUsdc.toFixed(0)}`, tone: "text-sol-green" },
        ].map((s) => (
          <div key={s.label} className="hf-card p-4">
            <div className="t-label">{s.label}</div>
            <div className={`money mt-1 text-2xl font-semibold ${s.tone}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Sort Controls */}
      <div className="flex gap-1.5 mb-4">
        {(["reports", "quality", "earned", "recent"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`chip ${sortBy === s ? "accent" : ""}`}
            style={{ cursor: "pointer" }}
          >
            {s === "reports" ? "Most Active" : s === "quality" ? "Top Quality" : s === "earned" ? "Top Earners" : "Recent"}
          </button>
        ))}
      </div>

      {/* Tester List */}
      {sorted.length === 0 ? (
        <div className="text-center py-12 t-caption">No testers registered yet</div>
      ) : (
        <div className="space-y-2">
          {sorted.map((tester) => (
            <Link
              key={tester.walletAddress}
              href={`/tester/${tester.walletAddress}`}
              className="hf-card card-hover block p-4 hover:border-[var(--line-2)]"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-[var(--r-2)] bg-gradient-to-br from-sol-purple/20 to-sol-blue/20 border border-[var(--line-1)] flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-display font-semibold text-sol-purple">
                        {tester.displayName.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <h3 className="t-body font-medium">{tester.displayName}</h3>
                      <p className="addr">
                        {tester.walletAddress.slice(0, 8)}…{tester.walletAddress.slice(-6)}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {tester.profile?.expertise?.slice(0, 3).map((e) => (
                      <span key={e} className="chip info">{e}</span>
                    ))}
                    {tester.profile?.age_range && (
                      <span className="chip">{tester.profile.age_range}</span>
                    )}
                    {tester.profile?.primary_device && (
                      <span className="chip ghost">{tester.profile.primary_device}</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-2 flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    {tester.persona && (
                      <span className={`chip ${tester.persona.hasAttestation ? "success" : "accent"}`}>
                        {tester.persona.hasAttestation ? "SAS" : "Persona"}
                      </span>
                    )}
                    <span className={`chip ${tester.testsDone >= 3 ? "success" : ""}`}>
                      {tester.testsDone} tests
                    </span>
                  </div>

                  <div className="flex gap-3 t-caption">
                    {tester.stats.avgQuality > 0 && (
                      <span>
                        Q <span className={`money font-semibold ${
                          tester.stats.avgQuality >= 4 ? "text-sol-green" :
                          tester.stats.avgQuality >= 3 ? "text-[var(--warn)]" : "text-[var(--danger)]"
                        }`}>{tester.stats.avgQuality.toFixed(1)}</span>
                      </span>
                    )}
                    {tester.stats.usdcEarned > 0 && (
                      <span className="text-sol-green money">${tester.stats.usdcEarned.toFixed(1)}</span>
                    )}
                    {tester.stats.tokenEarned > 0 && (
                      <span className="text-sol-purple money">{tester.stats.tokenEarned.toFixed(0)} 41R</span>
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
