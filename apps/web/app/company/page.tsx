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
  createdAt: string;
}

export default function CompanyDashboard() {
  const [tests, setTests] = useState<Test[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    testApi.list()
      .then((data) => setTests(data as Test[]))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold">Company Dashboard</h1>
        <Link
          href="/company/register"
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-lg text-sm font-medium transition-colors"
        >
          + Register New Test
        </Link>
      </div>

      {loading ? (
        <LoadingSpinner text="Loading tests..." />
      ) : tests.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 mb-4">No tests registered yet</p>
          <Link href="/company/register" className="text-purple-400 hover:text-purple-300">
            Register your first test &rarr;
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {tests.map((test) => (
            <Link
              key={test.id}
              href={`/company/test/${test.id}`}
              className="block p-4 rounded-lg border border-gray-800 bg-gray-900 hover:border-gray-700 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-mono text-sm text-gray-300 truncate max-w-md">{test.targetUrl}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Created {new Date(test.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400">${test.budgetUsdc} USDC</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs ${
                    test.status === 'active' ? 'bg-green-500/10 text-green-400' :
                    test.status === 'completed' ? 'bg-gray-500/10 text-gray-400' :
                    'bg-yellow-500/10 text-yellow-400'
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
