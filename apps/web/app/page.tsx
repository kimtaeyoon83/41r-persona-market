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

  useEffect(() => {
    Promise.all([
      testApi.list() as Promise<unknown[]>,
      personaApi.list() as Promise<unknown[]>,
    ]).then(([t, p]) => setStats({ tests: t.length, personas: p.length })).catch(() => {});
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-10">
        <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
          41R Persona Market
        </h1>
        <p className="text-lg text-gray-400 mb-6">
          AI Persona-Based Product Validation Marketplace on Solana
        </p>
        <div className="flex gap-6">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-purple-400">{stats.tests}</span>
            <span className="text-xs text-gray-500">Active Tests</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-green-400">{stats.personas}</span>
            <span className="text-xs text-gray-500">AI Personas</span>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div className="mb-10 flex items-center gap-2 text-xs text-gray-500">
        <span className="px-2 py-1 rounded bg-gray-800 text-gray-400">1. Company registers URL</span>
        <span>&rarr;</span>
        <span className="px-2 py-1 rounded bg-gray-800 text-gray-400">2. AI generates test cases</span>
        <span>&rarr;</span>
        <span className="px-2 py-1 rounded bg-gray-800 text-gray-400">3. Testers earn USDC</span>
        <span>&rarr;</span>
        <span className="px-2 py-1 rounded bg-gray-800 text-gray-400">4. AI Persona created</span>
        <span>&rarr;</span>
        <span className="px-2 py-1 rounded bg-gray-800 text-orange-400 font-medium">5. Auto Test + 41R Settlement</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Link href="/company" className="group block p-5 rounded-xl border border-gray-800 bg-gray-900 hover:border-purple-500/50 transition-all">
          <h2 className="text-lg font-semibold mb-1.5 group-hover:text-purple-300">For Companies</h2>
          <p className="text-gray-400 text-sm">
            Register your product URL, get AI-generated test cases, and receive detailed feedback from real testers and AI personas.
          </p>
          <div className="mt-3 text-purple-400 text-sm">Register a test &rarr;</div>
        </Link>

        <Link href="/tester/tests" className="group block p-5 rounded-xl border border-gray-800 bg-gray-900 hover:border-cyan-500/50 transition-all">
          <h2 className="text-lg font-semibold mb-1.5 group-hover:text-cyan-300">For Testers</h2>
          <p className="text-gray-400 text-sm">
            Test products, earn USDC rewards ($3-$5 per test), and after 3 tests, your AI Persona earns passive income.
          </p>
          <div className="mt-3 text-cyan-400 text-sm">Browse tests &rarr;</div>
        </Link>

        <Link href="/persona" className="group block p-5 rounded-xl border border-gray-800 bg-gray-900 hover:border-green-500/50 transition-all">
          <h2 className="text-lg font-semibold mb-1.5 group-hover:text-green-300">Persona Gallery</h2>
          <p className="text-gray-400 text-sm">
            Browse AI Personas with verified on-chain credentials. Each Persona represents a real tester&apos;s unique testing DNA.
          </p>
          <div className="mt-3 text-green-400 text-sm">Explore personas &rarr;</div>
        </Link>

        <Link href="/autotest" className="group block p-5 rounded-xl border border-gray-800 bg-gray-900 hover:border-orange-500/50 transition-all">
          <h2 className="text-lg font-semibold mb-1.5 group-hover:text-orange-300">Auto Test Engine</h2>
          <p className="text-gray-400 text-sm">
            AI Personas automatically visit your site, perform real browser interactions, and generate persona-perspective reports.
          </p>
          <div className="mt-3 text-orange-400 text-sm">Run auto test &rarr;</div>
        </Link>
      </div>

      <div className="mt-10 p-5 rounded-xl border border-gray-800 bg-gray-900/50">
        <h3 className="text-sm font-medium text-gray-400 mb-3">Powered by Solana</h3>
        <div className="flex flex-wrap gap-3 text-xs">
          <span className="px-3 py-1 rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20">x402 Micropayment</span>
          <span className="px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">Token-2022 Transfer Fee</span>
          <span className="px-3 py-1 rounded-full bg-green-500/10 text-green-300 border border-green-500/20">Transfer Hook</span>
          <span className="px-3 py-1 rounded-full bg-orange-500/10 text-orange-300 border border-orange-500/20">SAS Attestation</span>
          <span className="px-3 py-1 rounded-full bg-red-500/10 text-red-300 border border-red-500/20">Stagehand Browser AI</span>
          <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">Claude Sonnet 4.6</span>
        </div>
      </div>
    </div>
  );
}
