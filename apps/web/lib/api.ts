const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// ─── Test APIs ───────────────────────────────────────
export const testApi = {
  register: (data: { target_url: string; requirements?: string; budget_usdc: number; company_wallet: string }) =>
    request('/api/test/register', { method: 'POST', body: JSON.stringify(data) }),

  list: () => request('/api/tests'),

  get: (id: string) => request(`/api/test/${id}`),
};

// ─── Tester APIs ─────────────────────────────────────
export const testerApi = {
  register: (data: { wallet_address: string; display_name: string; profile?: Record<string, unknown> }) =>
    request('/api/tester/register', { method: 'POST', body: JSON.stringify(data) }),

  get: (wallet: string) => request(`/api/tester/${wallet}`),

  update: (wallet: string, data: Record<string, unknown>) =>
    request(`/api/tester/${wallet}`, { method: 'PUT', body: JSON.stringify(data) }),
};

// ─── Report APIs ─────────────────────────────────────
export const reportApi = {
  submit: (data: Record<string, unknown>) =>
    request('/api/report/submit', { method: 'POST', body: JSON.stringify(data) }),

  get: (id: string) => request(`/api/report/${id}`),

  byTester: (wallet: string) => request(`/api/reports/tester/${wallet}`),

  byTest: (testId: string) => request(`/api/reports/test/${testId}`),
};

// ─── Persona APIs ────────────────────────────────────
export const personaApi = {
  generate: (tester_addr: string) =>
    request('/api/persona/generate', { method: 'POST', body: JSON.stringify({ tester_addr }) }),

  get: (id: string) => request(`/api/persona/${id}`),

  list: () => request('/api/personas'),
};

// ─── Auto Test APIs ──────────────────────────────────
export const autoTestApi = {
  run: (data: { test_id: string; persona_id: string }) =>
    request('/api/autotest/run', { method: 'POST', body: JSON.stringify(data) }),

  status: (jobId: string) => request(`/api/autotest/status/${jobId}`),
};
