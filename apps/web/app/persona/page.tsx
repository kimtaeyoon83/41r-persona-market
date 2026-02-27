"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { personaApi } from "@/lib/api";
import { LoadingSpinner } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";

interface PersonaVector {
  test_style: Record<string, number>;
  expertise: Record<string, number>;
  reliability: Record<string, number>;
  demographics?: { age_group?: string; tech_literacy?: number; crypto_experience?: number };
  ux_preferences?: { mobile_first?: boolean; visual_style?: string };
  voice_sample: string;
}

interface Persona {
  id: string;
  testerAddr: string;
  vector: PersonaVector;
  isActive: boolean;
  sasAttestId: string | null;
  createdAt: string;
}

export default function PersonaGallery() {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPersonas = () => {
    setLoading(true);
    setError(null);
    personaApi.list()
      .then((data) => setPersonas(data as Persona[]))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load personas"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPersonas();
  }, []);

  const topExpertise = (vector: PersonaVector) => {
    return Object.entries(vector.expertise)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 2)
      .map(([k]) => k.replace(/_/g, ' '));
  };

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-2xl font-bold mb-2">Persona Gallery</h1>
      <p className="text-[var(--text-secondary)] text-sm mb-8">AI Personas generated from real tester behavior</p>

      {loading ? (
        <LoadingSpinner text="Loading personas..." />
      ) : error ? (
        <ErrorDisplay message={error} onRetry={loadPersonas} />
      ) : personas.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">No personas generated yet</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {personas.map((persona) => (
            <Link
              key={persona.id}
              href={`/persona/${persona.id}`}
              className="block p-5 rounded-xl border border-border-dim bg-surface hover:border-sol-green/30 hover:bg-surface-elevated transition-all card-hover"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="text-xs font-mono text-[var(--text-tertiary)]">{persona.id.slice(0, 8)}</p>
                  <div className="flex gap-2 mt-1.5">
                    {topExpertise(persona.vector).map(e => (
                      <span key={e} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-sol-green/8 text-sol-green border border-sol-green/15">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
                {persona.sasAttestId && (
                  <span className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-sol-purple/10 text-sol-purple border border-sol-purple/20">
                    SAS
                  </span>
                )}
              </div>
              {persona.vector.demographics && (
                <div className="flex gap-2 mt-2 mb-2">
                  {persona.vector.demographics.age_group && (
                    <span className="px-2 py-0.5 rounded-md text-[11px] bg-sol-purple/8 text-sol-purple/80">
                      {persona.vector.demographics.age_group}
                    </span>
                  )}
                  {persona.vector.ux_preferences?.mobile_first !== undefined && (
                    <span className="px-2 py-0.5 rounded-md text-[11px] bg-sol-blue/8 text-sol-blue/80">
                      {persona.vector.ux_preferences.mobile_first ? "mobile-first" : "desktop"}
                    </span>
                  )}
                  {persona.vector.ux_preferences?.visual_style && (
                    <span className="px-2 py-0.5 rounded-md text-[11px] bg-sol-blue/8 text-sol-blue/80">
                      {persona.vector.ux_preferences.visual_style}
                    </span>
                  )}
                </div>
              )}
              <p className="text-xs text-[var(--text-secondary)] line-clamp-2">{persona.vector.voice_sample}</p>
              <div className="mt-3 flex gap-4 text-xs text-[var(--text-tertiary)]">
                <span title="Average quality of this tester's reports (0-5 scale)">Quality: <span className={`font-semibold ${
                  persona.vector.reliability.quality_score >= 4 ? "text-sol-green" :
                  persona.vector.reliability.quality_score >= 3 ? "text-[var(--status-warning)]" : "text-[var(--status-error)]"
                }`}>{persona.vector.reliability.quality_score > 1
                  ? persona.vector.reliability.quality_score.toFixed(1)
                  : (persona.vector.reliability.quality_score * 5).toFixed(1)
                }</span>/5</span>
                <span title="How consistently this persona delivers similar quality across tests">Consistency: {(persona.vector.reliability.consistency * 100).toFixed(0)}%</span>
                <span title="How often this persona responds to test requests">Response: {(persona.vector.reliability.response_rate * 100).toFixed(0)}%</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
