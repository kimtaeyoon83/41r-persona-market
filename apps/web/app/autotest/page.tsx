"use client";

import { useEffect, useState } from "react";
import { testApi, personaApi, autoTestApi } from "@/lib/api";

interface Test { id: string; targetUrl: string; status: string }
interface Persona { id: string; testerAddr: string; vector: { voice_sample: string; expertise: Record<string, number> } }

export default function AutoTestPage() {
  const [tests, setTests] = useState<Test[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedTest, setSelectedTest] = useState("");
  const [selectedPersona, setSelectedPersona] = useState("");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    Promise.all([
      testApi.list() as Promise<Test[]>,
      personaApi.list() as Promise<Persona[]>,
    ]).then(([t, p]) => {
      setTests(t.filter(x => x.status === 'active'));
      setPersonas(p);
    });
  }, []);

  const handleRun = async () => {
    if (!selectedTest || !selectedPersona) return;
    setRunning(true);
    setStatus(null);
    try {
      const result = await autoTestApi.run({ test_id: selectedTest, persona_id: selectedPersona });
      setStatus(result as Record<string, unknown>);
    } catch (err) {
      setStatus({ status: 'failed', error: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Auto Test Engine</h1>
      <p className="text-gray-400 text-sm mb-8">AI Persona-driven automated browser testing</p>

      <div className="space-y-4 mb-8">
        <div>
          <label className="block text-sm text-gray-400 mb-2">Select Test</label>
          <select
            value={selectedTest}
            onChange={(e) => setSelectedTest(e.target.value)}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:border-orange-500 focus:outline-none"
          >
            <option value="">Choose a test...</option>
            {tests.map(t => (
              <option key={t.id} value={t.id}>{t.targetUrl} ({t.id.slice(0, 8)})</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Select Persona</label>
          <select
            value={selectedPersona}
            onChange={(e) => setSelectedPersona(e.target.value)}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:border-orange-500 focus:outline-none"
          >
            <option value="">Choose a persona...</option>
            {personas.map(p => (
              <option key={p.id} value={p.id}>
                {p.id.slice(0, 8)} — {Object.entries(p.vector.expertise).sort(([,a],[,b]) => b - a)[0]?.[0] || 'general'}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleRun}
          disabled={running || !selectedTest || !selectedPersona}
          className="w-full py-3 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
        >
          {running ? "Running Auto Test..." : "Run Auto Test"}
        </button>
      </div>

      {status && (
        <div className={`p-4 rounded-lg border ${
          status.status === 'failed' ? 'border-red-500/20 bg-red-500/5' : 'border-green-500/20 bg-green-500/5'
        }`}>
          <h3 className="text-sm font-medium mb-2">
            {status.status === 'failed' ? 'Test Failed' : 'Test Status'}
          </h3>
          <pre className="text-xs text-gray-400 overflow-auto">{JSON.stringify(status, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
