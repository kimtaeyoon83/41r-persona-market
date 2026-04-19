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
      <Topbar
        title="Tests"
        subtitle="Draft, launch, and analyze product validation tests"
        actions={
          <Link href="/company/register" className="hf-btn primary">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
            New test
          </Link>
        }
      />

      {loading ? (
        <LoadingSpinner text="Loading tests..." />
      ) : error ? (
        <ErrorDisplay message={error} onRetry={loadTests} />
      ) : tests.length === 0 ? (
        <div className="text-center py-12">
          <p className="t-caption mb-4">No tests registered yet</p>
          <Link href="/company/register" className="text-sol-purple hover:opacity-80">
            Register your first test →
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {tests.map((test) => (
            <Link
              key={test.id}
              href={`/company/test/${test.id}`}
              className="hf-card card-hover block p-4 hover:border-[var(--line-2)]"
            >
              <div className="flex justify-between items-start gap-4">
                <div className="min-w-0">
                  <p className="t-mono text-[13px] text-[var(--fg-0)] truncate">{test.targetUrl}</p>
                  <p className="addr mt-1">Created {new Date(test.createdAt).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="money text-[var(--fg-1)]">${test.budgetUsdc} USDC</span>
                  <span className={`chip ${
                    test.status === "active" ? "success" :
                    test.status === "completed" ? "" : "warn"
                  }`}>
                    {test.status === "active" && <span className="chip-dot" />}
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
