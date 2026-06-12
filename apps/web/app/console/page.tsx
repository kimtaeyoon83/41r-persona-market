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

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
  consoleApi,
  meApi,
  scanApi,
  type ConsoleSiteListItem,
  type ScanSummary,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { C, FM, FS, Frame, Pill } from "../validator/_components/ui";
import { hostOf } from "./_lib";

type UnassignedScan = ScanSummary & { workspace_id: string | null };

export default function ConsolePage() {
  const { ready, authenticated, login } = useAuth();
  const { t } = useI18n();
  const [sites, setSites] = useState<ConsoleSiteListItem[] | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedScan[]>([]);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [siteRes, mine, credits] = await Promise.all([
      consoleApi.listSites(),
      scanApi.getMyScans(),
      meApi.getCredits(),
    ]);
    setSites(siteRes.sites);
    setUnassigned(mine.scans.filter((s) => !s.workspace_id));
    setBalanceCents(credits.balance_cents);
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
    <Frame>
      <div className="v-page-pad" style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div
          className="v-row-wrap"
          style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}
        >
          <h1 style={{ fontSize: 30, fontWeight: 600, fontFamily: FS, margin: 0 }}>
            {t("console.title")}
          </h1>
          <div style={{ flex: 1 }} />
          {balanceCents != null && (
            <Link href="/me" style={{ textDecoration: "none" }}>
              <Pill tone="accent" style={{ fontFamily: FM, fontSize: 12 }}>
                ${(balanceCents / 100).toFixed(2)} · {t("console.creditsLeft")}
              </Pill>
            </Link>
          )}
          <Link
            href="/console/sites/new"
            style={{
              background: C.text,
              color: C.bg,
              borderRadius: 999,
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
              fontFamily: FS,
            }}
          >
            {t("console.addSite")}
          </Link>
        </div>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 28 }}>
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
      </div>
    </Frame>
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
        borderRadius: 10,
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
        style={{
          display: "inline-block",
          background: C.accent,
          color: "#fff",
          borderRadius: 8,
          padding: "10px 20px",
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
      style={{
        display: "block",
        padding: 16,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
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
