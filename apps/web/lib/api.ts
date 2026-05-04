export const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100';

// Phase 4 §1 — Privy access-token injector.
// Set from the Privy provider boundary (usePrivy().getAccessToken).
// When set, request() auto-attaches `Authorization: Bearer <token>`.
let _getAuthToken: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(fn: (() => Promise<string | null>) | null): void {
  _getAuthToken = fn;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // Spread options *first* so explicit headers merge on top — otherwise
  // `...options` at the end wipes the Content-Type we just set and the
  // server's json parser skips the body.
  const token = _getAuthToken ? await _getAuthToken().catch(() => null) : null;
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': '1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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

  // Auto-extracted funnel (Haiku-driven). Cached on the server; first
  // call after a new persona report regenerates (~5-10s wall-clock for
  // a 100-persona test). Subsequent calls serve cache.
  getFunnel: (id: string) => request(`/api/test/${id}/funnel`),
  regenerateFunnel: (id: string) => request(`/api/test/${id}/funnel/regenerate`, { method: 'POST' }),

  // Advanced settings — A/B comparison + Revenue baseline. Signed PATCH.
  // Omit a field to leave it unchanged; explicit null clears.
  updateSettings: (
    id: string,
    data: {
      company_wallet: string;
      compare_with_test_id?: string | null;
      monthly_visitors?: number | null;
      conversion_value?: number | null;
      current_conversion_rate?: number | null;
    },
    signMessage: SignMessage,
  ) => signedRequest(
    `/api/test/${id}/settings`,
    { method: 'PATCH', body: data },
    { wallet: data.company_wallet, signMessage },
  ),

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

// ─── Scan API (Audience-Fit Validator) ─────────────────────────
// POST /api/scan creates a pending scan and returns scanId.
// GET  /api/scan/:id/report returns shape used by /validator/report/[id].
// `result` is null while the scan is still running; the report page
// renders an "in progress" state in that case.
export type ScanPersonaCard = {
  id: string;
  name: string;
  age: number;
  role: string;
  score: number | null;
  quote: string;
  tags: string[];
  is_synthetic: boolean;
};

export type ScanRecentResponse = {
  persona_id: string;
  cohort_id: string;
  cohort_label: string;
  age_group: string;
  voice: string;
  sentiment: 'positive' | 'mixed' | 'friction';
  created_at: string;
};

export type ScanCohortProgress = {
  cohort_id: string;
  cohort_label: string;
  n_completed: number;
  n_target: number;
};

export type ScanFriction = {
  rank: number;
  title: string;
  detail: string;
  n: number;
  where: string;
  impact: string;
  quote: string;
};

export type ScanReport = {
  scan: {
    id: string;
    target_url: string;
    category: string | null;
    category_confidence: number | null;
    one_line_pitch: string | null;
    mode: 'A' | 'B';
    status:
      | 'pending'
      | 'capturing'
      | 'sampling'
      | 'responding'
      | 'aggregating'
      | 'completed'
      | 'failed';
    personas_attempted: number;
    personas_completed: number;
    personas_flagged: number;
    weights_version: string | null;
    target_audience_text: string | null;
    mode_b_verdict: 'pass' | 'conditional' | 'fail' | null;
    mode_b_parsed_selector: unknown;
    created_at: string;
    completed_at: string | null;
  };
  result: {
    audience_fit_score: number;
    best: { cohort_id: string; cohort_label: string; cohort_fit_score: number };
    worst: { cohort_id: string; cohort_label: string; cohort_fit_score: number };
    median_score: number;
    global_task_success_avg: number;
    global_sentiment_avg: number;
  } | null;
  cohorts: unknown[] | null;
  fit_personas: ScanPersonaCard[] | null;
  non_fit_personas: ScanPersonaCard[] | null;
  frictions: ScanFriction[] | null;
  retention_curve: { d: string; v: number }[] | null;
  dimension_breakdown:
    | { l: string; v: number; sub: string; tone: string; suffix?: string; invert?: boolean }[]
    | null;
  formula_rows: { d: string; s: number; w: number; c: number }[] | null;
  kpis: { l: string; v: string; sub: string; tone: string }[] | null;
  aarrr: {
    total_personas: number;
    stages: {
      key: 'acquisition' | 'activation' | 'retention' | 'referral' | 'revenue';
      label: string;
      score: number;
      n_passing: number;
      total: number;
      threshold: string;
    }[];
  } | null;
  recent_responses: ScanRecentResponse[];
  cohort_progress: ScanCohortProgress[];
};

export type ScanPersonaDetail = {
  scan: {
    id: string;
    target_url: string;
    mode: 'A' | 'B';
    status: string;
  };
  persona: {
    id: string;
    display_name: string;
    tester_addr: string;
    age: number;
    age_group: string;
    cohort_id: string;
    cohort_label: string;
    voice_sample: string | null;
    vector_axes: { k: string; v: number }[];
  };
  response: {
    happiness: number | null;
    engagement: number | null;
    task_success: number | null;
    retention_d7: number | null;
    adoption: number | null;
    retention_d_curve: { d1: number; d3: number; d7: number; d30: number } | null;
    sus_responses: number[] | null;
    sus_raw_score: number | null;
    signup_likelihood: number | null;
    completion_likelihood: number | null;
    voice_first_impression: string | null;
    voice_friction: string | null;
    voice_biggest_friction: string | null;
    voice_would_return_because: string | null;
    is_flagged: boolean;
    flag_reason: string | null;
  };
};

/** Lightweight scan summary used by the public homepage feeds
 *  (Recent / Top / Live). Per Phase 2 §8.1 / P2-4. */
export type ScanSummary = {
  id: string;
  target_url: string;
  category: string | null;
  one_line_pitch: string | null;
  audience_fit_score: number | null;
  best_cohort_id: string | null;
  best_cohort_label: string | null;
  best_cohort_score: number | null;
  mode: 'A' | 'B';
  status: string;
  personas_completed: number;
  created_at: string;
  completed_at: string | null;
};

export const scanApi = {
  createScan: (body: {
    target_url: string;
    mode?: 'A' | 'B';
    target_audience_text?: string;
    hypothesis?: string;
    /** Mode A only — restrict the analysis to a subset of the 8
     *  STANDARD_COHORTS by id. Omit / empty to run all 8. */
    target_cohorts?: string[];
  }) =>
    request<{ scanId: string; status: string }>('/api/scan', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getReport: (id: string) => request<ScanReport>(`/api/scan/${id}/report`),

  getPersona: (scanId: string, personaId: string) =>
    request<ScanPersonaDetail>(`/api/scan/${scanId}/persona/${personaId}`),

  /** Recent 20 completed scans (newest first). */
  getRecent: () => request<{ scans: ScanSummary[] }>('/api/scan/recent'),

  /** Top 10 scans by audience_fit_score (descending). */
  getTop: () => request<{ scans: ScanSummary[] }>('/api/scan/top'),

  /** Currently in-flight scans (capturing/sampling/responding/aggregating). */
  getLive: () => request<{ scans: ScanSummary[] }>('/api/scan/live'),

  /** Phase 4 P4-5 — auth-gated list of scans owned by the current user.
   *  Each summary includes payment_tx_signature + Solscan link. */
  getMyScans: () =>
    request<{
      scans: Array<ScanSummary & {
        payment_tx_signature: string | null;
        payment_solscan: string | null;
      }>;
    }>('/api/scan/me'),

  /** Phase 4 D6 — request a Fee Payer-partial-signed 0 USDC tx for the
   *  authenticated user to sign with their Privy wallet. */
  getPaymentTx: (scanId: string) =>
    request<{
      txBase64: string;
      blockhash: string;
      lastValidBlockHeight: number;
      feePayer: string;
      expiresAt: string;
    }>(`/api/scan/${scanId}/payment-tx`, { method: 'POST', body: '{}' }),

  /** Broadcast the user-signed tx (base64). Backend persists the
   *  signature on the scan row and returns a Solscan link. */
  confirmPayment: (scanId: string, signedTxBase64: string) =>
    request<{ signature: string; solscan: string }>(
      `/api/scan/${scanId}/payment-confirm`,
      {
        method: 'POST',
        body: JSON.stringify({ signed_tx_base64: signedTxBase64 }),
      },
    ),

  /** Submit a human survey for an already-completed scan (Phase 2 D3 / P2-5).
   *  Each call writes 5 calibration_records rows (one per dimension)
   *  with source='human_baseline'. */
  submitSurvey: (
    scanId: string,
    body: {
      email: string;
      sus_responses: number[]; // length 10, each 1-5
      engagement_category: 'abandon' | 'skim' | 'browse' | 'engage' | 'extended';
      signup_likelihood: number; // 0-1
      retention_category: 'no_return' | 'weak' | 'moderate' | 'strong';
      completion_likelihood: number; // 0-1
      voice: {
        first_impression?: string;
        biggest_friction?: string;
        would_return_because?: string;
        if_could_change_one_thing?: string;
      };
      demographics: {
        age_group: 'teen' | 'young_adult' | 'adult' | 'senior';
        tech_literacy: number; // 0-1
        crypto_experience: number; // 0-1
        mobile_first: boolean;
      };
    },
  ) =>
    request<{
      ok: boolean;
      scanId: string;
      rows_created: number;
      summary: {
        llm: Record<string, number>;
        human: Record<string, number>;
        delta: Record<string, number>;
      };
    }>(`/api/scan/${scanId}/survey`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ─── Calibration API (Phase 2-C-1) ─────────────────────────────
export type CalibrationReport = {
  period_start: string;
  period_end: string;
  totalRecords: number;
  correlations: {
    dimension: string;
    correlation: number | null;
    n: number;
    confidence: 'High' | 'Medium-High' | 'Medium' | 'Low-Medium' | 'Low' | 'n/a';
    change: string;
  }[];
  tracks: { key: string; source: string; n: number }[];
  versions: {
    v: string;
    d: string;
    hap: number;
    eng: number;
    tsk: number;
    ado: number;
    ret: number;
    current?: boolean;
  }[];
};

export const calibrationApi = {
  getCurrent: () => request<CalibrationReport>('/api/calibration/current'),
};

// ─── Auth API (Phase 4 §1) ─────────────────────────────────────
export type MeResponse = {
  user: {
    id: string;
    privyId: string;
    email: string | null;
    walletAddress: string | null;
    displayName: string | null;
  };
};

export const authApi = {
  /** Verify Privy bearer token + upsert user. Caller must set
   *  setAuthTokenGetter() so the bearer is auto-attached. */
  getMe: () => request<MeResponse>('/api/auth/me'),
};
