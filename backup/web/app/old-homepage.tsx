"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE, dashboardApi, type DashboardResponse } from "@/lib/api";
import { useAppRole } from "@/components/sidebar";
import { useWalletContext } from "@/components/wallet-provider";
import { Topbar } from "@/components/topbar";
import { VarTabs } from "@/components/var-tabs";
import { PersonaRadar20 } from "@/components/persona-radar-20";

// Tiny SVG sparkline, matched to the Hi-Fi accent.
function Spark({ data, w = 80, h = 26, color = "var(--accent)" }: { data: number[]; w?: number; h?: number; color?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const step = w / (data.length - 1);
  const path = data
    .map((v, i) => `${i === 0 ? "M" : "L"}${i * step},${h - ((v - min) / (max - min || 1)) * (h - 2) - 1}`)
    .join(" ");
  return (
    <svg width={w} height={h}>
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Home() {
  const { role } = useAppRole();
  const { publicKey } = useWalletContext();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [variant, setVariant] = useState(0);

  useEffect(() => {
    let cancel = false;
    setLoaded(false);
    dashboardApi
      .get(role, publicKey ?? null)
      .then((d) => {
        if (!cancel) {
          setDashboard(d);
          setLoaded(true);
        }
      })
      .catch(() => !cancel && setLoaded(true));
    return () => { cancel = true; };
  }, [role, publicKey]);

  const stats = { tests: dashboard?.stats.total_tests ?? 0, personas: dashboard?.stats.total_personas ?? 0 };

  const subtitle =
    role === "company"
      ? "Your tests, signals, and treasury"
      : "Your reports, earnings, and persona health";

  return (
    <>
      <Topbar
        title="Dashboard"
        subtitle={subtitle}
        eyebrow={
          <span className="chip accent">
            <span className="chip-dot pulse-dot" />
            Live on Solana Devnet
          </span>
        }
        actions={
          role === "company" ? (
            <Link href="/company/register" className="hf-btn primary">+ New test</Link>
          ) : (
            <Link href="/tester/tests" className="hf-btn primary">Browse open tests</Link>
          )
        }
      />

      <VarTabs
        variants={["Overview", "Activity", "Explore"]}
        active={variant}
        onChange={setVariant}
      />

      {!publicKey && loaded && (
        <div className="mt-4 px-3 py-2 hf-card flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="chip info">Platform view</span>
            <span className="t-body-s text-[var(--fg-1)]">
              Connect a wallet to see your own tests, reports, and persona.
            </span>
          </div>
          <span className="t-caption">
            Numbers below are aggregated across all {stats.tests} tests and {stats.personas} personas.
          </span>
        </div>
      )}

      <div className="mt-5">
        {variant === 0 && <Overview role={role} dashboard={dashboard} loaded={loaded} stats={stats} />}
        {variant === 1 && <Activity role={role} dashboard={dashboard} />}
        {variant === 2 && <Explore />}
      </div>
    </>
  );
}

// ─── V1: Overview — KPI grid + primary list + side widget ────────────────
function Overview({ role, dashboard, loaded, stats }: {
  role: "company" | "tester";
  dashboard: DashboardResponse | null;
  loaded: boolean;
  stats: { tests: number; personas: number };
}) {
  const kpis = dashboard?.kpis ?? [];
  const list = dashboard?.primary_list ?? [];
  const activity = dashboard?.activity ?? [];
  return (
    <>
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        {kpis.map((k) => (
          <div key={k.label} className="hf-card p-4">
            <div className="t-label mb-2">{k.label}</div>
            <div className="flex items-end justify-between">
              <div>
                <div className="money leading-none" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-0.02em", opacity: loaded ? 1 : 0.3, transition: "opacity 300ms" }}>
                  {k.value}
                  {k.unit && <span className="ml-1.5 text-[12px] text-[var(--fg-2)] font-normal">{k.unit}</span>}
                </div>
                <div className="t-caption mt-1.5">{k.delta}</div>
              </div>
              <Spark data={k.spark && k.spark.length > 1 ? k.spark : [0, 0, 0, 0, 0, 0, 0]} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
        <div className="hf-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line-1)]">
            <div className="flex items-center gap-2">
              <span className="t-display-s">{role === "company" ? "Your tests" : "Available now"}</span>
              <span className="chip">{list.length}</span>
            </div>
            <Link href={role === "company" ? "/company" : "/tester/tests"} className="hf-btn ghost sm">
              View all →
            </Link>
          </div>
          <div>
            {list.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="t-body-s text-[var(--fg-2)]">
                  {loaded
                    ? role === "company"
                      ? "No tests yet. Register one to start collecting reports."
                      : "No active tests right now. Check back soon."
                    : "Loading..."}
                </p>
                {role === "company" && loaded && (
                  <Link href="/company/register" className="hf-btn sm primary mt-3">
                    + Register a test
                  </Link>
                )}
              </div>
            ) : (
              list.map((t, i, arr) => (
                <div
                  key={t.id}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--line-1)" : "none" }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="t-body font-medium truncate">{t.title}</div>
                    <div className="flex items-center gap-2.5 mt-1">
                      <span className={`chip ${t.tone}`}>
                        {t.tone === "success" && <span className="chip-dot" />} {t.status}
                      </span>
                      <span className="t-caption money">{t.meta}</span>
                      <span className="t-caption money">{t.pay}</span>
                    </div>
                  </div>
                  <Link href={t.href} className="hf-btn sm">
                    {role === "company" ? "View" : "Start"} →
                  </Link>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <PersonaCard role={role} dashboard={dashboard} stats={stats} />

          <div className="hf-card p-4">
            <div className="t-display-s mb-3">Recent activity</div>
            <div className="flex flex-col gap-2.5">
              {activity.length === 0 ? (
                <p className="t-body-s text-[var(--fg-2)]">
                  {loaded ? "Nothing yet." : "Loading..."}
                </p>
              ) : (
                activity.map((a, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <span className="addr" style={{ width: 34 }}>{a.t}</span>
                    <span className="t-body-s">{a.text}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── PersonaCard — top personas (company) / your persona (tester) ────────
function PersonaCard({
  role,
  dashboard,
  stats,
}: {
  role: "company" | "tester";
  dashboard: DashboardResponse | null;
  stats: { tests: number; personas: number };
}) {
  const topPersonas = dashboard?.top_personas ?? [];
  const myPersona = dashboard?.my_persona;
  const active = role === "company" ? topPersonas[0] : myPersona;
  const vector = (active?.vector as Record<string, Record<string, number>> | undefined) ?? null;

  const signalLabel = role === "company" ? "Top persona quality" : "Your avg quality";
  const signalValue = active?.avg_quality != null ? active.avg_quality.toFixed(2) : "—";
  const hiresLabel = role === "company" ? "Persona pool" : "Reports on file";
  const hiresValue =
    role === "company"
      ? String(stats.personas)
      : String(active?.report_count ?? 0);

  return (
    <div className="hf-card p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="t-display-s">{role === "company" ? "Top personas" : "Your persona"}</span>
        <span className="chip">{role === "company" ? topPersonas.length : myPersona ? 1 : 0}</span>
      </div>
      {vector ? (
        <div className="flex items-center gap-4">
          <PersonaRadar20 vector={vector} size={140} />
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            {active?.voice_sample && (
              <p className="t-caption italic text-[var(--fg-1)] line-clamp-3">
                &ldquo;{active.voice_sample.slice(0, 140)}
                {active.voice_sample.length > 140 ? "…" : ""}&rdquo;
              </p>
            )}
            {role === "company" && topPersonas.length > 1 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {topPersonas.slice(1).map((p) => (
                  <span key={p.id} className="chip">
                    q={p.avg_quality != null ? p.avg_quality.toFixed(2) : "—"}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="t-body-s text-[var(--fg-2)] py-6 text-center">
          {role === "tester"
            ? "No persona minted yet. Submit 3+ reports to unlock."
            : "No personas with reports yet."}
        </p>
      )}
      <div className="my-3 h-px bg-[var(--line-1)]" />
      <div className="flex items-center justify-between">
        <div>
          <div className="t-caption">{signalLabel}</div>
          <div className="money text-[17px] font-semibold mt-0.5">{signalValue}</div>
        </div>
        <div className="text-right">
          <div className="t-caption">{hiresLabel}</div>
          <div className="money text-[17px] font-semibold mt-0.5">{hiresValue}</div>
        </div>
      </div>
    </div>
  );
}

// ─── V2: Activity — event stream + quick actions + network health ───────
function Activity({ role, dashboard }: { role: "company" | "tester"; dashboard: DashboardResponse | null }) {
  const items = dashboard?.activity ?? [];
  const iconFor = (kind: string) => (kind === "report" ? "✓" : kind === "test" ? "▶" : kind === "settlement" ? "$" : "·");

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1fr) 280px" }}>
      <div className="hf-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line-1)]">
          <span className="t-display-s">Timeline</span>
          <div className="flex items-center gap-2">
            <span className="chip success"><span className="chip-dot pulse-dot" />Live</span>
            <span className="chip">{items.length} events</span>
          </div>
        </div>
        <div className="px-4">
          {items.length === 0 ? (
            <div className="py-8 text-center">
              <p className="t-body-s text-[var(--fg-2)]">No recent activity yet.</p>
            </div>
          ) : (
            items.map((it, i, arr) => (
              <div
                key={i}
                className="flex items-start gap-3 py-3"
                style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--line-1)" : "none" }}
              >
                <div
                  className="w-7 h-7 rounded-[var(--r-2)] grid place-items-center text-xs font-bold"
                  style={{
                    background: it.tone ? `var(--${it.tone}-soft)` : "var(--bg-2)",
                    color: it.tone ? `var(--${it.tone})` : "var(--fg-1)",
                    border: "1px solid var(--line-1)",
                  }}
                >
                  {iconFor(it.kind)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="t-body font-medium truncate">{it.text}</div>
                  {it.meta && (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="addr">{it.meta}</span>
                    </div>
                  )}
                </div>
                <span className="addr">{it.t}</span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div className="hf-card p-4">
          <div className="t-label mb-2.5">Quick start</div>
          <div className="flex flex-col gap-1.5">
            {(role === "company"
              ? [
                  { l: "New test", k: "N", href: "/company/register", primary: true },
                  { l: "Hire personas", k: "P", href: "/persona" },
                  { l: "Run AutoTest", k: "A", href: "/autotest" },
                ]
              : [
                  { l: "Browse tests", k: "B", href: "/tester/tests", primary: true },
                  { l: "View profile", k: "V", href: "/tester/profile" },
                  { l: "Persona gallery", k: "G", href: "/persona" },
                ]
            ).map((q) => (
              <Link
                key={q.l}
                href={q.href}
                className={`hf-btn ${q.primary ? "primary" : ""} w-full justify-start`}
                style={{ width: "100%" }}
              >
                {q.l}
                <span className="flex-1" />
                <span className="kbd">{q.k}</span>
              </Link>
            ))}
          </div>
        </div>

        <NetworkPanel />
      </div>
    </div>
  );
}

// ─── NetworkPanel — live deep-health for Activity tab sidebar ───────────
function NetworkPanel() {
  const [checks, setChecks] = useState<Record<string, { status: string; latencyMs: number; detail?: string }> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch(`${API_BASE}/api/health?deep=1`)
      .then(async (r) => {
        const body = (await r.json()) as { dependencies?: Record<string, { status: string; latencyMs: number; detail?: string }> };
        if (!cancel && body.dependencies) setChecks(body.dependencies);
      })
      .catch((e) => !cancel && setErr(e instanceof Error ? e.message : "fetch failed"));
    return () => { cancel = true; };
  }, []);

  const rows = checks
    ? [
        { k: "Database", c: checks.db },
        { k: "Persona engine", c: checks.personaEngine },
        { k: "Solana RPC", c: checks.solanaRpc },
      ]
    : [];

  return (
    <div className="hf-card p-4">
      <div className="t-label mb-2.5">Network</div>
      <div className="flex flex-col gap-2">
        {err ? (
          <span className="t-body-s text-[var(--fg-2)]">Health check failed: {err}</span>
        ) : !checks ? (
          <span className="t-body-s text-[var(--fg-2)]">Checking...</span>
        ) : (
          rows.map((r) => {
            const ok = r.c?.status === "ok";
            return (
              <div key={r.k} className="flex items-center justify-between">
                <span className="t-body-s">{r.k}</span>
                <span className={`chip ${ok ? "success" : "warn"}`}>
                  {ok && <span className="chip-dot" />}
                  {ok ? `${r.c.latencyMs} ms` : (r.c?.detail ?? "down")}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── V3: Explore — role picker + tech banner (the pre-redesign Home shape) ─
function Explore() {
  return (
    <div className="flex flex-col gap-4">
      <div className="t-label">Choose your side</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Link href="/company/register" className="hf-card card-hover relative p-7 hover:border-[var(--line-2)]">
          <div className="absolute top-0 right-0 w-40 h-40 bg-sol-purple/[0.04] rounded-full blur-[60px] pointer-events-none" />
          <div className="relative">
            <div className="t-label mb-2" style={{ color: "var(--sol-purple)" }}>Company</div>
            <h2 className="t-display-m mb-2">I have a product</h2>
            <p className="t-body-s text-[var(--fg-1)] leading-relaxed mb-4">
              Register a URL + budget. Claude drafts test cases. Real testers and AI personas run them.
            </p>
            <span className="hf-btn primary sm">Register a test →</span>
          </div>
        </Link>
        <Link href="/tester/tests" className="hf-card card-hover relative p-7 hover:border-[var(--line-2)]">
          <div className="absolute top-0 right-0 w-40 h-40 bg-sol-green/[0.04] rounded-full blur-[60px] pointer-events-none" />
          <div className="relative">
            <div className="t-label mb-2" style={{ color: "var(--sol-green)" }}>Tester</div>
            <h2 className="t-display-m mb-2">I want to earn</h2>
            <p className="t-body-s text-[var(--fg-1)] leading-relaxed mb-4">
              Pick a product, run through its test, submit a report. Earn USDC per approved report.
            </p>
            <span className="hf-btn primary sm">Browse open tests →</span>
          </div>
        </Link>
      </div>

      <div className="hf-card relative overflow-hidden p-5">
        <div className="absolute inset-0 bg-gradient-to-r from-sol-green/[0.02] via-sol-purple/[0.02] to-sol-blue/[0.02]" />
        <div className="relative">
          <div className="t-label mb-3">Powered by Solana</div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { l: "x402 Micropayment", v: "" },
              { l: "Token-2022 Transfer Fee", v: "info" },
              { l: "Transfer Hook", v: "success" },
              { l: "SAS Attestation", v: "accent" },
              { l: "Stagehand Browser AI", v: "info" },
              { l: "Claude Sonnet 4.6", v: "" },
            ].map((t) => (
              <span key={t.l} className={`chip ${t.v}`}>{t.l}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
