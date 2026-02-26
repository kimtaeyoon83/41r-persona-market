"use client";

import { useState } from "react";
import { testerApi, personaApi } from "@/lib/api";

export default function TesterProfile() {
  const [wallet, setWallet] = useState("");
  const [tester, setTester] = useState<Record<string, unknown> | null>(null);
  const [persona, setPersona] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [displayName, setDisplayName] = useState("");

  const loadProfile = async () => {
    if (!wallet) return;
    setLoading(true);
    try {
      const data = await testerApi.get(wallet) as { tester: Record<string, unknown>; persona: Record<string, unknown> | null };
      setTester(data.tester);
      setPersona(data.persona);
    } catch {
      setRegisterMode(true);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!wallet || !displayName) return;
    setLoading(true);
    try {
      const data = await testerApi.register({ wallet_address: wallet, display_name: displayName }) as Record<string, unknown>;
      setTester(data);
      setRegisterMode(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePersona = async () => {
    setLoading(true);
    try {
      const data = await personaApi.generate(wallet) as { persona: Record<string, unknown> };
      setPersona(data.persona);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Persona generation failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-8">Tester Profile</h1>

      {!tester ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">Wallet Address</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder="Enter your Solana wallet address"
                className="flex-1 px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:border-cyan-500 focus:outline-none"
              />
              <button onClick={loadProfile} disabled={loading} className="px-4 py-3 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm">
                {loading ? "..." : "Load"}
              </button>
            </div>
          </div>

          {registerMode && (
            <div className="p-4 rounded-lg border border-gray-800 bg-gray-900 space-y-3">
              <p className="text-sm text-gray-400">Not registered yet. Create your profile:</p>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:border-cyan-500 focus:outline-none"
              />
              <button onClick={handleRegister} disabled={loading} className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm">
                Register
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
            <h2 className="text-lg font-semibold mb-3">{String(tester.displayName || tester.display_name)}</h2>
            <p className="text-xs text-gray-500 font-mono mb-2">{String(tester.walletAddress || tester.wallet_address)}</p>
            <div className="flex gap-4 text-sm">
              <span>Tests Done: <span className="text-cyan-400 font-semibold">{String(tester.testsDone || tester.tests_done || 0)}</span></span>
              <span>Persona: {(tester.personaId || tester.persona_id) ? <span className="text-green-400">Active</span> : <span className="text-gray-500">Not yet</span>}</span>
            </div>
          </div>

          {!persona && Number(tester.testsDone || tester.tests_done || 0) >= 3 && (
            <button onClick={handleGeneratePersona} disabled={loading} className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-lg font-medium">
              {loading ? "Generating Persona..." : "Generate AI Persona"}
            </button>
          )}

          {!persona && Number(tester.testsDone || tester.tests_done || 0) < 3 && (
            <div className="p-4 rounded-lg bg-gray-900/50 border border-gray-800 text-center">
              <p className="text-gray-400 text-sm">
                Complete {3 - Number(tester.testsDone || tester.tests_done || 0)} more test(s) to unlock AI Persona generation
              </p>
            </div>
          )}

          {persona && (
            <div className="p-4 rounded-lg bg-gray-900 border border-green-500/20">
              <h3 className="text-sm font-medium text-green-400 mb-2">AI Persona Active</h3>
              <p className="text-xs text-gray-500 font-mono">{String(persona.id)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
