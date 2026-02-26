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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RadarChart title="Feedback Pattern" data={vector.feedback_pattern} color="#4ade80" />
        <RadarChart title="Reliability" data={vector.reliability} color="#fb923c" />
      </div>

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
