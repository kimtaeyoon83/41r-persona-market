"use client";

// /console — Founder Console site list (Console Sprint 1).
//
// Groups the user's scans by URL host — the S1 stand-in for the
// site_workspaces entity that lands in Sprint 2 (no DB change needed
// for the "scan-centric → site-centric" perception shift,
// console-ia-redesign.md §11 S1). Header shows the credit balance from
// the append-only ledger. Copy never says "my site" — registering a
// competitor's site is a first-class use case (§5 copy rule).

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { scanApi, meApi, type ScanSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { C, FM, FS, Frame, Pill } from "../validator/_components/ui";
import { groupScansByHost, type SiteGroup } from "./_lib";

export default function ConsolePage() {
  const { ready, authenticated, login } = usePrivy();
  const { t } = useI18n();
  const [scans, setScans] = useState<ScanSummary[] | null>(null);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    Promise.all([scanApi.getMyScans(), meApi.getCredits()])
      .then(([mine, credits]) => {
        if (cancelled) return;
        setScans(mine.scans);
        setBalanceCents(credits.balance_cents);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated]);

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

  const groups = scans ? groupScansByHost(scans) : null;

  return (
    <Frame>
      <div className="v-page-pad" style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div
          className="v-row-wrap"
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            marginBottom: 6,
          }}
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
            href="/"
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
            {t("console.newAnalysis")}
          </Link>
        </div>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 28 }}>
          {t("console.subtitle")}
        </div>

        {error && (
          <div style={{ color: C.bad, fontSize: 13, marginBottom: 14 }}>{error}</div>
        )}

        {groups === null ? (
          <Center>{t("common.loading")}</Center>
        ) : groups.length === 0 ? (
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
              href="/"
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
        ) : (
          <div
            className="v-grid-stack-sm"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
              gap: 12,
            }}
          >
            {groups.map((g) => (
              <SiteCard key={g.host} group={g} />
            ))}
          </div>
        )}
      </div>
    </Frame>
  );
}

function SiteCard({ group }: { group: SiteGroup }) {
  const { t } = useI18n();
  const latest = group.latestCompleted;
  const score =
    latest?.audience_fit_score != null ? Math.round(latest.audience_fit_score) : null;
  const prev = group.prevCompleted?.audience_fit_score;
  const delta = score != null && prev != null ? Math.round(score - prev) : null;
  const tone =
    score == null ? C.textFaint : score >= 60 ? C.ok : score >= 40 ? C.warn : C.bad;
  const newest = group.scans[0]!;

  return (
    <Link
      href={`/console/sites/${encodeURIComponent(group.host)}`}
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
          fontSize: 14,
          fontWeight: 600,
          fontFamily: FM,
          marginBottom: 10,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {group.host}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 30, fontWeight: 600, fontFamily: FM, color: tone }}>
          {score ?? "—"}
        </span>
        {delta != null && delta !== 0 && (
          <span
            style={{ fontSize: 12, fontFamily: FM, color: delta > 0 ? C.ok : C.bad }}
          >
            {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
          </span>
        )}
        <span style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}>
          · {group.scans.length} {t("console.scansUnit")}
        </span>
      </div>
      {latest?.best_cohort_label && (
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>
          {t("console.bestFit")}: <b>{latest.best_cohort_label}</b>
          {latest.best_cohort_score != null &&
            ` (${Math.round(latest.best_cohort_score)})`}
        </div>
      )}
      <div style={{ fontSize: 10, color: C.textFaint, fontFamily: FM }}>
        {t("console.lastScan")} {timeAgo(newest.completed_at ?? newest.created_at)}
        {latest?.category ? ` · ${latest.category}` : ""}
      </div>
    </Link>
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
