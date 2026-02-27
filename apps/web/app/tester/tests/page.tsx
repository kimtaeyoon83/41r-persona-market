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
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Available Tests</h1>
      <p className="text-gray-400 text-sm mb-8">Complete 3 tests to generate your AI Persona</p>

      {loading ? (
        <LoadingSpinner text="Loading available tests..." />
      ) : tests.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No active tests available</div>
      ) : (
        <div className="space-y-4">
          {tests.map((test) => (
            <Link
              key={test.id}
              href={`/tester/test/${test.id}`}
              className="block p-5 rounded-lg border border-gray-800 bg-gray-900 hover:border-cyan-500/50 transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-mono text-sm text-gray-300 truncate max-w-md">{test.targetUrl}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Created {new Date(test.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-cyan-400 font-semibold">$3-$5 USDC</p>
                  <p className="text-xs text-gray-500 mt-1">per completed test</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
