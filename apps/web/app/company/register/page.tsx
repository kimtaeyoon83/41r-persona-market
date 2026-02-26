"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { testApi } from "@/lib/api";

export default function RegisterTest() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    target_url: "",
    requirements: "",
    budget_usdc: 50,
    company_wallet: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const result = await testApi.register(form) as { test: { id: string } };
      router.push(`/company/test/${result.test.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register test");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-8">Register New Test</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm text-gray-400 mb-2">Company Wallet Address</label>
          <input
            type="text"
            value={form.company_wallet}
            onChange={(e) => setForm({ ...form, company_wallet: e.target.value })}
            placeholder="Enter your Solana wallet address"
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:border-purple-500 focus:outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Target URL</label>
          <input
            type="url"
            value={form.target_url}
            onChange={(e) => setForm({ ...form, target_url: e.target.value })}
            placeholder="https://your-app.com"
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:border-purple-500 focus:outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Test Requirements</label>
          <textarea
            value={form.requirements}
            onChange={(e) => setForm({ ...form, requirements: e.target.value })}
            placeholder="Describe what you want tested (e.g., 'Test the swap functionality, check wallet connection, verify error handling')"
            rows={4}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:border-purple-500 focus:outline-none resize-none"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-2">Budget (USDC)</label>
          <input
            type="number"
            value={form.budget_usdc}
            onChange={(e) => setForm({ ...form, budget_usdc: Number(e.target.value) })}
            min={10}
            max={1000}
            className="w-full px-4 py-3 bg-gray-900 border border-gray-700 rounded-lg text-sm focus:border-purple-500 focus:outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            Manual testers receive $3-$5 per test. Auto tests use 41R Token with 5% transfer fee.
          </p>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg font-medium transition-colors"
        >
          {loading ? "Generating test cases..." : "Register Test & Generate Cases"}
        </button>
      </form>
    </div>
  );
}
