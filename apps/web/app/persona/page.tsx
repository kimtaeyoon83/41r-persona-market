"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { personaApi } from "@/lib/api";

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

  useEffect(() => {
    personaApi.list()
      .then((data) => setPersonas(data as Persona[]))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const topExpertise = (vector: PersonaVector) => {
    return Object.entries(vector.expertise)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 2)
      .map(([k]) => k.replace(/_/g, ' '));
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Persona Gallery</h1>
      <p className="text-gray-400 text-sm mb-8">AI Personas generated from real tester behavior</p>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : personas.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No personas generated yet</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {personas.map((persona) => (
            <Link
              key={persona.id}
              href={`/persona/${persona.id}`}
              className="block p-5 rounded-lg border border-gray-800 bg-gray-900 hover:border-green-500/50 transition-colors"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <p className="text-xs font-mono text-gray-500">{persona.id.slice(0, 8)}</p>
                  <div className="flex gap-2 mt-1">
                    {topExpertise(persona.vector).map(e => (
                      <span key={e} className="px-2 py-0.5 rounded-full text-xs bg-green-500/10 text-green-400 border border-green-500/20">
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
                {persona.sasAttestId && (
                  <span className="px-2 py-0.5 rounded text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20">
                    SAS
                  </span>
                )}
              </div>
              {persona.vector.demographics && (
                <div className="flex gap-2 mt-2 mb-2">
                  {persona.vector.demographics.age_group && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-pink-500/10 text-pink-400">
                      {persona.vector.demographics.age_group}
                    </span>
                  )}
                  {persona.vector.ux_preferences?.mobile_first !== undefined && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/10 text-amber-400">
                      {persona.vector.ux_preferences.mobile_first ? "mobile-first" : "desktop"}
                    </span>
                  )}
                  {persona.vector.ux_preferences?.visual_style && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-400">
                      {persona.vector.ux_preferences.visual_style}
                    </span>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-400 line-clamp-2">{persona.vector.voice_sample}</p>
              <div className="mt-3 flex gap-4 text-xs text-gray-500">
                <span>Quality: <span className={`font-semibold ${
                  persona.vector.reliability.quality_score >= 4 ? "text-green-400" :
                  persona.vector.reliability.quality_score >= 3 ? "text-yellow-400" : "text-red-400"
                }`}>{persona.vector.reliability.quality_score.toFixed(1)}</span>/5</span>
                <span>Consistency: {(persona.vector.reliability.consistency * 100).toFixed(0)}%</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
