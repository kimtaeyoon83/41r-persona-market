/**
 * Dashboard aggregate service — powers the `/` landing KPIs, primary
 * list, and recent-activity widgets for both company and tester roles.
 *
 * Kept deliberately read-only and side-effect-free. One GET from the
 * frontend → a few cheap queries (bounded by wallet) → shaped payload.
 * Phase A covers real values for KPIs + lists + activity. Sparkline /
 * radar / network come in Phase B; see MEMORY and the Phase plan.
 */
import { and, desc, eq, inArray, type InferSelectModel } from 'drizzle-orm';
import { db } from '../db/index.js';
import * as schema from '../db/schema.js';

type TestRow = InferSelectModel<typeof schema.tests>;
type ReportRow = InferSelectModel<typeof schema.testReports>;
type SettlementRow = InferSelectModel<typeof schema.settlements>;
type PersonaRow = InferSelectModel<typeof schema.personas>;

// ─── Public types ──────────────────────────────────────────────────

export interface DashboardKpi {
  label: string;
  value: string;
  unit?: string;
  /** Short context line under the number — e.g. "avg 4.2 / 5". Empty
   *  string when we don't have a meaningful delta yet (Phase C). */
  delta: string;
  /** 7 data points, chronological (index 0 = 6 days ago, index 6 = today).
   *  Units depend on KPI: count, sum, avg, or running cumulative. All
   *  flat-zero if the table is empty — the client still renders a flat
   *  line. */
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
  /** ISO so the client can re-sort or render exact tooltips without
   *  trusting the server's relative label. */
  at: string;
  /** Event type — drives the icon on the Activity tab timeline. */
  kind: 'report' | 'test' | 'settlement';
  tone: 'success' | 'warn' | 'info' | 'accent' | '';
  /** Short secondary text (target URL, tester suffix, tx sig snippet).
   *  Kept server-side so we don't re-derive on every render. */
  meta?: string;
}

export interface PersonaSummary {
  id: string;
  tester_addr: string;
  voice_sample: string;
  vector: PersonaRow['vector'];
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
  /** Top 3 personas by avg quality — company view. */
  top_personas?: PersonaSummary[];
  /** Tester's own persona, if one exists. */
  my_persona?: PersonaSummary | null;
}

// ─── Helpers ───────────────────────────────────────────────────────

export function timeAgo(from: Date | null | undefined, now = new Date()): string {
  if (!from) return '—';
  const diffSec = Math.max(0, Math.floor((now.getTime() - new Date(from).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w`;
  return `${Math.floor(day / 30)}mo`;
}

export function shortenUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url;
  }
}

/**
 * Return the 0-based day bucket of `d` relative to `ref`'s UTC day.
 *  0 = same day, 1 = yesterday, …, 6 = 6 days ago. Returns -1 for
 *  anything older or in the future. UTC so bucketing is stable across
 *  Railway (UTC) and local dev (any TZ).
 */
export function dayBucket(d: Date | null | undefined, ref: Date = new Date()): number {
  if (!d) return -1;
  const msPerDay = 86_400_000;
  const startOfRef = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  const dd = new Date(d);
  const startOfD = Date.UTC(dd.getUTCFullYear(), dd.getUTCMonth(), dd.getUTCDate());
  const diff = Math.floor((startOfRef - startOfD) / msPerDay);
  if (diff < 0 || diff > 6) return -1;
  return diff;
}

/**
 * Bucket items into a 7-slot array, chronological (oldest first, today
 *  last). `getDate` extracts the timestamp; `getVal` the quantity to
 *  add to each bucket (default 1 = count). For avg-style metrics pass
 *  0 as the default and post-process divide.
 */
export function spark7<T>(
  items: T[],
  getDate: (i: T) => Date | null | undefined,
  getVal: (i: T) => number = () => 1,
  ref: Date = new Date(),
): number[] {
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  for (const item of items) {
    const b = dayBucket(getDate(item), ref);
    if (b < 0) continue;
    buckets[b] += getVal(item);
  }
  return buckets.slice().reverse();
}

/**
 * Per-day average (default 0 when bucket empty). Used for avg-quality
 *  style sparklines where "no reports today" should be a gap, not
 *  pretend to be zero quality.
 */
export function spark7Avg<T>(
  items: T[],
  getDate: (i: T) => Date | null | undefined,
  getVal: (i: T) => number,
  ref: Date = new Date(),
): number[] {
  const sums = [0, 0, 0, 0, 0, 0, 0];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const item of items) {
    const b = dayBucket(getDate(item), ref);
    if (b < 0) continue;
    sums[b] += getVal(item);
    counts[b] += 1;
  }
  return sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0)).slice().reverse();
}

/**
 * Running cumulative over 7 days — useful for "Tier" or "Total tests
 *  done" that should only ever grow. Takes a starting baseline (count
 *  of items dated *before* the 7-day window) so the chart picks up
 *  from the current total, not zero.
 */
export function spark7Cumulative<T>(
  items: T[],
  getDate: (i: T) => Date | null | undefined,
  baseline: number,
  ref: Date = new Date(),
): number[] {
  const daily = spark7(items, getDate, () => 1, ref);
  const out: number[] = [];
  let running = baseline;
  for (const v of daily) {
    running += v;
    out.push(running);
  }
  return out;
}

/**
 * Diff helpers for "this week vs last week" KPI deltas. The window is
 * fixed at 7 UTC days on both sides so `spark` and `delta` always
 * refer to the same period — otherwise users see "+3 this week" but
 * the chart shows 14 days. `ref` is usually `new Date()`; injectable
 * for tests.
 */
export function countInWindow<T>(
  items: T[],
  getDate: (i: T) => Date | null | undefined,
  startDaysAgo: number,
  endDaysAgo: number,
  ref: Date = new Date(),
): number {
  const msPerDay = 86_400_000;
  const refStart = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  const start = refStart - startDaysAgo * msPerDay;
  const end = refStart - endDaysAgo * msPerDay + msPerDay;
  let n = 0;
  for (const it of items) {
    const d = getDate(it);
    if (!d) continue;
    const t = new Date(d).getTime();
    if (t >= start && t < end) n += 1;
  }
  return n;
}

export function sumInWindow<T>(
  items: T[],
  getDate: (i: T) => Date | null | undefined,
  getVal: (i: T) => number,
  startDaysAgo: number,
  endDaysAgo: number,
  ref: Date = new Date(),
): number {
  const msPerDay = 86_400_000;
  const refStart = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  const start = refStart - startDaysAgo * msPerDay;
  const end = refStart - endDaysAgo * msPerDay + msPerDay;
  let s = 0;
  for (const it of items) {
    const d = getDate(it);
    if (!d) continue;
    const t = new Date(d).getTime();
    if (t >= start && t < end) s += getVal(it);
  }
  return s;
}

export function avgInWindow<T>(
  items: T[],
  getDate: (i: T) => Date | null | undefined,
  getVal: (i: T) => number,
  startDaysAgo: number,
  endDaysAgo: number,
  ref: Date = new Date(),
): number | null {
  const msPerDay = 86_400_000;
  const refStart = Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate());
  const start = refStart - startDaysAgo * msPerDay;
  const end = refStart - endDaysAgo * msPerDay + msPerDay;
  let s = 0;
  let n = 0;
  for (const it of items) {
    const d = getDate(it);
    if (!d) continue;
    const t = new Date(d).getTime();
    if (t >= start && t < end) {
      s += getVal(it);
      n += 1;
    }
  }
  return n > 0 ? s / n : null;
}

/**
 * Format a count-style delta. `this_week - prev_week` → signed string
 * with a "this week" suffix. Empty previous period → "new" marker.
 */
export function formatCountDelta(thisWeek: number, prevWeek: number): string {
  if (prevWeek === 0 && thisWeek === 0) return 'no activity this week';
  if (prevWeek === 0) return `+${thisWeek} this week (new)`;
  const diff = thisWeek - prevWeek;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff} this week`;
}

/** Same shape for sum-style deltas (e.g. USDC settled). */
export function formatSumDelta(thisWeek: number, prevWeek: number, unit = ''): string {
  if (prevWeek === 0 && thisWeek === 0) return 'no flow this week';
  const diff = thisWeek - prevWeek;
  const sign = diff >= 0 ? '+' : '';
  const body = `${sign}${diff.toFixed(2)}${unit ? ' ' + unit : ''} this week`;
  return prevWeek === 0 ? `${body} (new)` : body;
}

/** Avg-style delta rounded to 2dp. Null side → "—". */
export function formatAvgDelta(thisWeek: number | null, prevWeek: number | null): string {
  if (thisWeek == null && prevWeek == null) return 'no samples this week';
  if (prevWeek == null || prevWeek === 0) return `avg ${thisWeek!.toFixed(2)} this week`;
  if (thisWeek == null) return 'no samples this week';
  const diff = thisWeek - prevWeek;
  const sign = diff >= 0 ? '+' : '';
  return `${sign}${diff.toFixed(2)} vs last wk`;
}

export function tierFromTestsDone(n: number): string {
  if (n >= 11) return 'L4';
  if (n >= 6) return 'L3';
  if (n >= 3) return 'L2';
  return 'L1';
}

/**
 *  Compute top-N personas by avg quality of all reports from that
 *  persona's linked tester. Null `avg_quality` when the persona has no
 *  reports yet — we keep them so a freshly-minted gallery isn't empty,
 *  but rank them after real-data personas.
 */
async function topPersonas(limit = 3): Promise<PersonaSummary[]> {
  const personas = await db
    .select()
    .from(schema.personas)
    .where(eq(schema.personas.isActive, true));
  if (personas.length === 0) return [];

  const testerAddrs = personas.map((p: PersonaRow) => p.testerAddr);
  const reports =
    testerAddrs.length === 0
      ? []
      : await db
          .select({
            testerAddr: schema.testReports.testerAddr,
            qualityScore: schema.testReports.qualityScore,
          })
          .from(schema.testReports)
          .where(inArray(schema.testReports.testerAddr, testerAddrs));

  const rollup = new Map<string, { sum: number; count: number }>();
  for (const r of reports) {
    const cur = rollup.get(r.testerAddr) ?? { sum: 0, count: 0 };
    cur.sum += Number(r.qualityScore ?? 0);
    cur.count += 1;
    rollup.set(r.testerAddr, cur);
  }

  const scored: PersonaSummary[] = personas.map((p: PersonaRow) => {
    const agg = rollup.get(p.testerAddr);
    return {
      id: p.id,
      tester_addr: p.testerAddr,
      voice_sample: p.vector?.voice_sample ?? '',
      vector: p.vector,
      avg_quality: agg && agg.count > 0 ? agg.sum / agg.count : null,
      report_count: agg?.count ?? 0,
    };
  });

  // Personas with reports first (sorted by avg quality desc), then rest
  // ordered by newest-id-wins as a cheap tie-break.
  scored.sort((a, b) => {
    const aq = a.avg_quality ?? -1;
    const bq = b.avg_quality ?? -1;
    return bq - aq;
  });
  return scored.slice(0, limit);
}

async function personaForTester(testerAddr: string): Promise<PersonaSummary | null> {
  const [p] = await db
    .select()
    .from(schema.personas)
    .where(and(eq(schema.personas.testerAddr, testerAddr), eq(schema.personas.isActive, true)));
  if (!p) return null;
  const reports = await db
    .select({ qualityScore: schema.testReports.qualityScore })
    .from(schema.testReports)
    .where(eq(schema.testReports.testerAddr, testerAddr));
  const count = reports.length;
  const sum = reports.reduce((s: number, r: { qualityScore: number | null }) => s + Number(r.qualityScore ?? 0), 0);
  return {
    id: p.id,
    tester_addr: p.testerAddr,
    voice_sample: p.vector?.voice_sample ?? '',
    vector: p.vector,
    avg_quality: count > 0 ? sum / count : null,
    report_count: count,
  };
}

async function globalStats() {
  const allTests = await db.select({ id: schema.tests.id }).from(schema.tests);
  const allPersonas = await db
    .select({ id: schema.personas.id })
    .from(schema.personas)
    .where(eq(schema.personas.isActive, true));
  return { total_tests: allTests.length, total_personas: allPersonas.length };
}

// ─── Company view ─────────────────────────────────────────────────

export async function buildCompanyDashboard(wallet: string | null): Promise<DashboardResponse> {
  const stats = await globalStats();

  if (!wallet) {
    const recentTests = await db.select().from(schema.tests).orderBy(desc(schema.tests.createdAt)).limit(200);
    const recentReports = await db.select().from(schema.testReports).orderBy(desc(schema.testReports.createdAt)).limit(1000);
    const recentPersonas = await db.select().from(schema.personas).where(eq(schema.personas.isActive, true));
    const hybridReports = recentReports.filter((r: ReportRow) => r.sourceMode === 'stagehand_hybrid');
    return {
      role: 'company',
      wallet: null,
      kpis: [
        {
          label: 'Active tests',
          value: String(stats.total_tests),
          delta: formatCountDelta(
            countInWindow(recentTests, (t) => t.createdAt, 6, 0),
            countInWindow(recentTests, (t) => t.createdAt, 13, 7),
          ),
          spark: spark7(recentTests, (t) => t.createdAt),
        },
        {
          label: 'Personas live',
          value: String(stats.total_personas),
          delta: formatCountDelta(
            countInWindow(recentPersonas, (p: PersonaRow) => p.createdAt, 6, 0),
            countInWindow(recentPersonas, (p: PersonaRow) => p.createdAt, 13, 7),
          ),
          spark: spark7(recentPersonas, (p: PersonaRow) => p.createdAt),
        },
        {
          label: 'Reports collected',
          value: String(recentReports.length),
          delta: formatCountDelta(
            countInWindow(recentReports, (r) => r.createdAt, 6, 0),
            countInWindow(recentReports, (r) => r.createdAt, 13, 7),
          ),
          spark: spark7(recentReports, (r) => r.createdAt),
        },
        {
          label: 'AutoTest runs',
          value: String(hybridReports.length),
          delta: formatCountDelta(
            countInWindow(hybridReports, (r) => r.createdAt, 6, 0),
            countInWindow(hybridReports, (r) => r.createdAt, 13, 7),
          ),
          spark: spark7(hybridReports, (r) => r.createdAt),
        },
      ],
      primary_list: await recentActiveTests(),
      activity: await globalActivity(),
      stats,
      top_personas: await topPersonas(3),
    };
  }

  const myTests = await db
    .select()
    .from(schema.tests)
    .where(eq(schema.tests.companyAddr, wallet))
    .orderBy(desc(schema.tests.createdAt));

  const testIds = myTests.map((t: TestRow) => t.id);
  const myReports =
    testIds.length === 0
      ? []
      : await db
          .select()
          .from(schema.testReports)
          .where(inArray(schema.testReports.testId, testIds))
          .orderBy(desc(schema.testReports.createdAt));

  const activeTests = myTests.filter((t: TestRow) => t.status === 'active');
  const budgetDeployed = myTests.reduce((s: number, t: TestRow) => s + Number(t.budgetUsdc ?? 0), 0);
  const autotestRuns = myReports.filter((r: ReportRow) => r.sourceMode === 'stagehand_hybrid').length;

  const hybridReports = myReports.filter((r: ReportRow) => r.sourceMode === 'stagehand_hybrid');

  const kpis: DashboardKpi[] = [
    {
      label: 'Active tests',
      value: String(activeTests.length),
      delta: formatCountDelta(
        countInWindow(myTests, (t) => t.createdAt, 6, 0),
        countInWindow(myTests, (t) => t.createdAt, 13, 7),
      ),
      spark: spark7(myTests, (t) => t.createdAt),
    },
    {
      label: 'Reports collected',
      value: String(myReports.length),
      delta: formatCountDelta(
        countInWindow(myReports, (r) => r.createdAt, 6, 0),
        countInWindow(myReports, (r) => r.createdAt, 13, 7),
      ),
      spark: spark7(myReports, (r) => r.createdAt),
    },
    {
      label: 'Budget deployed',
      value: budgetDeployed.toFixed(0),
      unit: 'USDC',
      delta: formatSumDelta(
        sumInWindow(myTests, (t) => t.createdAt, (t) => Number(t.budgetUsdc ?? 0), 6, 0),
        sumInWindow(myTests, (t) => t.createdAt, (t) => Number(t.budgetUsdc ?? 0), 13, 7),
        'USDC',
      ),
      spark: spark7(myTests, (t) => t.createdAt, (t) => Number(t.budgetUsdc ?? 0)),
    },
    {
      label: 'AutoTest runs',
      value: String(autotestRuns),
      delta: formatCountDelta(
        countInWindow(hybridReports, (r) => r.createdAt, 6, 0),
        countInWindow(hybridReports, (r) => r.createdAt, 13, 7),
      ),
      spark: spark7(hybridReports, (r) => r.createdAt),
    },
  ];

  const primary_list: DashboardListItem[] = myTests
    .filter((t: TestRow) => t.status === 'active' || t.status === 'pending')
    .slice(0, 4)
    .map((t: TestRow) => {
      const rc = myReports.filter((r: ReportRow) => r.testId === t.id).length;
      const target = Math.max(1, Math.ceil(Number(t.budgetUsdc) / Math.max(1, Number(t.rewardPerTester))));
      return {
        id: t.id,
        title: shortenUrl(t.targetUrl),
        status: t.status,
        meta: `${rc}/${target} reports`,
        pay: `${Number(t.rewardPerTester).toFixed(0)} USDC`,
        tone: t.status === 'active' ? 'success' : 'warn',
        href: `/company/test/${t.id}`,
      };
    });

  const activity: DashboardActivityItem[] = [
    ...myReports.slice(0, 20).map((r: ReportRow): DashboardActivityItem => {
      const q = Number(r.qualityScore ?? 0);
      return {
        at: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        t: timeAgo(r.createdAt),
        text: `Report · q=${q.toFixed(2)} · ${r.sourceMode}`,
        kind: 'report',
        tone: q >= 4 ? 'success' : q < 3 ? 'warn' : '',
        meta: `${r.testerAddr.slice(0, 6)}…${r.testerAddr.slice(-4)}`,
      };
    }),
    ...myTests.slice(0, 6).map((t: TestRow): DashboardActivityItem => ({
      at: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
      t: timeAgo(t.createdAt),
      text: `Test registered · ${shortenUrl(t.targetUrl)}`,
      kind: 'test',
      tone: 'accent',
      meta: `${Number(t.budgetUsdc ?? 0).toFixed(0)} USDC`,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 20);

  return {
    role: 'company',
    wallet,
    kpis,
    primary_list,
    activity,
    stats,
    top_personas: await topPersonas(3),
  };
}

// ─── Tester view ──────────────────────────────────────────────────

export async function buildTesterDashboard(wallet: string | null): Promise<DashboardResponse> {
  const stats = await globalStats();

  if (!wallet) {
    const recentReports = await db.select().from(schema.testReports).orderBy(desc(schema.testReports.createdAt)).limit(1000);
    const openTestsAll = await db.select().from(schema.tests).where(eq(schema.tests.status, 'active'));
    const allTests = await db.select().from(schema.tests).orderBy(desc(schema.tests.createdAt)).limit(200);
    const allPersonas = await db.select().from(schema.personas).where(eq(schema.personas.isActive, true));
    return {
      role: 'tester',
      wallet: null,
      kpis: [
        {
          label: 'Open tests',
          value: String(openTestsAll.length),
          delta: formatCountDelta(
            countInWindow(allTests, (t) => t.createdAt, 6, 0),
            countInWindow(allTests, (t) => t.createdAt, 13, 7),
          ),
          spark: spark7(allTests, (t) => t.createdAt),
        },
        {
          label: 'Reports submitted',
          value: String(recentReports.length),
          delta: formatCountDelta(
            countInWindow(recentReports, (r) => r.createdAt, 6, 0),
            countInWindow(recentReports, (r) => r.createdAt, 13, 7),
          ),
          spark: spark7(recentReports, (r) => r.createdAt),
        },
        {
          label: 'Avg quality',
          value: (await globalAvgQuality()).toFixed(2),
          unit: '/ 5',
          delta: formatAvgDelta(
            avgInWindow(recentReports, (r) => r.createdAt, (r) => Number(r.qualityScore ?? 0), 6, 0),
            avgInWindow(recentReports, (r) => r.createdAt, (r) => Number(r.qualityScore ?? 0), 13, 7),
          ),
          spark: spark7Avg(recentReports, (r) => r.createdAt, (r) => Number(r.qualityScore ?? 0)),
        },
        {
          label: 'Personas live',
          value: String(stats.total_personas),
          delta: formatCountDelta(
            countInWindow(allPersonas, (p: PersonaRow) => p.createdAt, 6, 0),
            countInWindow(allPersonas, (p: PersonaRow) => p.createdAt, 13, 7),
          ),
          spark: spark7(allPersonas, (p: PersonaRow) => p.createdAt),
        },
      ],
      primary_list: await recentActiveTests(),
      activity: await globalActivity(),
      stats,
      // No wallet = no personal persona. Surface the top community
      // persona instead so the sidebar radar isn't empty and the user
      // sees the shape of persona data the platform exposes.
      my_persona: (await topPersonas(1))[0] ?? null,
      top_personas: await topPersonas(3),
    };
  }

  const myReports = await db
    .select()
    .from(schema.testReports)
    .where(eq(schema.testReports.testerAddr, wallet))
    .orderBy(desc(schema.testReports.createdAt));

  const [me] = await db
    .select()
    .from(schema.testers)
    .where(eq(schema.testers.walletAddress, wallet));

  const mySettlements = await db
    .select()
    .from(schema.settlements)
    .where(eq(schema.settlements.payeeAddr, wallet))
    .orderBy(desc(schema.settlements.settledAt));

  const earnings = mySettlements.reduce((s: number, st: SettlementRow) => s + Number(st.amountToken ?? 0), 0);
  const testsDone = me?.testsDone ?? myReports.length;
  const tier = tierFromTestsDone(testsDone);

  // Reports older than the 7-day window — lets the cumulative chart
  // start from the running total instead of zero.
  const reportsBeforeWindow = Math.max(0, testsDone - spark7(myReports, (r) => r.createdAt).reduce((s, v) => s + v, 0));

  const kpis: DashboardKpi[] = [
    {
      label: 'Reports submitted',
      value: String(myReports.length),
      delta: formatCountDelta(
        countInWindow(myReports, (r) => r.createdAt, 6, 0),
        countInWindow(myReports, (r) => r.createdAt, 13, 7),
      ),
      spark: spark7(myReports, (r) => r.createdAt),
    },
    {
      label: 'Avg quality',
      value: (myReports.length === 0
        ? 0
        : myReports.reduce((s: number, r: ReportRow) => s + Number(r.qualityScore ?? 0), 0) / myReports.length
      ).toFixed(2),
      unit: '/ 5',
      delta: formatAvgDelta(
        avgInWindow(myReports, (r) => r.createdAt, (r) => Number(r.qualityScore ?? 0), 6, 0),
        avgInWindow(myReports, (r) => r.createdAt, (r) => Number(r.qualityScore ?? 0), 13, 7),
      ),
      spark: spark7Avg(myReports, (r) => r.createdAt, (r) => Number(r.qualityScore ?? 0)),
    },
    {
      label: 'Earnings',
      value: earnings.toFixed(2),
      unit: 'USDC',
      delta: formatSumDelta(
        sumInWindow(mySettlements, (s) => s.settledAt, (s) => Number(s.amountToken ?? 0), 6, 0),
        sumInWindow(mySettlements, (s) => s.settledAt, (s) => Number(s.amountToken ?? 0), 13, 7),
        'USDC',
      ),
      spark: spark7(mySettlements, (s) => s.settledAt, (s) => Number(s.amountToken ?? 0)),
    },
    {
      label: 'Tier',
      value: tier,
      delta: `${testsDone} total · ${me?.personaId ? 'persona live' : 'no persona'}`,
      spark: spark7Cumulative(myReports, (r) => r.createdAt, reportsBeforeWindow),
    },
  ];

  const openTests = await db
    .select()
    .from(schema.tests)
    .where(eq(schema.tests.status, 'active'))
    .orderBy(desc(schema.tests.createdAt))
    .limit(4);

  const primary_list: DashboardListItem[] = openTests.map((t: TestRow) => ({
    id: t.id,
    title: shortenUrl(t.targetUrl),
    status: `${Number(t.rewardPerTester).toFixed(0)} USDC / report`,
    meta: `${Number(t.budgetUsdc).toFixed(0)} USDC budget`,
    pay: t.status,
    tone: 'accent',
    href: `/tester/test/${t.id}`,
  }));

  const activity: DashboardActivityItem[] = [
    ...myReports.slice(0, 20).map((r: ReportRow): DashboardActivityItem => {
      const q = Number(r.qualityScore ?? 0);
      return {
        at: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        t: timeAgo(r.createdAt),
        text: `Report submitted · q=${q.toFixed(2)}`,
        kind: 'report',
        tone: q >= 4 ? 'success' : q < 3 ? 'warn' : '',
        meta: r.sourceMode,
      };
    }),
    ...mySettlements.slice(0, 10).map((s: SettlementRow): DashboardActivityItem => ({
      at: s.settledAt instanceof Date ? s.settledAt.toISOString() : String(s.settledAt),
      t: timeAgo(s.settledAt),
      text: `Settlement · ${Number(s.amountToken).toFixed(2)} ${s.settlementType.toUpperCase()}`,
      kind: 'settlement',
      tone: 'info',
      meta: s.txSignature ? `${s.txSignature.slice(0, 8)}…` : undefined,
    })),
  ]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 20);

  return {
    role: 'tester',
    wallet,
    kpis,
    primary_list,
    activity,
    stats,
    my_persona: await personaForTester(wallet),
  };
}

// ─── Internal helpers (global fallbacks) ──────────────────────────

async function globalAvgQuality() {
  const rows = await db
    .select({ q: schema.testReports.qualityScore })
    .from(schema.testReports);
  if (rows.length === 0) return 0;
  const sum = rows.reduce((s: number, r: { q: number | null }) => s + Number(r.q ?? 0), 0);
  return sum / rows.length;
}

async function recentActiveTests(): Promise<DashboardListItem[]> {
  const tests = await db
    .select()
    .from(schema.tests)
    .where(eq(schema.tests.status, 'active'))
    .orderBy(desc(schema.tests.createdAt))
    .limit(4);
  return tests.map((t: TestRow) => ({
    id: t.id,
    title: shortenUrl(t.targetUrl),
    status: 'active',
    meta: `${Number(t.budgetUsdc).toFixed(0)} USDC budget`,
    pay: `${Number(t.rewardPerTester).toFixed(0)} USDC`,
    tone: 'success',
    href: `/tester/test/${t.id}`,
  }));
}

async function globalActivity(): Promise<DashboardActivityItem[]> {
  const reports = await db
    .select()
    .from(schema.testReports)
    .orderBy(desc(schema.testReports.createdAt))
    .limit(15);
  const tests = await db
    .select()
    .from(schema.tests)
    .orderBy(desc(schema.tests.createdAt))
    .limit(8);
  const items: DashboardActivityItem[] = [
    ...reports.map((r: ReportRow): DashboardActivityItem => {
      const q = Number(r.qualityScore ?? 0);
      return {
        at: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        t: timeAgo(r.createdAt),
        text: `Report · q=${q.toFixed(2)} · ${r.sourceMode}`,
        kind: 'report',
        tone: q >= 4 ? 'success' : q < 3 ? 'warn' : '',
        meta: `${r.testerAddr.slice(0, 6)}…${r.testerAddr.slice(-4)}`,
      };
    }),
    ...tests.map((t: TestRow): DashboardActivityItem => ({
      at: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
      t: timeAgo(t.createdAt),
      text: `Test registered · ${shortenUrl(t.targetUrl)}`,
      kind: 'test',
      tone: 'accent',
      meta: `${Number(t.budgetUsdc ?? 0).toFixed(0)} USDC`,
    })),
  ];
  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 20);
}

void and;
