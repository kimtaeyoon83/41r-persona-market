"use client";

// /me/analyses — Phase 4 P4-5 (decision §8.3 My Analyses).
//
// Auth-gated list of the current user's scans. Each card links to its
// report and shows the sponsored-payment Solscan link when present.
// Privy's bearer token is auto-attached by lib/api.ts (setAuthTokenGetter
// wired in providers.tsx) so getMyScans() works as soon as Privy is ready.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePrivy } from "@privy-io/react-auth";
import { scanApi, type ScanSummary } from "@/lib/api";
import { C, FM, FS, Frame, Pill } from "../../validator/_components/ui";

type MyScan = ScanSummary & {
  payment_tx_signature: string | null;
  payment_solscan: string | null;
};

export default function MyAnalysesPage() {
  const { ready, authenticated, login } = usePrivy();
  const [scans, setScans] = useState<MyScan[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setScans([]);
      return;
    }
    let cancelled = false;
    scanApi
      .getMyScans()
      .then((r) => {
        if (cancelled) return;
        setScans(r.scans);
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
      <Frame active="discovery">
        <Center>Loading…</Center>
      </Frame>
    );
  }

  if (!authenticated) {
    return (
      <Frame active="discovery">
        <Center>
          <h1 style={{ fontSize: 26, fontWeight: 600, fontFamily: FS, marginBottom: 14 }}>
            Sign in to see your analyses
          </h1>
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
            Sign in
          </button>
        </Center>
      </Frame>
    );
  }

  return (
    <Frame active="discovery">
      <div style={{ padding: "40px 32px 80px", maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ marginBottom: 28 }}>
          <Link
            href="/"
            style={{ fontSize: 12, color: C.textFaint, fontFamily: FM, textDecoration: "none" }}
          >
            ← Home
          </Link>
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 600, fontFamily: FS, marginBottom: 8 }}>
          My Analyses
        </h1>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 30 }}>
          Scans you&apos;ve requested. Click a card for the full report.
        </div>

        {error && (
          <div style={{ color: C.bad, fontSize: 13, marginBottom: 14 }}>{error}</div>
        )}

        {scans === null ? (
          <Center>Loading…</Center>
        ) : scans.length === 0 ? (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              border: `1px dashed ${C.border}`,
              borderRadius: 8,
              color: C.textDim,
            }}
          >
            <div style={{ fontSize: 14, marginBottom: 8 }}>No analyses yet.</div>
            <Link
              href="/"
              style={{ color: C.accent, fontSize: 13, textDecoration: "none" }}
            >
              Run your first analysis →
            </Link>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {scans.map((s) => (
              <ScanCard key={s.id} scan={s} />
            ))}
          </div>
        )}
      </div>
    </Frame>
  );
}

function ScanCard({ scan }: { scan: MyScan }) {
  const score =
    scan.audience_fit_score != null ? Math.round(scan.audience_fit_score) : null;
  const tone = score == null ? "faint" : score >= 60 ? "ok" : score >= 40 ? "warn" : "bad";
  const cohort = scan.best_cohort_label ?? scan.best_cohort_id ?? "—";
  return (
    <div
      style={{
        padding: 14,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
      }}
    >
      <Link
        href={`/validator/report/${scan.id}`}
        style={{ display: "block", textDecoration: "none", color: C.text }}
      >
        <div
          style={{
            fontSize: 12,
            color: C.textDim,
            fontFamily: FM,
            marginBottom: 4,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {trimUrl(scan.target_url)}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
          <div
            style={{
              fontSize: 28,
              fontWeight: 600,
              fontFamily: FM,
              color:
                tone === "ok"
                  ? C.ok
                  : tone === "warn"
                    ? C.warn
                    : tone === "bad"
                      ? C.bad
                      : C.textFaint,
            }}
          >
            {score ?? "—"}
          </div>
          <div style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}>
            {scan.mode === "B" ? "VERIFY" : "FIT"} · {scan.status}
          </div>
        </div>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6, lineHeight: 1.4 }}>
          {scan.category && (
            <Pill style={{ marginRight: 6, fontSize: 9 }}>{scan.category}</Pill>
          )}
          Best: {cohort}
          {scan.best_cohort_score != null && ` (${Math.round(scan.best_cohort_score)})`}
        </div>
        <div style={{ fontSize: 10, color: C.textFaint, fontFamily: FM }}>
          {timeAgo(scan.completed_at ?? scan.created_at)} · {scan.personas_completed}p
        </div>
      </Link>
      {scan.payment_solscan && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 8,
            borderTop: `1px solid ${C.border}`,
            fontSize: 10,
            fontFamily: FM,
          }}
        >
          <a
            href={scan.payment_solscan}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: C.accent, textDecoration: "none" }}
          >
            View payment on Solscan →
          </a>
        </div>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "120px 32px",
        textAlign: "center",
        color: C.textDim,
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
}

function trimUrl(u: string): string {
  return u.replace(/^https?:\/\//, "").replace(/\/$/, "").slice(0, 32);
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
