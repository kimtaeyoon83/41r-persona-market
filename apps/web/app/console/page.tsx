"use client";

// /console — Founder Console site list (Console Sprint 2).
//
// S2 replaces the S1 host-grouping stand-in with real site_workspaces:
// registered sites render as cards with the emergent LITE/TRACKED
// badge (§1.2 — a beacon arrived → TRACKED, no tier picker); the
// user's scans that aren't linked to any workspace show in the
// "Unassigned" section with a one-click register path. Copy never
// says "my site" — registering a competitor's site is a first-class
// use case (§5 copy rule).

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
  consoleApi,
  scanApi,
  type ConsoleSiteListItem,
  type ScanSummary,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { C, FM, FS, Frame, Pill } from "../validator/_components/ui";
import { ConsoleShell } from "./_components/shell";
import { hostOf } from "./_lib";

type UnassignedScan = ScanSummary & { workspace_id: string | null };

export default function ConsolePage() {
  // ConsoleShell reads useSearchParams — Next requires a Suspense
  // boundary above it for prerendering.
  return (
    <Suspense fallback={null}>
      <ConsoleInner />
    </Suspense>
  );
}

function ConsoleInner() {
  const { ready, authenticated, login } = useAuth();
  const { t } = useI18n();
  const [sites, setSites] = useState<ConsoleSiteListItem[] | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedScan[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Credit balance moved to the ConsoleShell sidebar footer.
  const load = useCallback(async () => {
    const [siteRes, mine] = await Promise.all([
      consoleApi.listSites(),
      scanApi.getMyScans(),
    ]);
    setSites(siteRes.sites);
    setUnassigned(mine.scans.filter((s) => !s.workspace_id));
  }, []);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    load().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
    });
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, load]);

  if (!ready) {
    return (
      <Frame>
        <Center>{t("common.loading")}</Center>
      </Frame>
    );
  }

  if (!authenticated) {
    return (
      <Frame>
        <Center>
          <h1 style={{ fontSize: 26, fontWeight: 600, fontFamily: FS, marginBottom: 8 }}>
            {t("common.signInTitle")}
          </h1>
          <div style={{ fontSize: 13, color: C.textDim, marginBottom: 18 }}>
            {t("common.signInBody")}
          </div>
          <button
            onClick={login}
            style={{
              padding: "12px 24px",
              fontSize: 13,
              fontWeight: 600,
              background: C.text,
              color: C.bg,
              border: "none",
              borderRadius: 999,
              cursor: "pointer",
              fontFamily: FS,
            }}
          >
            {t("nav.signIn")}
          </button>
        </Center>
      </Frame>
    );
  }

  const empty = sites !== null && sites.length === 0 && unassigned.length === 0;

  return (
    <ConsoleShell>
      <div
        className="v-row-wrap"
        style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 650, fontFamily: FS, margin: 0, letterSpacing: "-0.02em" }}>
          {t("console.title")}
        </h1>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Link
            href="/console/sites/new"
            className="e-cta"
            style={{
              background: C.accent,
              color: "#fff",
              borderRadius: 8,
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
              fontFamily: FS,
            }}
          >
            {t("console.addSite")}
          </Link>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: C.textDim, marginBottom: 24 }}>
        {t("console.subtitle")}
      </div>

      {error && (
        <div style={{ color: C.bad, fontSize: 13, marginBottom: 14 }}>{error}</div>
      )}

      {sites === null ? (
        <Center>{t("common.loading")}</Center>
      ) : empty ? (
        <EmptyState />
      ) : (
        <>
          <div
            className="v-grid-stack-sm"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 12,
            }}
          >
            {sites.map((s) => (
              <SiteCard key={s.id} site={s} />
            ))}
          </div>
          {unassigned.length > 0 && <UnassignedSection scans={unassigned} />}
        </>
      )}
    </ConsoleShell>
  );
}

function EmptyState() {
  const { t } = useI18n();
  return (
    <div
      style={{
        padding: "48px 32px",
        textAlign: "center",
        border: `1px dashed ${C.border}`,
        borderRadius: 14,
        background: C.panel,
      }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 600,
          maxWidth: 520,
          margin: "0 auto 8px",
          lineHeight: 1.5,
        }}
      >
        {t("console.emptyTitle")}
      </div>
      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 18 }}>
        {t("console.emptySub")}
      </div>
      <Link
        href="/console/sites/new"
        className="e-cta"
        style={{
          display: "inline-block",
          background: C.accent,
          color: "#fff",
          borderRadius: 10,
          padding: "11px 22px",
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        {t("console.emptyCta")} →
      </Link>
    </div>
  );
}

function SiteCard({ site }: { site: ConsoleSiteListItem }) {
  const { t } = useI18n();
  const score = site.latest_score != null ? Math.round(site.latest_score) : null;
  const delta =
    score != null && site.prev_score != null
      ? Math.round(score - site.prev_score)
      : null;
  const tone =
    score == null ? C.textFaint : score >= 60 ? C.ok : score >= 40 ? C.warn : C.bad;

  return (
    <Link
      href={`/console/sites/${site.id}`}
      className="e-card"
      style={{
        display: "block",
        padding: 18,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        textDecoration: "none",
        color: C.text,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            fontFamily: FM,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {site.name && site.name !== site.url_host
            ? `${site.name} · ${site.url_host}`
            : site.url_host}
        </span>
        <Pill tone={site.tracked ? "ok" : "neutral"} style={{ fontSize: 9 }}>
          {site.tracked ? "● TRACKED" : "○ LITE"}
        </Pill>
        {site.role === "viewer" && (
          <Pill tone="accent" style={{ fontSize: 9 }}>
            {t("console.sharedBadge")}
          </Pill>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 600, fontFamily: FM, color: tone }}>
          {score ?? "—"}
        </span>
        {delta != null && delta !== 0 && (
          <span style={{ fontSize: 12, fontFamily: FM, color: delta > 0 ? C.ok : C.bad }}>
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </span>
        )}
        <span style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}>
          · {site.scan_count} {t("console.scansUnit")}
        </span>
      </div>
      <div style={{ fontSize: 10, color: C.textFaint, fontFamily: FM }}>
        {site.last_scan_at
          ? `${t("console.lastScan")} ${timeAgo(site.last_scan_at)}`
          : t("console.noCompleted")}
        {site.latest_category ? ` · ${site.latest_category}` : ""}
      </div>
    </Link>
  );
}

function UnassignedSection({ scans }: { scans: UnassignedScan[] }) {
  const { t } = useI18n();
  // Group by host so one register action covers all scans of a site
  // (the server adopts matching scans on workspace create).
  const byHost = new Map<string, UnassignedScan[]>();
  for (const s of scans) {
    const h = hostOf(s.target_url);
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h)!.push(s);
  }
  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
        {t("console.unassigned")}
      </div>
      <div style={{ fontSize: 11, color: C.textFaint, marginBottom: 10 }}>
        {t("console.unassignedSub")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[...byHost.entries()].map(([host, list]) => (
          <div
            key={host}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              background: C.panel,
              border: `1px dashed ${C.border}`,
              borderRadius: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontFamily: FM, fontSize: 13, fontWeight: 600 }}>{host}</span>
            <span style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}>
              {list.length} {t("console.scansUnit")}
            </span>
            <div style={{ flex: 1 }} />
            {list[0]!.status === "completed" && (
              <Link
                href={`/validator/report/${list[0]!.id}`}
                style={{ fontSize: 12, color: C.textDim, textDecoration: "none" }}
              >
                {t("console.openReport")}
              </Link>
            )}
            <Link
              href={`/console/sites/new?url=${encodeURIComponent(host)}`}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: C.accent,
                textDecoration: "none",
              }}
            >
              {t("console.registerAsSite")} →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{ padding: "120px 32px", textAlign: "center", color: C.textDim, fontSize: 14 }}
    >
      {children}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
