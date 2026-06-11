// Console S1 grouping helpers — shared by /console and
// /console/sites/[host]. Lives outside the page files because Next.js
// App Router restricts page exports to its own contract fields.
//
// hostOf() is the S1 stand-in for the site_workspaces entity (Sprint
// 2): scans group by normalized URL host, no DB change needed.

import type { ScanSummary } from "@/lib/api";

/** Normalized grouping key — strips scheme + www + trailing path. */
export function hostOf(url: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  }
}

export type SiteGroup = {
  host: string;
  scans: ScanSummary[]; // newest first
  latestCompleted: ScanSummary | null;
  prevCompleted: ScanSummary | null;
};

export function groupScansByHost(scans: ScanSummary[]): SiteGroup[] {
  const byHost = new Map<string, ScanSummary[]>();
  for (const s of scans) {
    const h = hostOf(s.target_url);
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h)!.push(s);
  }
  const groups: SiteGroup[] = [];
  for (const [host, list] of byHost) {
    const sorted = [...list].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const completed = sorted.filter(
      (s) => s.status === "completed" && s.audience_fit_score != null,
    );
    groups.push({
      host,
      scans: sorted,
      latestCompleted: completed[0] ?? null,
      prevCompleted: completed[1] ?? null,
    });
  }
  // Most recently active site first.
  groups.sort(
    (a, b) =>
      new Date(b.scans[0]!.created_at).getTime() -
      new Date(a.scans[0]!.created_at).getTime(),
  );
  return groups;
}
