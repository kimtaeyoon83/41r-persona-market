"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { testApi } from "@/lib/api";
import { LoadingSpinner } from "@/components/loading";

interface Test {
  id: string;
  targetUrl: string;
  status: string;
  budgetUsdc: number;
  rewardPerTester: number;
  createdAt: string;
}

export default function TesterTestList() {
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    testApi.list()
      .then((data) => setTests((data as Test[]).filter(t => t.status === 'active')))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-2xl font-bold mb-2">Available Tests</h1>
      <p className="text-[var(--text-secondary)] text-sm mb-8">Complete 3 tests to generate your AI Persona</p>

      {loading ? (
        <LoadingSpinner text="Loading available tests..." />
      ) : tests.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-secondary)]">No active tests available</div>
      ) : (
        <div className="space-y-3">
          {tests.map((test) => (
            <Link
              key={test.id}
              href={`/tester/test/${test.id}`}
              className="block p-5 rounded-xl border border-border-dim bg-surface hover:border-sol-blue/30 hover:bg-surface-elevated transition-all card-hover"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-mono text-sm text-[var(--text-primary)] truncate max-w-md">{test.targetUrl}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    Created {new Date(test.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sol-blue font-display font-semibold">${test.rewardPerTester} USDC</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">reward per tester</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
