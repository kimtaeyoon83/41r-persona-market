"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { testApi, personaApi } from "@/lib/api";
import { useAppRole } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { VarTabs } from "@/components/var-tabs";
import { PersonaRadar20 } from "@/components/persona-radar-20";

interface Stats {
  tests: number;
  personas: number;
}

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

interface KPI {
  label: string;
  value: string;
  unit?: string;
  delta: string;
  spark: number[];
}

export default function Home() {
  const { role } = useAppRole();
  const [stats, setStats] = useState<Stats>({ tests: 0, personas: 0 });
  const [loaded, setLoaded] = useState(false);
  const [variant, setVariant] = useState(0);

  useEffect(() => {
    Promise.all([testApi.list() as Promise<unknown[]>, personaApi.list() as Promise<unknown[]>])
      .then(([t, p]) => {
        setStats({ tests: t.length, personas: p.length });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const kpis: KPI[] =
    role === "company"
      ? [
          { label: "Active tests", value: String(stats.tests), delta: "+1 this week", spark: [3, 4, 3, 5, 4, 6, 4] },
          { label: "Reports pending", value: "23", delta: "+8 today", spark: [12, 14, 18, 15, 19, 22, 23] },
          { label: "Budget deployed", value: "8,420", unit: "USDC", delta: "64% utilized", spark: [1, 2, 3, 5, 6, 7, 8] },
          { label: "AutoTest credits", value: "412", unit: "× $0.10", delta: "Refills Dec 1", spark: [8, 7, 6, 4, 5, 3, 2] },
        ]
      : [
          { label: "Reports submitted", value: "34", delta: "+3 this week", spark: [2, 3, 5, 4, 6, 8, 9] },
          { label: "Avg quality", value: "4.2", unit: "/ 5", delta: "+0.3 mo/mo", spark: [3.5, 3.7, 3.9, 4.0, 4.1, 4.2, 4.2] },
          { label: "Earnings", value: "147.20", unit: "USDC", delta: "+28.40 unclaimed", spark: [10, 15, 22, 28, 35, 42, 47] },
          { label: "Persona rank", value: "L4", delta: "top 12%", spark: [1, 2, 3, 4, 5, 6, 7] },
        ];

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

      <div className="mt-5">
        {variant === 0 && <Overview role={role} kpis={kpis} loaded={loaded} stats={stats} />}
        {variant === 1 && <Activity role={role} />}
        {variant === 2 && <Explore />}
      </div>
    </>
  );
}

// ─── V1: Overview — KPI grid + primary list + side widget ────────────────
function Overview({ role, kpis, loaded, stats }: { role: "company" | "tester"; kpis: KPI[]; loaded: boolean; stats: Stats }) {
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
              <Spark data={k.spark} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)" }}>
        <div className="hf-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line-1)]">
            <div className="flex items-center gap-2">
              <span className="t-display-s">{role === "company" ? "Active tests" : "Available now"}</span>
              <span className="chip">{role === "company" ? stats.tests : 12}</span>
            </div>
            <Link href={role === "company" ? "/company" : "/tester/tests"} className="hf-btn ghost sm">
              View all →
            </Link>
          </div>
          <div>
            {(role === "company"
              ? [
                  { title: "Checkout flow · mobile", status: "running", meta: "14/20 reports", pay: "35 USDC", tone: "success" as const },
                  { title: "Onboarding · Gen-Z gamers", status: "running", meta: "8/15 reports", pay: "20 USDC", tone: "success" as const },
                  { title: "Pricing page clarity", status: "drafting", meta: "0/10 reports", pay: "15 USDC", tone: "warn" as const },
                  { title: "Settings IA · finance users", status: "review", meta: "10/10 reports", pay: "25 USDC", tone: "info" as const },
                ]
              : [
                  { title: "Vercel · Deploy flow review", status: "92% match", meta: "8 min", pay: "12 USDC", tone: "accent" as const },
                  { title: "Notion · AI writer onboarding", status: "87% match", meta: "14 min", pay: "18 USDC", tone: "accent" as const },
                  { title: "Duolingo · streak recovery", status: "76% match", meta: "6 min", pay: "10 USDC", tone: "accent" as const },
                  { title: "Linear · cycle planning UX", status: "71% match", meta: "18 min", pay: "22 USDC", tone: "accent" as const },
                ]
            ).map((t, i, arr) => (
              <div
                key={i}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--line-1)" : "none" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="t-body font-medium truncate">{t.title}</div>
                  <div className="flex items-center gap-2.5 mt-1">
                    <span className={`chip ${t.tone}`}>{t.tone === "success" && <span className="chip-dot" />} {t.status}</span>
                    <span className="t-caption money">{t.meta}</span>
                    <span className="t-caption money">{t.pay}</span>
                  </div>
                </div>
                <button className="hf-btn sm">{role === "company" ? "View" : "Start"} →</button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="hf-card p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="t-display-s">{role === "company" ? "Top personas" : "Your persona"}</span>
              <span className="chip">{stats.personas}</span>
            </div>
            <div className="flex items-center gap-4">
              <PersonaRadar20
                vector={{
                  test_style: { thoroughness: 0.9, speed: 0.6, ux_focus: 0.8, bug_detection: 0.7, creativity: 0.6 },
                  expertise: { defi: 0.9, nft: 0.4, gaming: 0.3, ai_tools: 0.7, general_web: 0.8 },
                  feedback_pattern: { ui_critical: 0.8, security_aware: 0.7, performance_sensitive: 0.5, accessibility_focus: 0.6, detail_oriented: 0.9 },
                  reliability: { quality_score: 4.2, consistency: 0.85, response_rate: 0.9, depth: 0.8, clarity: 0.75 },
                }}
                size={140}
              />
              <div className="flex flex-col gap-1.5">
                <span className="chip accent">Detail-obsessed</span>
                <span className="chip">Mobile-first</span>
                <span className="chip info">DeFi-native</span>
                <span className="chip success">L4 · top 12%</span>
              </div>
            </div>
            <div className="my-3 h-px bg-[var(--line-1)]" />
            <div className="flex items-center justify-between">
              <div>
                <div className="t-caption">{role === "company" ? "Avg $ / signal" : "Signal strength"}</div>
                <div className="money text-[17px] font-semibold mt-0.5">{role === "company" ? "$0.31" : "0.84"}</div>
              </div>
              <div className="text-right">
                <div className="t-caption">Hires this wk</div>
                <div className="money text-[17px] font-semibold mt-0.5">{role === "company" ? "1,284" : "47"}</div>
              </div>
            </div>
          </div>

          <div className="hf-card p-4">
            <div className="t-display-s mb-3">Recent activity</div>
            <div className="flex flex-col gap-2.5">
              {[
                { t: "2m", text: role === "company" ? "Report R-0842 · quality 4.6 · paid 35 USDC" : "Vercel report scored 4.6 · +35 USDC" },
                { t: "18m", text: role === "company" ? "AutoTest: 20 personas completed Checkout flow" : "Persona graduated to L4" },
                { t: "1h", text: role === "company" ? "minsu.sol submitted report for Pricing" : "New match · Linear cycle planning (92%)" },
                { t: "3h", text: role === "company" ? "Budget topped up · +2,000 USDC" : "SAS attestation renewed on Solana" },
              ].map((a, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="addr" style={{ width: 26 }}>{a.t}</span>
                  <span className="t-body-s">{a.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── V2: Activity — event stream + quick actions + network health ───────
function Activity({ role }: { role: "company" | "tester" }) {
  const items = [
    { icon: "✓", tone: "success" as const, title: role === "company" ? "Report approved · 4.6 / 5" : "Report paid · 35 USDC", by: "Checkout flow · mobile", addr: "7xK9…mR2q", t: "2m" },
    { icon: "▶", tone: "accent" as const, title: "AutoTest run started · 20 personas", by: "Pricing page clarity", addr: "autotest://a_9412", t: "6m" },
    { icon: "!", tone: "warn" as const, title: role === "company" ? "Report flagged · 2.1 / 5" : "Low-quality report disputed", by: "Onboarding · Gen-Z gamers", addr: "9jH2…kL0p", t: "14m" },
    { icon: "★", tone: "info" as const, title: "Persona graduated to L4", by: "Detail-obsessed power-user", addr: "taeyoon.sol", t: "40m" },
    { icon: "$", tone: "" as const, title: "USDC topped up · 2,000", by: "Phantom wallet", addr: "7xK9…mR2q", t: "1h" },
    { icon: "✓", tone: "success" as const, title: "Checklist generated · Claude Sonnet", by: "Settings IA · finance users", addr: "claude://gen/c_82", t: "2h" },
    { icon: "▶", tone: "accent" as const, title: "AutoTest complete · 18 / 20 signals", by: "Checkout flow · mobile", addr: "autotest://a_9401", t: "3h" },
  ];

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 1fr) 280px" }}>
      <div className="hf-card">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--line-1)]">
          <span className="t-display-s">Timeline</span>
          <div className="flex items-center gap-2">
            <span className="chip success"><span className="chip-dot pulse-dot" />Live</span>
          </div>
        </div>
        <div className="px-4">
          {items.map((it, i, arr) => (
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
                {it.icon}
              </div>
              <div className="flex-1">
                <div className="t-body font-medium">{it.title}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="t-caption">{it.by}</span>
                  <span className="addr">·</span>
                  <span className="addr">{it.addr}</span>
                </div>
              </div>
              <span className="addr">{it.t}</span>
            </div>
          ))}
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

        <div className="hf-card p-4">
          <div className="t-label mb-2.5">Network</div>
          <div className="flex flex-col gap-2">
            {[
              { k: "Solana RPC", v: "42 ms", tone: "success" },
              { k: "SAS attestations", v: "Live", tone: "" },
              { k: "x402 gateway", v: "healthy", tone: "success" },
              { k: "Browserbase pool", v: "12 / 50", tone: "" },
            ].map((n) => (
              <div key={n.k} className="flex items-center justify-between">
                <span className="t-body-s">{n.k}</span>
                <span className={`chip ${n.tone}`}>
                  {n.tone === "success" && <span className="chip-dot" />}
                  {n.v}
                </span>
              </div>
            ))}
          </div>
        </div>
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
