"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { testApi, reportApi } from "@/lib/api";

interface TestDetail {
  test: {
    id: string;
    targetUrl: string;
    requirements: string;
    budgetUsdc: number;
    status: string;
    createdAt: string;
  };
  test_cases: {
    checklist: Array<{ id: string; task: string; expected: string }>;
    scenarios: Array<{ id: string; persona_type: string; narrative: string }>;
    questionnaire: Array<{ id: string; question: string; type: string }>;
  };
}

export default function TestDetailPage() {
  const params = useParams();
  const testId = params.testId as string;
  const [data, setData] = useState<TestDetail | null>(null);
  const [reports, setReports] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!testId) return;
    Promise.all([
      testApi.get(testId) as Promise<TestDetail>,
      reportApi.byTest(testId) as Promise<Array<Record<string, unknown>>>,
    ])
      .then(([testData, reportData]) => {
        setData(testData);
        setReports(reportData);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [testId]);

  if (loading) return <div className="text-gray-400 text-center py-12">Loading...</div>;
  if (!data) return <div className="text-red-400 text-center py-12">Test not found</div>;

  const { test, test_cases } = data;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold">Test Details</h1>
          <span className={`px-2 py-0.5 rounded-full text-xs ${
            test.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'
          }`}>
            {test.status}
          </span>
        </div>
        <p className="text-gray-400 font-mono text-sm">{test.targetUrl}</p>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <p className="text-xs text-gray-500">Budget</p>
          <p className="text-lg font-semibold">${test.budgetUsdc} USDC</p>
        </div>
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <p className="text-xs text-gray-500">Reports</p>
          <p className="text-lg font-semibold">{reports.length}</p>
        </div>
        <div className="p-4 rounded-lg bg-gray-900 border border-gray-800">
          <p className="text-xs text-gray-500">Created</p>
          <p className="text-sm">{new Date(test.createdAt).toLocaleDateString()}</p>
        </div>
      </div>

      {test.requirements && (
        <div className="mb-8 p-4 rounded-lg bg-gray-900 border border-gray-800">
          <h2 className="text-sm font-medium text-gray-400 mb-2">Requirements</h2>
          <p className="text-sm">{test.requirements}</p>
        </div>
      )}

      {/* Test Cases */}
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold mb-3">Checklist ({test_cases.checklist?.length || 0})</h2>
          <div className="space-y-2">
            {test_cases.checklist?.map((item) => (
              <div key={item.id} className="p-3 rounded-lg bg-gray-900 border border-gray-800 flex gap-3">
                <span className="text-xs font-mono text-purple-400 mt-0.5">{item.id}</span>
                <div>
                  <p className="text-sm">{item.task}</p>
                  <p className="text-xs text-gray-500 mt-1">Expected: {item.expected}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-3">Scenarios ({test_cases.scenarios?.length || 0})</h2>
          <div className="space-y-2">
            {test_cases.scenarios?.map((item) => (
              <div key={item.id} className="p-3 rounded-lg bg-gray-900 border border-gray-800">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-cyan-400">{item.id}</span>
                  <span className="text-xs text-gray-500">{item.persona_type}</span>
                </div>
                <p className="text-sm">{item.narrative}</p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-3">Questionnaire ({test_cases.questionnaire?.length || 0})</h2>
          <div className="space-y-2">
            {test_cases.questionnaire?.map((item) => (
              <div key={item.id} className="p-3 rounded-lg bg-gray-900 border border-gray-800 flex gap-3">
                <span className="text-xs font-mono text-green-400 mt-0.5">{item.id}</span>
                <div>
                  <p className="text-sm">{item.question}</p>
                  <p className="text-xs text-gray-500 mt-1">Type: {item.type}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
