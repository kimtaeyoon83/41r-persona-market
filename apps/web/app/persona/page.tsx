"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { personaApi } from "@/lib/api";
import { LoadingSpinner } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";
import { Topbar } from "@/components/topbar";

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
      <Topbar
        title="Persona Market"
        subtitle={`${personas.length} AI personas trained from real testers`}
      />

      {loading ? (
        <LoadingSpinner text="Loading personas..." />
      ) : error ? (
        <ErrorDisplay message={error} onRetry={loadPersonas} />
      ) : personas.length === 0 ? (
        <div className="text-center py-12 t-caption">No personas generated yet</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {personas.map((persona) => {
            const quality = persona.vector.reliability.quality_score > 1
              ? persona.vector.reliability.quality_score
              : persona.vector.reliability.quality_score * 5;
            const qTone = quality >= 4 ? "text-sol-green" : quality >= 3 ? "text-[var(--warn)]" : "text-[var(--danger)]";
            return (
              <Link
                key={persona.id}
                href={`/persona/${persona.id}`}
                className="hf-card card-hover block p-5 hover:border-[var(--line-2)]"
              >
                {/* Voice first — this is the novel asset */}
                <blockquote className="relative pl-4 border-l-2 border-sol-green/40 mb-4">
                  <p className="t-body italic leading-snug line-clamp-3">
                    &ldquo;{persona.vector.voice_sample}&rdquo;
                  </p>
                </blockquote>

                <div className="flex items-center gap-1.5 flex-wrap mb-3">
                  <span className="addr">{persona.id.slice(0, 8)}</span>
                  {topExpertise(persona.vector).map((e) => (
                    <span key={e} className="chip accent">{e}</span>
                  ))}
                  {persona.vector.demographics?.age_group && (
                    <span className="chip">{persona.vector.demographics.age_group}</span>
                  )}
                  {persona.vector.ux_preferences?.mobile_first !== undefined && (
                    <span className="chip info">
                      {persona.vector.ux_preferences.mobile_first ? "mobile-first" : "desktop"}
                    </span>
                  )}
                  {persona.sasAttestId && (
                    <span className="chip ml-auto" style={{ background: "rgba(153,69,255,0.12)", color: "var(--sol-purple)", borderColor: "rgba(153,69,255,0.32)" }}>
                      SAS
                    </span>
                  )}
                </div>

                <div className="flex gap-4 t-caption">
                  <span title="Average quality of this tester's reports (0-5 scale)">
                    Quality <span className={`money font-semibold ${qTone}`}>{quality.toFixed(1)}</span>
                    <span className="text-[var(--fg-3)]">/5</span>
                  </span>
                  <span title="How consistently this persona delivers similar quality across tests">
                    Consistency <span className="money text-[var(--fg-1)]">{(persona.vector.reliability.consistency * 100).toFixed(0)}%</span>
                  </span>
                  <span title="How often this persona responds to test requests">
                    Response <span className="money text-[var(--fg-1)]">{(persona.vector.reliability.response_rate * 100).toFixed(0)}%</span>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
