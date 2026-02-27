"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { personaApi } from "@/lib/api";
import { RadarChart } from "@/components/radar-chart";
import { SasBadge } from "@/components/sas-badge";
import { Loading } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";
import { TxLink } from "@/components/tx-link";

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
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-2">Persona Detail</h1>
            <p className="text-xs font-mono text-gray-500">{persona.id}</p>
          </div>
          <div className="flex items-center gap-3">
            {persona.isActive && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-green-500/10 text-green-400 border border-green-500/20">
                Active
              </span>
            )}
            {persona.sasAttestId && (
              <SasBadge tier={sasTier} attestId={persona.sasAttestId} />
            )}
            {!persona.sasAttestId && (
              <SasBadge tier={sasTier} />
            )}
          </div>
        </div>
      </div>

      {/* Voice Sample */}
      <div className="mb-6 p-4 rounded-lg bg-gray-900 border border-gray-800">
        <h3 className="text-sm font-medium text-gray-400 mb-2">Voice Sample</h3>
        <p className="text-sm italic text-gray-300">&ldquo;{vector.voice_sample}&rdquo;</p>
      </div>

      {/* Radar Charts — Test Style and Expertise */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <RadarChart title="Test Style" data={vector.test_style} color="#a78bfa" />
        <RadarChart title="Expertise" data={vector.expertise} color="#67e8f9" />
      </div>

      {/* Radar Charts — Feedback Pattern and Reliability */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <RadarChart title="Feedback Pattern" data={vector.feedback_pattern} color="#4ade80" />
        <RadarChart title="Reliability" data={vector.reliability} color="#fb923c" />
      </div>

      {/* Demographics + UX Preferences */}
      {(vector.demographics || vector.ux_preferences) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {vector.demographics && (
            <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
              <h3 className="text-sm font-medium text-pink-400 mb-3">Demographics</h3>
              <div className="space-y-2">
                {Object.entries(vector.demographics).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{key.replace(/_/g, " ")}</span>
                    {typeof val === "number" ? (
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className="h-full bg-pink-500 rounded-full" style={{ width: `${val * 100}%` }} />
                        </div>
                        <span className="text-xs text-gray-400 w-10 text-right">{(val * 100).toFixed(0)}%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-pink-300 px-2 py-0.5 rounded bg-pink-500/10">{String(val)}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {vector.ux_preferences && (
            <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
              <h3 className="text-sm font-medium text-amber-400 mb-3">UX Preferences</h3>
              <div className="space-y-2">
                {Object.entries(vector.ux_preferences).map(([key, val]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{key.replace(/_/g, " ")}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      typeof val === "boolean"
                        ? val ? "bg-green-500/10 text-green-400" : "bg-gray-700 text-gray-400"
                        : "bg-amber-500/10 text-amber-300"
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
      <div className="mt-6 p-4 rounded-lg bg-gray-900/50 border border-gray-800">
        <div className="flex flex-wrap gap-6 text-xs text-gray-500">
          <span>
            Tester:{" "}
            <span className="font-mono">{persona.testerAddr.slice(0, 12)}...</span>
          </span>
          <span>Created: {new Date(persona.createdAt).toLocaleDateString()}</span>
          <span>Updated: {new Date(persona.updatedAt).toLocaleDateString()}</span>
          {persona.sasAttestId && (
            <span className="flex items-center gap-1">
              Attestation: <TxLink txSignature={persona.sasAttestId} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
