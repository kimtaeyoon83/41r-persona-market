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
            41R · AI Persona Audience Discovery
          </div>
          <h1
            style={{
              fontSize: "clamp(30px, 6.5vw, 54px)",
              fontWeight: 650,
              lineHeight: 1.12,
              letterSpacing: "-0.03em",
              margin: 0,
              marginBottom: 16,
              color: C.text,
              fontFamily: FS,
            }}
          >
            {mode === "A" ? (
              <>
                Find your{" "}
                <span className="e-hero-accent" style={{ color: C.accent }}>
                  customers
                </span>{" "}
                — before launch.
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
              ? "Drop a URL. 112 AI personas react to it and tell you who your product is for — your best-fit audience, who bounces, and why. No traffic, no test users needed."
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
              ? "Audience research panel — not a traffic predictor. Predictions are calibrated against real surveys and visitors."
              : ""}
          </div>

          {/* Mode toggle — squared segmented control (instrument look) */}
          <div
            style={{
              display: "inline-flex",
              gap: 4,
              marginBottom: 22,
              padding: 4,
              background: "#eef0f2",
              borderRadius: 9,
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
                  borderRadius: 6,
                  background: mode === m.id ? C.panel : "transparent",
                  color: mode === m.id ? C.text : C.textDim,
                  border:
                    mode === m.id
                      ? `1px solid ${C.borderStrong}`
                      : "1px solid transparent",
                  boxShadow: mode === m.id ? "0 1px 2px rgba(21,23,27,0.06)" : "none",
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
              maxWidth: 560,
              margin: "0 auto",
              border: `1px solid ${C.borderStrong}`,
              borderRadius: 12,
              overflow: "hidden",
              background: C.panel,
              boxShadow:
                "0 10px 30px -12px rgba(21, 23, 27, 0.18), 0 2px 6px rgba(21, 23, 27, 0.05)",
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
              className="e-cta"
              style={{
                padding: "14px 26px",
                fontSize: 13,
                fontWeight: 600,
                background: submitting || !url.trim() ? C.textFaint : C.accent,
                color: "#fff",
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
                maxWidth: 560,
                margin: "10px auto 0",
                border: `1px solid ${C.borderStrong}`,
                borderRadius: 12,
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
              ? "~6 min · 112 personas across 8 cohorts · $30 free credit on signup ≈ 15 analyses"
              : "~2 min · up to 50 personas matching audience · $30 free credit on signup"}
          </div>
        </div>

        {/* ─── Why 41R (vs GA / user-testing panels — §0.3 fights we win) ─── */}
        <div
          className="v-grid-stack-sm"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
            marginBottom: 48,
          }}
        >
          <ValueCard
            n="01"
            title="Works with zero traffic"
            body="Analytics needs visitors. 41R's persona panel reacts to your page itself — get audience-fit signal pre-launch, pre-marketing."
          />
          <ValueCard
            n="02"
            title="Works on any URL"
            body="Yours, a competitor's, an idea you're sizing up. If it has a URL, you can see who it resonates with."
          />
          <ValueCard
            n="03"
            title="Predictions meet reality"
            body="Share a survey, install the tracking snippet — every real response calibrates the personas. We show you where they're right and wrong."
          />
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
            <SectionHeader label="TOP AUDIENCE FIT · LEADERBOARD" />
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
          <span>41R · find your customers before launch</span>
          <span style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Link
              href="/validator/how-it-works"
              style={{ color: C.textDim, textDecoration: "none" }}
            >
              How it works — no black box →
            </Link>
            {authenticated && (
              <Link
                href="/console"
                style={{ color: C.textDim, textDecoration: "none" }}
              >
                Console →
              </Link>
            )}
          </span>
        </div>
      </div>
    </Frame>
  );
}

function ValueCard({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div
      className="e-card"
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 20,
        textAlign: "left",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontFamily: FM,
          color: C.accent,
          letterSpacing: "0.1em",
          marginBottom: 8,
        }}
      >
        {n}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.65 }}>{body}</div>
    </div>
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
      className="e-card"
      style={{
        display: "block",
        padding: 16,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
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
