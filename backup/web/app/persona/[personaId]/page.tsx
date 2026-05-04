"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { personaApi } from "@/lib/api";
import { RadarChart } from "@/components/radar-chart";
import { PersonaRadar20 } from "@/components/persona-radar-20";
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
            <h1 className="t-display-m mb-1">Persona Detail</h1>
            <p className="addr">{persona.id}</p>
          </div>
          <div className="flex items-center gap-2">
            {persona.isActive && (
              <span className="chip success"><span className="chip-dot" />Active</span>
            )}
            <SasBadge tier={sasTier} attestId={persona.sasAttestId || undefined} />
          </div>
        </div>
      </div>

      {/* Voice Sample — hero quote */}
      <div className="hf-card mb-8 p-6" style={{ background: "linear-gradient(135deg, rgba(20,241,149,0.05), rgba(153,69,255,0.05))", borderColor: "rgba(20,241,149,0.22)" }}>
        <div className="t-label mb-3" style={{ color: "rgba(20,241,149,0.8)" }}>How this persona thinks</div>
        <blockquote className="relative">
          <span className="absolute -top-2 -left-1 text-4xl text-sol-green/30 font-display leading-none">&ldquo;</span>
          <p className="pl-6 t-body-l italic leading-relaxed">{vector.voice_sample}</p>
        </blockquote>
      </div>

      {/* 20-dim persona signature — flattens all 4 buckets into one polygon */}
      <div className="hf-card mb-4 p-6">
        <div className="flex items-start gap-6 flex-wrap">
          <PersonaRadar20 vector={vector} size={260} />
          <div className="flex-1 min-w-[260px]">
            <div className="t-label mb-3">Persona signature · 20 dimensions</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
              {Object.entries({ ...vector.test_style, ...vector.expertise, ...vector.feedback_pattern, ...vector.reliability }).slice(0, 16).map(([k, v]) => {
                const val = k === "quality_score" && Number(v) > 1 ? Number(v) / 5 : Number(v);
                return (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <span className="text-[var(--fg-2)] truncate">{k.replace(/_/g, " ")}</span>
                    <span className="money text-[var(--fg-0)]">{(val * 100).toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Per-bucket deep dives (kept as 4 secondary radars for drill-down) */}
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
            <div className="hf-card p-5">
              <div className="t-label mb-3" style={{ color: "var(--sol-purple)" }}>Demographics</div>
              <div className="space-y-2.5">
                {Object.entries(vector.demographics).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="t-caption">{key.replace(/_/g, " ")}</span>
                    {typeof val === "number" ? (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-[var(--bg-2)] rounded-full overflow-hidden">
                          <div className="h-full bg-sol-purple rounded-full" style={{ width: `${val * 100}%` }} />
                        </div>
                        <span className="addr w-10 text-right">{(val * 100).toFixed(0)}%</span>
                      </div>
                    ) : (
                      <span className="chip" style={{ background: "rgba(153,69,255,0.12)", color: "var(--sol-purple)", borderColor: "rgba(153,69,255,0.24)" }}>{String(val)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {vector.ux_preferences && (
            <div className="hf-card p-5">
              <div className="t-label mb-3" style={{ color: "var(--sol-blue)" }}>UX Preferences</div>
              <div className="space-y-2.5">
                {Object.entries(vector.ux_preferences).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="t-caption">{key.replace(/_/g, " ")}</span>
                    <span className={`chip ${
                      typeof val === "boolean" ? (val ? "success" : "") : "info"
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
      <div className="hf-card mt-6 p-4">
        <div className="flex flex-wrap gap-6 addr">
          <span>Tester: {persona.testerAddr.slice(0, 12)}…</span>
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
