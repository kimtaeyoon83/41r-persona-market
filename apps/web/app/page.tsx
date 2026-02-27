"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { testApi, personaApi } from "@/lib/api";

interface Stats {
  tests: number;
  personas: number;
}

export default function Home() {
  const [stats, setStats] = useState<Stats>({ tests: 0, personas: 0 });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      testApi.list() as Promise<unknown[]>,
      personaApi.list() as Promise<unknown[]>,
    ])
      .then(([t, p]) => {
        setStats({ tests: t.length, personas: p.length });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  return (
    <div className="max-w-5xl">
      {/* Hero */}
      <div className="relative mb-12">
        {/* Background glow */}
        <div className="absolute -top-20 -left-20 w-[400px] h-[300px] bg-sol-green/[0.03] rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute -top-10 left-40 w-[300px] h-[200px] bg-sol-purple/[0.04] rounded-full blur-[80px] pointer-events-none" />

        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-sol-green/15 bg-sol-green/5 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-sol-green pulse-dot" />
            <span className="text-[11px] font-mono text-sol-green tracking-wide">Live on Solana Devnet</span>
          </div>

          <h1 className="font-display text-5xl font-bold tracking-tight mb-4 leading-[1.1]">
            <span className="text-[var(--text-primary)]">AI Persona-Driven</span>
            <br />
            <span className="sol-gradient-text">Product Validation</span>
          </h1>

          <p className="text-lg text-[var(--text-secondary)] max-w-xl leading-relaxed mb-8">
            Real testers build AI personas. Those personas autonomously validate products
            using browser automation. Powered by on-chain micropayments.
          </p>

          {/* Live stats */}
          <div className="flex gap-8 mb-8">
            <div className="flex items-baseline gap-2">
              <span className={`font-display text-3xl font-bold text-sol-green transition-opacity ${loaded ? "opacity-100" : "opacity-30"}`}>
                {stats.tests}
              </span>
              <span className="text-xs font-mono text-[var(--text-tertiary)] uppercase tracking-wider">Active Tests</span>
            </div>
            <div className="w-px h-8 bg-border-dim self-center" />
            <div className="flex items-baseline gap-2">
              <span className={`font-display text-3xl font-bold text-sol-purple transition-opacity ${loaded ? "opacity-100" : "opacity-30"}`}>
                {stats.personas}
              </span>
              <span className="text-xs font-mono text-[var(--text-tertiary)] uppercase tracking-wider">AI Personas</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline flow */}
      <div className="mb-10 flex items-center gap-1.5 text-[11px] font-mono overflow-x-auto pb-2">
        {[
          { label: "Register URL", color: "text-sol-purple" },
          { label: "AI Test Cases", color: "text-sol-blue" },
          { label: "Testers earn USDC", color: "text-sol-green" },
          { label: "Persona Created", color: "text-sol-green" },
          { label: "Auto Test + 41R", color: "text-sol-green", accent: true },
        ].map((step, i) => (
          <div key={i} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && (
              <svg className="w-4 h-4 text-border" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )}
            <span
              className={`px-2.5 py-1 rounded-md border transition-colors ${
                step.accent
                  ? "bg-sol-green/8 border-sol-green/20 text-sol-green font-medium"
                  : `bg-surface-elevated border-border-dim ${step.color}`
              }`}
            >
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {/* Main cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Link
          href="/company"
          className="group relative p-6 rounded-xl border border-border-dim bg-surface hover:bg-surface-elevated hover:border-sol-purple/30 transition-all card-hover"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-sol-purple/[0.03] rounded-full blur-[40px] pointer-events-none" />
          <div className="relative">
            <div className="w-10 h-10 rounded-lg bg-sol-purple/10 border border-sol-purple/20 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-sol-purple" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h2 className="font-display text-lg font-semibold mb-2 text-[var(--text-primary)] group-hover:text-sol-purple transition-colors">
              For Companies
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
              Register your product URL, get AI-generated test cases, and receive feedback from real testers and AI personas.
            </p>
            <span className="text-sm font-medium text-sol-purple group-hover:translate-x-1 inline-flex items-center gap-1 transition-transform">
              Register a test
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </div>
        </Link>

        <Link
          href="/tester/tests"
          className="group relative p-6 rounded-xl border border-border-dim bg-surface hover:bg-surface-elevated hover:border-sol-blue/30 transition-all card-hover"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-sol-blue/[0.03] rounded-full blur-[40px] pointer-events-none" />
          <div className="relative">
            <div className="w-10 h-10 rounded-lg bg-sol-blue/10 border border-sol-blue/20 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-sol-blue" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <h2 className="font-display text-lg font-semibold mb-2 text-[var(--text-primary)] group-hover:text-sol-blue transition-colors">
              For Testers
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
              Test products, earn USDC rewards per test, and after 3 tests your AI Persona earns passive income.
            </p>
            <span className="text-sm font-medium text-sol-blue group-hover:translate-x-1 inline-flex items-center gap-1 transition-transform">
              Browse tests
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </div>
        </Link>

        <Link
          href="/persona"
          className="group relative p-6 rounded-xl border border-border-dim bg-surface hover:bg-surface-elevated hover:border-sol-green/30 transition-all card-hover"
        >
          <div className="absolute top-0 right-0 w-32 h-32 bg-sol-green/[0.03] rounded-full blur-[40px] pointer-events-none" />
          <div className="relative">
            <div className="w-10 h-10 rounded-lg bg-sol-green/10 border border-sol-green/20 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-sol-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h2 className="font-display text-lg font-semibold mb-2 text-[var(--text-primary)] group-hover:text-sol-green transition-colors">
              Persona Gallery
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
              Browse AI Personas with verified on-chain credentials. Each Persona represents a real tester&apos;s unique testing DNA.
            </p>
            <span className="text-sm font-medium text-sol-green group-hover:translate-x-1 inline-flex items-center gap-1 transition-transform">
              Explore personas
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </div>
        </Link>

        <Link
          href="/autotest"
          className="group relative p-6 rounded-xl border border-border-dim bg-surface hover:bg-surface-elevated hover:border-sol-green/30 transition-all card-hover overflow-hidden"
        >
          {/* Accent glow for killing moment */}
          <div className="absolute -top-4 -right-4 w-40 h-40 bg-gradient-to-br from-sol-green/[0.05] to-sol-purple/[0.05] rounded-full blur-[40px] pointer-events-none" />
          <div className="relative">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sol-green/15 to-sol-purple/15 border border-sol-green/20 flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-sol-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h2 className="font-display text-lg font-semibold mb-2 text-[var(--text-primary)] group-hover:text-sol-green transition-colors">
              Auto Test Engine
            </h2>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed mb-4">
              AI Personas autonomously visit your site, perform real browser interactions, and generate persona-perspective reports.
            </p>
            <span className="text-sm font-medium sol-gradient-text group-hover:translate-x-1 inline-flex items-center gap-1 transition-transform">
              Run auto test
              <svg className="w-4 h-4 text-sol-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </div>
        </Link>
      </div>

      {/* Solana stack banner */}
      <div className="relative p-6 rounded-xl border border-border-dim bg-surface overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-sol-green/[0.02] via-sol-purple/[0.02] to-sol-blue/[0.02]" />
        <div className="relative">
          <h3 className="text-xs font-mono text-[var(--text-tertiary)] uppercase tracking-widest mb-4">
            Powered by Solana
          </h3>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "x402 Micropayment", color: "sol-purple" },
              { label: "Token-2022 Transfer Fee", color: "sol-blue" },
              { label: "Transfer Hook", color: "sol-green" },
              { label: "SAS Attestation", color: "sol-green" },
              { label: "Stagehand Browser AI", color: "sol-blue" },
              { label: "Claude Sonnet 4.6", color: "sol-purple" },
            ].map((tech) => (
              <span
                key={tech.label}
                className={`px-3 py-1.5 rounded-md text-xs font-mono border transition-colors
                  ${tech.color === "sol-green" ? "bg-sol-green/5 text-sol-green/80 border-sol-green/15 hover:border-sol-green/30" : ""}
                  ${tech.color === "sol-purple" ? "bg-sol-purple/5 text-sol-purple/80 border-sol-purple/15 hover:border-sol-purple/30" : ""}
                  ${tech.color === "sol-blue" ? "bg-sol-blue/5 text-sol-blue/80 border-sol-blue/15 hover:border-sol-blue/30" : ""}
                `}
              >
                {tech.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
