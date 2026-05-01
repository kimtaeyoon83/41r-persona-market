// Calibration aggregator — Phase 2-C-1.
//
// Pure function: given a flat list of calibration_records rows,
// produces the shape the /validator/calibration UI needs:
//   - correlations: per-dimension Pearson r + sample size + confidence
//   - tracks: row counts per source (Track A / B / C)
//   - versions: weight-version timeline (currently fixed default,
//     placeholder until weight-evolution lands in Phase 2-C-2)
//
// Skips dimensions with n<3 (correlation undefined). Returns the
// raw point estimate; the caller decides whether to suppress in the
// UI (we surface n alongside so they can).

// ─── Input shape ──────────────────────────────────────────────────
export type CalibrationRecord = {
  date: string;             // YYYY-MM-DD
  siteUrl: string;
  personaId: string | null;
  dimension: string;        // 'engagement' | 'task_success' | 'happiness' | 'adoption' | 'retention'
  llmInference: number;
  groundTruth: number;
  delta: number;
  source: string;           // 'stagehand' | 'human_baseline' | 'analytics'
};

export type CorrelationRow = {
  dimension: string;
  correlation: number | null;
  n: number;
  confidence: 'High' | 'Medium-High' | 'Medium' | 'Low-Medium' | 'Low' | 'n/a';
  // String like "+0.06" / "−0.01" / "—" — matches the existing
  // hardcoded fixture's shape.
  change: string;
};

export type TrackCount = {
  key: string;              // e.g. "Track A · Stagehand"
  source: string;
  n: number;
};

export type VersionRow = {
  v: string;
  d: string;                // YYYY-MM
  hap: number;
  eng: number;
  tsk: number;
  ado: number;
  ret: number;
  current?: boolean;
};

export type CalibrationAggregate = {
  correlations: CorrelationRow[];
  tracks: TrackCount[];
  versions: VersionRow[];
  totalRecords: number;
};

// Default version timeline. Phase 2-C-2 will derive this from a
// `calibration_versions` history table; for now it's the spec §5.4
// canonical sequence so the UI has something to chart immediately.
const DEFAULT_VERSIONS: VersionRow[] = [
  { v: 'v1.0', d: '2026-01', hap: 0.25, eng: 0.30, tsk: 0.30, ado: 0.10, ret: 0.05 },
  { v: 'v1.1', d: '2026-02', hap: 0.24, eng: 0.32, tsk: 0.31, ado: 0.09, ret: 0.04 },
  { v: 'v1.2', d: '2026-03', hap: 0.22, eng: 0.36, tsk: 0.33, ado: 0.06, ret: 0.03 },
  { v: 'v1.3', d: '2026-04', hap: 0.20, eng: 0.40, tsk: 0.32, ado: 0.05, ret: 0.03, current: true },
];

const DIMENSION_ORDER = [
  'engagement',
  'task_success',
  'happiness',
  'adoption',
  'retention',
] as const;

const TRACK_LABELS: Record<string, string> = {
  stagehand: 'Track A · Stagehand',
  human_baseline: 'Track B · Human SUS',
  analytics: 'Track C · Analytics',
};

// ─── Pearson correlation ──────────────────────────────────────────
// Returns null when n<3 OR when either series has zero variance
// (correlation is undefined in that case).
export function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length) {
    throw new Error(`pearson: length mismatch ${xs.length} vs ${ys.length}`);
  }
  const n = xs.length;
  if (n < 3) return null;

  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const denom = Math.sqrt(denX * denY);
  if (denom === 0) return null;
  return num / denom;
}

function classifyConfidence(r: number | null): CorrelationRow['confidence'] {
  if (r === null) return 'n/a';
  const a = Math.abs(r);
  if (a >= 0.7) return 'High';
  if (a >= 0.55) return 'Medium-High';
  if (a >= 0.4) return 'Medium';
  if (a >= 0.25) return 'Low-Medium';
  return 'Low';
}

function formatChange(curr: number | null, prev: number | null): string {
  if (curr === null || prev === null) return '—';
  const delta = curr - prev;
  if (Math.abs(delta) < 0.005) return '±0.00';
  const sign = delta >= 0 ? '+' : '−';
  return `${sign}${Math.abs(delta).toFixed(2)}`;
}

function prettyDimension(d: string): string {
  return d
    .split('_')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

// ─── Aggregator ───────────────────────────────────────────────────
// `priorRecords` (optional) is the previous period's record set —
// used to compute per-dimension delta. Caller supplies; the
// aggregator does NOT date-bucket on its own.
export function aggregateCalibration(
  records: readonly CalibrationRecord[],
  priorRecords: readonly CalibrationRecord[] = [],
): CalibrationAggregate {
  const correlations: CorrelationRow[] = [];

  for (const dim of DIMENSION_ORDER) {
    const rows = records.filter((r) => r.dimension === dim);
    const xs = rows.map((r) => r.llmInference);
    const ys = rows.map((r) => r.groundTruth);
    const r = pearson(xs, ys);

    const priorRows = priorRecords.filter((p) => p.dimension === dim);
    const priorR =
      priorRows.length >= 3
        ? pearson(
            priorRows.map((p) => p.llmInference),
            priorRows.map((p) => p.groundTruth),
          )
        : null;

    correlations.push({
      dimension: prettyDimension(dim),
      correlation: r,
      n: rows.length,
      confidence: classifyConfidence(r),
      change: formatChange(r, priorR),
    });
  }

  const tracks: TrackCount[] = [];
  for (const src of ['stagehand', 'human_baseline', 'analytics']) {
    tracks.push({
      key: TRACK_LABELS[src] ?? src,
      source: src,
      n: records.filter((r) => r.source === src).length,
    });
  }

  return {
    correlations,
    tracks,
    versions: DEFAULT_VERSIONS,
    totalRecords: records.length,
  };
}
