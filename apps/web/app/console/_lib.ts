// Console shared helper. hostOf() groups the Unassigned-scans section
// by host and MUST stay in lockstep with the API's normalizeHost
// (apps/api/src/services/workspaces.ts) — same rule, two runtimes.
// (The S1 client-side groupScansByHost helper was superseded by the
// server-grouped /api/console/sites in Sprint 2 and removed.)

/** Normalized grouping key — strips scheme + www + trailing path. */
export function hostOf(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  }
}
