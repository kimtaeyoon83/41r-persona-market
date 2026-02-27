"use client";

import { useState, useEffect } from "react";
import { useWalletContext } from "@/components/wallet-provider";
import { testerApi, personaApi } from "@/lib/api";
import Link from "next/link";

const AGE_RANGES = ["10s", "20s", "30s", "40s", "50s", "60+"] as const;
const CRYPTO_LEVELS = ["none", "beginner", "intermediate", "advanced"] as const;
const DEVICES = ["mobile", "desktop"] as const;
const EXPERTISE_OPTIONS = ["defi", "nft", "gaming", "ai_tools", "web3", "saas", "social", "e-commerce"];
const DOMAIN_OPTIONS = ["defi", "nft", "gaming", "ai", "saas", "social", "marketplace", "dao"];
const FRUSTRATION_OPTIONS = ["slow loading", "confusing navigation", "small text", "too many popups", "no mobile support", "unclear fees", "complex onboarding"];

interface TesterProfile {
  age_range?: string;
  region?: string;
  occupation?: string;
  expertise: string[];
  experience_level: string;
  crypto_experience?: string;
  preferred_domains: string[];
  ui_preference: string;
  languages: string[];
  device_types: string[];
  primary_device?: string;
  design_matters?: boolean;
  frustration_triggers?: string[];
}

export default function TesterProfile() {
  const { publicKey } = useWalletContext();
  const [wallet, setWallet] = useState("");
  const [tester, setTester] = useState<Record<string, unknown> | null>(null);
  const [persona, setPersona] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [registerMode, setRegisterMode] = useState(false);
  const [displayName, setDisplayName] = useState("");

  // Auto-fill wallet from connected wallet
  useEffect(() => {
    if (publicKey) {
      setWallet(publicKey);
    }
  }, [publicKey]);

  const [profile, setProfile] = useState<TesterProfile>({
    expertise: [],
    experience_level: "beginner",
    preferred_domains: [],
    ui_preference: "minimal",
    languages: ["ko"],
    device_types: ["mobile"],
  });

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

  const toggleArrayItem = (field: keyof TesterProfile, value: string) => {
    setProfile(prev => {
      const arr = (prev[field] as string[]) || [];
      return {
        ...prev,
        [field]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value],
      };
    });
  };

  const handleRegister = async () => {
    if (!wallet || !displayName) return;
    if (profile.expertise.length === 0) {
      alert("전문 분야를 1개 이상 선택해주세요");
      return;
    }
    setLoading(true);
    try {
      const data = await testerApi.register({
        wallet_address: wallet,
        display_name: displayName,
        profile: profile as unknown as Record<string, unknown>,
      }) as Record<string, unknown>;
      setTester(data);
      setRegisterMode(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Registration failed");
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
      alert(err instanceof Error ? err.message : "Persona generation failed");
    } finally {
      setLoading(false);
    }
  };

  const ChipSelect = ({ options, selected, onToggle, color = "blue" }: {
    options: string[]; selected: string[]; onToggle: (v: string) => void; color?: string;
  }) => (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onToggle(opt)}
          className={`px-3 py-1.5 rounded-md text-xs font-mono border transition-colors ${
            selected.includes(opt)
              ? color === "blue" ? "bg-sol-blue/15 border-sol-blue/30 text-sol-blue"
                : color === "purple" ? "bg-sol-purple/15 border-sol-purple/30 text-sol-purple"
                : color === "red" ? "bg-[var(--status-error)]/15 border-[var(--status-error)]/30 text-[var(--status-error)]"
                : "bg-sol-green/15 border-sol-green/30 text-sol-green"
              : "bg-surface-elevated border-border-dim text-[var(--text-tertiary)] hover:border-border-hover"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-bold mb-8">Tester Profile</h1>

      {!tester ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-[var(--text-secondary)] mb-2">Wallet Address</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder="Enter your Solana wallet address"
                className="flex-1"
              />
              <button onClick={loadProfile} disabled={loading} className="px-4 py-3 bg-sol-blue hover:bg-sol-blue/80 rounded-lg text-sm font-medium transition-colors">
                {loading ? "..." : "Load"}
              </button>
            </div>
          </div>

          {registerMode && (
            <div className="p-6 rounded-xl border border-border-dim bg-surface space-y-5">
              <p className="text-sm text-[var(--text-secondary)]">Not registered yet. Create your profile:</p>

              <div>
                <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Display Name *</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="홍길동"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Age Range</label>
                  <select
                    value={profile.age_range || ""}
                    onChange={(e) => setProfile(p => ({ ...p, age_range: e.target.value || undefined }))}
                  >
                    <option value="">Select</option>
                    {AGE_RANGES.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Region</label>
                  <input
                    type="text"
                    value={profile.region || ""}
                    onChange={(e) => setProfile(p => ({ ...p, region: e.target.value || undefined }))}
                    placeholder="KR"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Occupation</label>
                  <input
                    type="text"
                    value={profile.occupation || ""}
                    onChange={(e) => setProfile(p => ({ ...p, occupation: e.target.value || undefined }))}
                    placeholder="student"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Expertise * (1개 이상)</label>
                <ChipSelect
                  options={EXPERTISE_OPTIONS}
                  selected={profile.expertise}
                  onToggle={(v) => toggleArrayItem("expertise", v)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Crypto Experience</label>
                  <select
                    value={profile.crypto_experience || ""}
                    onChange={(e) => setProfile(p => ({ ...p, crypto_experience: e.target.value || undefined }))}
                  >
                    <option value="">Select</option>
                    {CRYPTO_LEVELS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Experience Level</label>
                  <select
                    value={profile.experience_level}
                    onChange={(e) => setProfile(p => ({ ...p, experience_level: e.target.value }))}
                  >
                    <option value="beginner">beginner</option>
                    <option value="intermediate">intermediate</option>
                    <option value="expert">expert</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Preferred Domains</label>
                <ChipSelect
                  options={DOMAIN_OPTIONS}
                  selected={profile.preferred_domains}
                  onToggle={(v) => toggleArrayItem("preferred_domains", v)}
                  color="purple"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Primary Device</label>
                  <div className="flex gap-2">
                    {DEVICES.map(d => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setProfile(p => ({ ...p, primary_device: d, device_types: p.device_types.includes(d) ? p.device_types : [...p.device_types, d] }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-mono border transition-colors ${
                          profile.primary_device === d
                            ? "bg-sol-blue/15 border-sol-blue/30 text-sol-blue"
                            : "bg-surface-elevated border-border-dim text-[var(--text-tertiary)]"
                        }`}
                      >
                        {d === "mobile" ? "Mobile" : "Desktop"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Design Matters?</label>
                  <div className="flex gap-2">
                    {[true, false].map(v => (
                      <button
                        key={String(v)}
                        type="button"
                        onClick={() => setProfile(p => ({ ...p, design_matters: v }))}
                        className={`flex-1 py-2 rounded-lg text-sm font-mono border transition-colors ${
                          profile.design_matters === v
                            ? "bg-sol-green/15 border-sol-green/30 text-sol-green"
                            : "bg-surface-elevated border-border-dim text-[var(--text-tertiary)]"
                        }`}
                      >
                        {v ? "Yes" : "No"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--text-tertiary)] mb-1.5">Frustration Triggers</label>
                <ChipSelect
                  options={FRUSTRATION_OPTIONS}
                  selected={profile.frustration_triggers || []}
                  onToggle={(v) => toggleArrayItem("frustration_triggers", v)}
                  color="red"
                />
              </div>

              <button
                onClick={handleRegister}
                disabled={loading || !displayName || profile.expertise.length === 0}
                className="w-full py-3 bg-sol-blue hover:bg-sol-blue/80 disabled:bg-surface-card disabled:text-[var(--text-tertiary)] rounded-lg text-sm font-medium transition-colors"
              >
                {loading ? "Registering..." : "Register as Tester"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="p-5 rounded-xl bg-surface border border-border-dim">
            <h2 className="font-display text-lg font-semibold mb-1">{String(tester.displayName || tester.display_name)}</h2>
            <p className="text-xs text-[var(--text-tertiary)] font-mono mb-3">{String(tester.walletAddress || tester.wallet_address)}</p>

            <div className="flex gap-4 text-sm mb-4">
              <span className="text-[var(--text-secondary)]">Tests Done: <span className="text-sol-blue font-display font-semibold">{String(tester.testsDone || tester.tests_done || 0)}</span></span>
              <span className="text-[var(--text-secondary)]">Persona: {(tester.personaId || tester.persona_id)
                ? <Link href={`/persona/${tester.personaId || tester.persona_id}`} className="text-sol-green hover:text-sol-green/80">Active</Link>
                : <span className="text-[var(--text-tertiary)]">Not yet</span>}
              </span>
            </div>

            {!!tester.profile && (
              <div className="pt-3 border-t border-border-dim grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)]">
                {(tester.profile as TesterProfile).age_range && (
                  <span>Age: <span className="text-[var(--text-primary)]">{(tester.profile as TesterProfile).age_range}</span></span>
                )}
                {(tester.profile as TesterProfile).region && (
                  <span>Region: <span className="text-[var(--text-primary)]">{(tester.profile as TesterProfile).region}</span></span>
                )}
                {(tester.profile as TesterProfile).occupation && (
                  <span>Occupation: <span className="text-[var(--text-primary)]">{(tester.profile as TesterProfile).occupation}</span></span>
                )}
                {(tester.profile as TesterProfile).crypto_experience && (
                  <span>Crypto: <span className="text-[var(--text-primary)]">{(tester.profile as TesterProfile).crypto_experience}</span></span>
                )}
                {(tester.profile as TesterProfile).primary_device && (
                  <span>Device: <span className="text-[var(--text-primary)]">{(tester.profile as TesterProfile).primary_device}</span></span>
                )}
                {(tester.profile as TesterProfile).design_matters !== undefined && (
                  <span>Design: <span className="text-[var(--text-primary)]">{(tester.profile as TesterProfile).design_matters ? "Yes" : "No"}</span></span>
                )}
              </div>
            )}
            {!!tester.profile && (tester.profile as TesterProfile).expertise?.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {(tester.profile as TesterProfile).expertise.map((e: string) => (
                  <span key={e} className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-sol-blue/8 text-sol-blue">{e}</span>
                ))}
              </div>
            )}
          </div>

          {!persona && Number(tester.testsDone || tester.tests_done || 0) >= 3 && (
            <button onClick={handleGeneratePersona} disabled={loading} className="w-full py-3 bg-sol-green hover:bg-sol-green/80 rounded-lg font-medium transition-colors text-surface-base">
              {loading ? "Generating Persona..." : "Generate AI Persona"}
            </button>
          )}

          {!persona && Number(tester.testsDone || tester.tests_done || 0) < 3 && (
            <div className="p-4 rounded-xl bg-surface/50 border border-border-dim text-center">
              <p className="text-[var(--text-secondary)] text-sm">
                Complete {3 - Number(tester.testsDone || tester.tests_done || 0)} more test(s) to unlock AI Persona generation
              </p>
            </div>
          )}

          {persona && (
            <Link href={`/persona/${persona.id}`} className="block p-4 rounded-xl bg-surface border border-sol-green/20 hover:border-sol-green/40 transition-colors">
              <h3 className="text-sm font-medium text-sol-green mb-1">AI Persona Active</h3>
              <p className="text-xs text-[var(--text-tertiary)] font-mono">{String(persona.id)}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1">Click to view details</p>
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
