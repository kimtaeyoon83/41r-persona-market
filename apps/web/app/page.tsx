"use client";

// Public homepage — Phase 2 §8.1 / P2-4 + Phase 4 IA cleanup.
//
// Single entry point for both analysis modes (the legacy /validator
// route now redirects here):
//   Mode A (Discovery)    URL only       → /validator/detail (sharpening)
//   Mode B (Verification) URL + audience → POST /api/scan → /validator/processing/<id>
//
// Three live feeds fill the body: Live Now / Top PMF / Recent.

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { scanApi, type ScanSummary } from "@/lib/api";
import { performSponsoredPayment } from "@/lib/sponsored-payment";
import { C, FM, FS, Frame, Pill } from "./validator/_components/ui";

type AnalysisMode = "A" | "B";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { ready, authenticated, login } = usePrivy();
  // Mode B sponsored-payment plumbing — same hooks Mode A's
  // /validator/detail uses. Without these, Verify flow created scans
  // without signing the sponsored 0 USDC tx and produced no Solscan
  // receipt or userId-claim. Helper at lib/sponsored-payment.ts.
  const { signTransaction } = useSignTransaction();
  const { wallets: solanaWallets } = useSolanaWallets();

  // Initial mode honours `?mode=B` (used by the /validator redirect
  // and any legacy "Verify Mode B" links).
  const initialMode: AnalysisMode = searchParams.get("mode") === "B" ? "B" : "A";
  const [mode, setMode] = useState<AnalysisMode>(initialMode);
  // `?url=...` prefill — used by the Report page's Re-run button so a
  // viewer can re-analyze the same target without retyping it.
  const [url, setUrl] = useState(searchParams.get("url") ?? "");
  const [audience, setAudience] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recent, setRecent] = useState<ScanSummary[]>([]);
  const [top, setTop] = useState<ScanSummary[]>([]);
  const [live, setLive] = useState<ScanSummary[]>([]);
  const [feedsLoaded, setFeedsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      scanApi.getRecent().catch(() => ({ scans: [] })),
      scanApi.getTop().catch(() => ({ scans: [] })),
      scanApi.getLive().catch(() => ({ scans: [] })),
    ]).then(([r, t, l]) => {
      if (cancelled) return;
      setRecent(r.scans);
      setTop(t.scans);
      setLive(l.scans);
      setFeedsLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const onAnalyze = async () => {
    if (submitting) return;
    setError(null);
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError("Enter a URL to analyze");
      return;
    }
    if (!authenticated) {
      if (!ready) return;
      login();
      return;
    }
    if (mode === "A") {
      router.push(`/validator/detail?url=${encodeURIComponent(trimmedUrl)}`);
      return;
    }
    const trimmedAudience = audience.trim();
    if (!trimmedAudience) {
      setError("Audience is required for Verify mode");
      return;
    }
    setSubmitting(true);
    try {
      const { scanId } = await scanApi.createScan({
        target_url: trimmedUrl,
        mode: "B",
        target_audience_text: trimmedAudience,
      });
      // Sponsored 0 USDC tx — same flow as Mode A's /validator/detail.
      // Helper returns ok / skipped / error; we surface the message
      // but never abort the scan (server-side worker is decoupled).
      const payment = await performSponsoredPayment({
        scanId,
        authenticated,
        wallet: solanaWallets[0],
        signTransaction,
      });
      if (payment.kind === "error") {
        setError(`Payment skipped: ${payment.message}`);
      }
      router.push(
        `/validator/processing/${scanId}?url=${encodeURIComponent(trimmedUrl)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start verify");
      setSubmitting(false);
    }
  };

  return (
    <Frame active="discovery">
      <div
        style={{
          padding: "clamp(32px, 6vw, 60px) clamp(16px, 4vw, 32px) 80px",
          maxWidth: 1080,
          margin: "0 auto",
        }}
      >
        {/* ─── Hero ─── */}
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <div
            style={{
              fontSize: 12,
              fontFamily: FM,
              color: C.textFaint,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            41R Audience-Fit Validator
          </div>
          <h1
            style={{
              fontSize: "clamp(26px, 6vw, 44px)",
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: "-0.025em",
              margin: 0,
              marginBottom: 14,
              color: C.text,
              fontFamily: FS,
            }}
          >
            {mode === "A" ? (
              <>
                See how your audience{" "}
                <span style={{ color: C.accent }}>actually reacts</span>.
              </>
            ) : (
              <>
                Verify a <span style={{ color: C.accent }}>specific audience</span>.
              </>
            )}
          </h1>
          <div
            style={{
              fontSize: "clamp(13px, 3vw, 15px)",
              color: C.textDim,
              marginBottom: 8,
              lineHeight: 1.55,
              padding: "0 8px",
            }}
          >
            {mode === "A"
              ? "112 representative personas across 8 cohorts react to your site. Cohort fit · 5-dimension breakdown · friction map · cohort × dimension matrix."
              : "Tell us who you're targeting. ~50 matching personas run a pass/conditional/fail check."}
          </div>
          <div
            style={{
              fontSize: 11,
              color: C.textFaint,
              marginBottom: 22,
              lineHeight: 1.55,
              padding: "0 8px",
              fontFamily: FM,
            }}
          >
            {mode === "A"
              ? "Audience research panel — not a traffic predictor."
              : ""}
          </div>

          {/* Mode toggle */}
          <div
            style={{
              display: "inline-flex",
              gap: 4,
              marginBottom: 22,
              padding: 4,
              background: "#f3f0e8",
              borderRadius: 999,
              border: `1px solid ${C.border}`,
            }}
          >
            {(
              [
                { id: "A" as const, label: "Discovery" },
                { id: "B" as const, label: "Verify audience" },
              ]
            ).map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setMode(m.id);
                  setError(null);
                }}
                style={{
                  padding: "6px 14px",
                  fontSize: 12,
                  borderRadius: 999,
                  background: mode === m.id ? C.panel : "transparent",
                  color: mode === m.id ? C.text : C.textDim,
                  border:
                    mode === m.id
                      ? `1px solid ${C.borderStrong}`
                      : "1px solid transparent",
                  cursor: "pointer",
                  fontFamily: FS,
                  fontWeight: mode === m.id ? 600 : 400,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              gap: 0,
              maxWidth: 520,
              margin: "0 auto",
              border: `1.5px solid ${C.borderStrong}`,
              borderRadius: 999,
              overflow: "hidden",
              background: C.panel,
            }}
          >
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onAnalyze(); }}
              placeholder="yoursite.com"
              style={{
                flex: 1,
                padding: "14px 22px",
                fontSize: 14,
                fontFamily: FS,
                background: "transparent",
                border: "none",
                outline: "none",
                color: C.text,
              }}
            />
            <button
              onClick={onAnalyze}
              disabled={submitting || !url.trim()}
              style={{
                padding: "14px 24px",
                fontSize: 13,
                fontWeight: 600,
                background: submitting || !url.trim() ? C.textFaint : C.text,
                color: C.bg,
                border: "none",
                cursor: submitting || !url.trim() ? "not-allowed" : "pointer",
                fontFamily: FS,
                whiteSpace: "nowrap",
              }}
            >
              {submitting ? "Starting…" : mode === "A" ? "Analyze →" : "Verify →"}
            </button>
          </div>

          {mode === "B" && (
            <div
              style={{
                display: "flex",
                maxWidth: 520,
                margin: "10px auto 0",
                border: `1.5px solid ${C.borderStrong}`,
                borderRadius: 999,
                overflow: "hidden",
                background: C.panel,
              }}
            >
              <input
                type="text"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onAnalyze(); }}
                placeholder='Target audience — e.g. "30s DeFi expert mobile-first"'
                style={{
                  flex: 1,
                  padding: "12px 22px",
                  fontSize: 13,
                  fontFamily: FS,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: C.text,
                }}
              />
            </div>
          )}

          {error && (
            <div style={{ color: C.bad, fontSize: 12, marginTop: 12 }}>{error}</div>
          )}

          <div
            style={{
              marginTop: 14,
              fontSize: 11,
              color: C.textFaint,
              fontFamily: FM,
            }}
          >
            {mode === "A"
              ? "Free during beta · ~6 min · 113 personas across 8 cohorts"
              : "Free during beta · ~2 min · up to 50 personas matching audience"}
          </div>
        </div>

        {/* ─── Live Now ─── */}
        {feedsLoaded && live.length > 0 && (
          <div style={{ marginBottom: 40 }}>
            <SectionHeader label="LIVE NOW" pulse />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {live.slice(0, 6).map((s) => (
                <LiveChip key={s.id} scan={s} />
              ))}
            </div>
          </div>
        )}

        {/* ─── Top PMF Leaderboard ─── */}
        {feedsLoaded && top.length > 0 && (
          <div style={{ marginBottom: 48 }}>
            <SectionHeader label="TOP PMF · LEADERBOARD" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {top.map((s, i) => (
                <ScanCard key={s.id} scan={s} rank={i + 1} variant="top" />
              ))}
            </div>
          </div>
        )}

        {/* ─── Recent Analyses ─── */}
        <div>
          <SectionHeader label="RECENT ANALYSES" />
          {!feedsLoaded ? (
            <div style={{ padding: 40, textAlign: "center", color: C.textDim, fontSize: 13 }}>
              Loading…
            </div>
          ) : recent.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: C.textDim, fontSize: 13 }}>
              No analyses yet. Be the first — drop a URL above.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
              {recent.map((s) => (
                <ScanCard key={s.id} scan={s} variant="recent" />
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 56,
            padding: "20px 0",
            borderTop: `1px solid ${C.border}`,
            fontSize: 11,
            color: C.textFaint,
            fontFamily: FM,
            display: "flex",
            justifyContent: "space-between",
          }}
        >
          <span>41R · Devnet · Phase 4 Internal Testing</span>
          <span style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Link
              href="/validator/how-it-works"
              style={{ color: C.textDim, textDecoration: "none" }}
            >
              How it works →
            </Link>
            {authenticated && (
              <Link
                href="/me/analyses"
                style={{ color: C.textDim, textDecoration: "none" }}
              >
                My Analyses →
              </Link>
            )}
          </span>
        </div>
      </div>
    </Frame>
  );
}

function SectionHeader({ label, pulse }: { label: string; pulse?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 14,
        fontSize: 11,
        fontFamily: FM,
        letterSpacing: "0.12em",
        color: C.textDim,
      }}
    >
      {pulse && (
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 999,
            background: C.bad,
            animation: "pulse 1.6s ease-in-out infinite",
          }}
        />
      )}
      {label}
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}

function ScanCard({
  scan,
  rank,
  variant,
}: {
  scan: ScanSummary;
  rank?: number;
  variant: "top" | "recent";
}) {
  const score = scan.audience_fit_score != null ? Math.round(scan.audience_fit_score) : null;
  const tone =
    score == null ? "faint" : score >= 60 ? "ok" : score >= 40 ? "warn" : "bad";
  const cohort = scan.best_cohort_label ?? scan.best_cohort_id ?? "—";

  return (
    <Link
      href={`/validator/report/${scan.id}`}
      style={{
        display: "block",
        padding: 14,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        textDecoration: "none",
        color: C.text,
        position: "relative",
      }}
    >
      {variant === "top" && rank != null && (
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            fontSize: 11,
            fontFamily: FM,
            color: rank <= 3 ? C.accent : C.textFaint,
            fontWeight: 600,
          }}
        >
          #{rank}
        </div>
      )}
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
              tone === "ok" ? C.ok : tone === "warn" ? C.warn : tone === "bad" ? C.bad : C.textFaint,
          }}
        >
          {score ?? "—"}
        </div>
        <div style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}>
          {scan.mode === "B" ? "VERIFY" : "FIT"}
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
  );
}

function LiveChip({ scan }: { scan: ScanSummary }) {
  return (
    <Link
      href={`/validator/processing/${scan.id}`}
      style={{
        padding: "6px 12px",
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 999,
        fontSize: 11,
        fontFamily: FM,
        color: C.textDim,
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: C.bad,
          animation: "pulse 1.4s ease-in-out infinite",
        }}
      />
      {trimUrl(scan.target_url)} · {scan.status}
    </Link>
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
