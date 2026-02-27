"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { personaApi } from "@/lib/api";
import { RadarChart } from "@/components/radar-chart";
import { SasBadge } from "@/components/sas-badge";
import { Loading } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";


interface PersonaVector {
  test_style: Record<string, number>;
  expertise: Record<string, number>;
  feedback_pattern: Record<string, number>;
  reliability: Record<string, number>;
  demographics?: Record<string, number | string>;
  ux_preferences?: Record<string, string | boolean | number>;
  voice_sample: string;
}

interface Persona {
  id: string;
  testerAddr: string;
  vector: PersonaVector;
  isActive: boolean;
  sasAttestId: string | null;
  sasTier?: "Bronze" | "Silver" | "Gold";
  createdAt: string;
  updatedAt: string;
}

function inferSasTier(reliability: Record<string, number>): "Bronze" | "Silver" | "Gold" {
  const avg =
    Object.values(reliability).reduce((sum, v) => sum + v, 0) / Object.values(reliability).length;
  if (avg >= 0.85) return "Gold";
  if (avg >= 0.65) return "Silver";
  return "Bronze";
}

export default function PersonaDetail() {
  const params = useParams();
  const personaId = params.personaId as string;
  const [persona, setPersona] = useState<Persona | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPersona = () => {
    if (!personaId) return;
    setLoading(true);
    setError(null);
    (personaApi.get(personaId) as Promise<Persona>)
      .then(setPersona)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load persona"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPersona();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personaId]);

  if (loading) return <Loading variant="skeleton" />;
  if (error) return <ErrorDisplay message={error} onRetry={loadPersona} />;
  if (!persona) return <ErrorDisplay message="Persona not found" />;

  const { vector } = persona;
  const sasTier = persona.sasTier || inferSasTier(vector.reliability);

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold mb-2">Persona Detail</h1>
            <p className="text-xs font-mono text-[var(--text-tertiary)]">{persona.id}</p>
          </div>
          <div className="flex items-center gap-3">
            {persona.isActive && (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-sol-green/10 text-sol-green border border-sol-green/20">
                Active
              </span>
            )}
            <SasBadge tier={sasTier} attestId={persona.sasAttestId || undefined} />
          </div>
        </div>
      </div>

      {/* Voice Sample */}
      <div className="mb-6 p-5 rounded-xl bg-surface border border-border-dim">
        <h3 className="text-xs font-mono text-[var(--text-tertiary)] uppercase tracking-wider mb-2">Voice Sample</h3>
        <p className="text-sm italic text-[var(--text-primary)] leading-relaxed">&ldquo;{vector.voice_sample}&rdquo;</p>
      </div>

      {/* Radar Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <RadarChart title="Test Style" data={vector.test_style} color="#9945FF" />
        <RadarChart title="Expertise" data={vector.expertise} color="#00C2FF" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <RadarChart title="Feedback Pattern" data={vector.feedback_pattern} color="#14F195" />
        <RadarChart title="Reliability" data={{
          ...vector.reliability,
          quality_score: (vector.reliability.quality_score || 0) > 1
            ? (vector.reliability.quality_score || 0) / 5
            : (vector.reliability.quality_score || 0),
        }} color="#FFD93D" />
      </div>

      {/* Demographics + UX Preferences */}
      {(vector.demographics || vector.ux_preferences) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {vector.demographics && (
            <div className="p-5 rounded-xl bg-surface border border-border-dim">
              <h3 className="text-xs font-mono text-sol-purple uppercase tracking-wider mb-3">Demographics</h3>
              <div className="space-y-2.5">
                {Object.entries(vector.demographics).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-tertiary)]">{key.replace(/_/g, " ")}</span>
                    {typeof val === "number" ? (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-surface-card rounded-full overflow-hidden">
                          <div className="h-full bg-sol-purple rounded-full" style={{ width: `${val * 100}%` }} />
                        </div>
                        <span className="text-xs text-[var(--text-secondary)] w-10 text-right font-mono">{(val * 100).toFixed(0)}%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-sol-purple px-2 py-0.5 rounded-md bg-sol-purple/8">{String(val)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {vector.ux_preferences && (
            <div className="p-5 rounded-xl bg-surface border border-border-dim">
              <h3 className="text-xs font-mono text-sol-blue uppercase tracking-wider mb-3">UX Preferences</h3>
              <div className="space-y-2.5">
                {Object.entries(vector.ux_preferences).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-tertiary)]">{key.replace(/_/g, " ")}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-md ${
                      typeof val === "boolean"
                        ? val ? "bg-sol-green/8 text-sol-green" : "bg-surface-card text-[var(--text-tertiary)]"
                        : "bg-sol-blue/8 text-sol-blue"
                    }`}>
                      {String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer Info */}
      <div className="mt-6 p-4 rounded-xl bg-surface/50 border border-border-dim">
        <div className="flex flex-wrap gap-6 text-xs text-[var(--text-tertiary)] font-mono">
          <span>Tester: {persona.testerAddr.slice(0, 12)}...</span>
          <span>Created: {new Date(persona.createdAt).toLocaleDateString()}</span>
          <span>Updated: {new Date(persona.updatedAt).toLocaleDateString()}</span>
          {persona.sasAttestId && (
            <span className="flex items-center gap-1">
              Attestation:
              <a
                href={`https://explorer.solana.com/address/${persona.sasAttestId}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sol-green hover:text-sol-green/80 transition-colors"
              >
                <span className="font-mono text-xs">{persona.sasAttestId.slice(0, 8)}...{persona.sasAttestId.slice(-6)}</span>
                <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
