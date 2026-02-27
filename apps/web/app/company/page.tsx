"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { testApi } from "@/lib/api";
import { LoadingSpinner } from "@/components/loading";
import { ErrorDisplay } from "@/components/error-display";

interface Test {
  id: string;
  targetUrl: string;
  status: string;
  budgetUsdc: number;
  createdAt: string;
}

export default function CompanyDashboard() {
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTests = () => {
    setLoading(true);
    setError(null);
    testApi.list()
      .then((data) => setTests(data as Test[]))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load tests"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadTests();
  }, []);

  return (
    <div className="max-w-4xl">
      <div className="flex justify-between items-center mb-8">
        <h1 className="font-display text-2xl font-bold">Company Dashboard</h1>
        <Link
          href="/company/register"
          className="px-4 py-2 bg-sol-purple hover:bg-sol-purple/80 rounded-lg text-sm font-medium transition-colors"
        >
          + Register New Test
        </Link>
      </div>

      {loading ? (
        <LoadingSpinner text="Loading tests..." />
      ) : error ? (
        <ErrorDisplay message={error} onRetry={loadTests} />
      ) : tests.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[var(--text-secondary)] mb-4">No tests registered yet</p>
          <Link href="/company/register" className="text-sol-purple hover:text-sol-purple/80">
            Register your first test &rarr;
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {tests.map((test) => (
            <Link
              key={test.id}
              href={`/company/test/${test.id}`}
              className="block p-4 rounded-xl border border-border-dim bg-surface hover:border-border-hover hover:bg-surface-elevated transition-all"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-mono text-sm text-[var(--text-primary)] truncate max-w-md">{test.targetUrl}</p>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    Created {new Date(test.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[var(--text-secondary)] font-mono">${test.budgetUsdc} USDC</span>
                  <span className={`px-2 py-0.5 rounded-md text-[11px] font-mono ${
                    test.status === 'active' ? 'bg-sol-green/10 text-sol-green border border-sol-green/20' :
                    test.status === 'completed' ? 'bg-surface-elevated text-[var(--text-tertiary)] border border-border-dim' :
                    'bg-[var(--status-warning)]/10 text-[var(--status-warning)] border border-[var(--status-warning)]/20'
                  }`}>
                    {test.status}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
