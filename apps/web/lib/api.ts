export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // Spread options *first* so explicit headers merge on top — otherwise
  // `...options` at the end wipes the Content-Type we just set and the
  // server's json parser skips the body.
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': '1',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export type SignMessage = (msg: string) => Promise<string>;

/**
 * Perform a mutating request authenticated with a wallet-signed nonce.
 * Caller provides the wallet address + a signMessage fn (from useWalletContext).
 * The backend issues a short-lived nonce; the client signs it; we forward
 * wallet/nonce/signature via headers. The nonce is single-use.
 */
export async function signedRequest<T>(
  path: string,
  init: { method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown },
  auth: { wallet: string; signMessage: SignMessage },
): Promise<T> {
  const { nonce } = await request<{ nonce: string; expiresAt: number }>(
    `/api/auth/nonce?wallet=${encodeURIComponent(auth.wallet)}`,
  );
  const signature = await auth.signMessage(nonce);
  return request<T>(path, {
    method: init.method,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: {
      'x-wallet-address': auth.wallet,
      'x-nonce': nonce,
      'x-signature': signature,
    },
  });
}

// ─── Test APIs ───────────────────────────────────────
export const testApi = {
  register: (
    data: { target_url: string; requirements?: string; budget_usdc: number; reward_per_tester: number; company_wallet: string; deposit_tx_signature?: string; enable_auto_test?: boolean },
    signMessage: SignMessage,
  ) => signedRequest('/api/test/register', { method: 'POST', body: data }, { wallet: data.company_wallet, signMessage }),

  list: () => request('/api/tests'),

  get: (id: string) => request(`/api/test/${id}`),

  retryAutotest: (
    id: string,
    data: { company_wallet: string; max_personas?: number; force_retry_low_quality?: boolean },
    signMessage: SignMessage,
  ) => signedRequest(
    `/api/test/${id}/retry-autotest`,
    { method: 'POST', body: data },
    { wallet: data.company_wallet, signMessage },
  ),

  getDiagnosis: (id: string) => request(`/api/test/${id}/diagnosis`),

  // Slim insights aggregate for dashboard cards (pain points + persona summaries).
  // Wraps server-side aggregateForDiagnosis() — no LLM call, no token cost.
  getInsights: (id: string) => request(`/api/test/${id}/insights`),

  generateDiagnosis: (
    id: string,
    data: { company_wallet: string },
    signMessage: SignMessage,
  ) => signedRequest(
    `/api/test/${id}/diagnosis`,
    { method: 'POST', body: data },
    { wallet: data.company_wallet, signMessage },
  ),
};

// ─── Tester APIs ─────────────────────────────────────
export const testerApi = {
  list: () => request('/api/testers'),

  register: (
    data: { wallet_address: string; display_name: string; profile?: Record<string, unknown> },
    signMessage: SignMessage,
  ) => signedRequest('/api/tester/register', { method: 'POST', body: data }, { wallet: data.wallet_address, signMessage }),

  update: (
    wallet: string,
    data: { display_name?: string; profile?: Record<string, unknown> },
    signMessage: SignMessage,
  ) => signedRequest(`/api/tester/${wallet}`, { method: 'PUT', body: data }, { wallet, signMessage }),

  get: (wallet: string) => request(`/api/tester/${wallet}`),
};

// ─── Report APIs ─────────────────────────────────────
export const reportApi = {
  submit: (
    data: { tester_addr: string; [k: string]: unknown },
    signMessage: SignMessage,
  ) => signedRequest('/api/report/submit', { method: 'POST', body: data }, { wallet: data.tester_addr, signMessage }),

  get: (id: string) => request(`/api/report/${id}`),

  byTester: (wallet: string) => request(`/api/reports/tester/${wallet}`),

  byTest: (testId: string) => request(`/api/reports/test/${testId}`),

  compare: (testId: string) => request(`/api/reports/compare/${testId}`),
};

// ─── Persona APIs ────────────────────────────────────
export const personaApi = {
  generate: (tester_addr: string) =>
    request('/api/persona/generate', { method: 'POST', body: JSON.stringify({ tester_addr }) }),

  get: (id: string) => request(`/api/persona/${id}`),

  list: () => request('/api/personas'),
};

// ─── Dashboard API ───────────────────────────────────
export interface DashboardKpi {
  label: string;
  value: string;
  unit?: string;
  delta: string;
  /** 7 chronological datapoints (index 0 = 6 days ago, index 6 = today). */
  spark: number[];
}
export interface DashboardListItem {
  id: string;
  title: string;
  status: string;
  meta: string;
  pay: string;
  tone: 'success' | 'warn' | 'info' | 'accent' | '';
  href: string;
}
export interface DashboardActivityItem {
  t: string;
  text: string;
  at: string;
  kind: 'report' | 'test' | 'settlement';
  tone: 'success' | 'warn' | 'info' | 'accent' | '';
  meta?: string;
}
export interface PersonaSummary {
  id: string;
  tester_addr: string;
  voice_sample: string;
  vector: Record<string, unknown>;
  avg_quality: number | null;
  report_count: number;
}
export interface DashboardResponse {
  role: 'company' | 'tester';
  wallet: string | null;
  kpis: DashboardKpi[];
  primary_list: DashboardListItem[];
  activity: DashboardActivityItem[];
  stats: { total_tests: number; total_personas: number };
  top_personas?: PersonaSummary[];
  my_persona?: PersonaSummary | null;
}
export const dashboardApi = {
  get: (role: 'company' | 'tester', wallet?: string | null) => {
    const params = new URLSearchParams({ role });
    if (wallet) params.set('wallet', wallet);
    return request(`/api/dashboard?${params.toString()}`) as Promise<DashboardResponse>;
  },
};

// ─── Auto Test APIs ──────────────────────────────────
export const autoTestApi = {
  run: (data: { test_id: string; persona_id: string; payment_tx?: string }) =>
    request('/api/autotest/run', { method: 'POST', body: JSON.stringify(data) }),

  status: (jobId: string) => request(`/api/autotest/status/${jobId}`),
};

// ─── Auto Test BSC (x402 EVM) APIs ───────────────────
export const autoTestBscApi = {
  /** Fetch payment requirements — price, payee, USDC contract. */
  requirements: () => request('/api/autotest-bsc/requirements'),

  /** Post with an x402 X-Payment header (base64-encoded). */
  run: async (data: { test_id: string; persona_id: string }, xPayment: string) => {
    const res = await fetch(`${API_BASE}/api/autotest-bsc/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Payment': xPayment,
        'ngrok-skip-browser-warning': '1',
      },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (!res.ok) throw new Error(body.reason || body.error || `Run failed: ${res.status}`);
    return body;
  },

  status: (jobId: string) => request(`/api/autotest-bsc/status/${jobId}`),
};
