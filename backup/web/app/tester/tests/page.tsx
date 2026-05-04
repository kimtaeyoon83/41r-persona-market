"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { testApi } from "@/lib/api";
import { LoadingSpinner } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";
import { Topbar } from "@/components/topbar";

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
  const [error, setError] = useState<string | null>(null);

  const loadTests = () => {
    setLoading(true);
    setError(null);
    testApi.list()
      .then((data) => setTests((data as Test[]).filter(t => t.status === 'active')))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load tests"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTests();
  }, []);

  return (
    <div className="max-w-4xl">
      <Topbar
        title="Available Tests"
        subtitle="Complete 3 tests to generate your AI persona"
      />

      {loading ? (
        <LoadingSpinner text="Loading available tests..." />
      ) : error ? (
        <ErrorDisplay message={error} onRetry={loadTests} />
      ) : tests.length === 0 ? (
        <div className="text-center py-12 t-caption">No active tests available</div>
      ) : (
        <div className="space-y-2">
          {tests.map((test) => (
            <Link
              key={test.id}
              href={`/tester/test/${test.id}`}
              className="hf-card card-hover block p-4 hover:border-[var(--line-2)]"
            >
              <div className="flex justify-between items-start gap-4">
                <div className="min-w-0">
                  <p className="t-body font-medium truncate">{test.targetUrl}</p>
                  <p className="addr mt-1">Created {new Date(test.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="money text-sol-blue font-semibold text-lg leading-none">${test.rewardPerTester}<span className="ml-1 text-xs text-[var(--fg-3)] font-normal">USDC</span></p>
                  <p className="t-caption mt-1">per report</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
