"use client";

// Public homepage — Project RPM site redesign (Claude Design handoff).
//
// Single entry point for both analysis modes (the legacy /validator route
// redirects here):
//   Mode A (Discovery)    URL only       → /validator/detail (sharpening)
//   Mode B (Verification) URL + audience → POST /api/scan → /validator/processing/<id>
//
// Visual language: _pr/ui.tsx (indigo-on-blue Stripe style). The hero matches
// Prototype.dc.html; the live feeds (Live / Top / Recent) below stay wired to
// scanApi — CLAUDE.md forbids hardcoding them.

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { scanApi, type ScanSummary } from "@/lib/api";
import { checkTargetUrl } from "@/lib/url";
import { PR, FD, FB, FM, PrShell, PrButton, PrCard, scoreTone } from "./_pr/ui";

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

  const initialMode: AnalysisMode = searchParams.get("mode") === "B" ? "B" : "A";
  const [mode, setMode] = useState<AnalysisMode>(initialMode);
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
    return () => {
      cancelled = true;
    };
  }, []);

  const onAnalyze = async () => {
    if (submitting) return;
    setError(null);
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      setError("Enter a URL to analyze");
      return;
    }
    const check = checkTargetUrl(trimmedUrl);
    if (!check.ok) {
      setError(
        check.reason === "private_host"
          ? "That looks like an internal or private address — enter a public website."
          : "Enter a valid website URL (http or https).",
      );
      return;
    }
    if (!authenticated) {
      if (!ready) return;
      login();
      return;
    }
    if (mode === "A") {
      router.push(`/validator/detail?url=${encodeURIComponent(check.normalized)}`);
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
        target_url: check.normalized,
        mode: "B",
        target_audience_text: trimmedAudience,
      });
      router.push(`/validator/processing/${scanId}?url=${encodeURIComponent(trimmedUrl)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start verify");
      setSubmitting(false);
    }
  };

  return (
    <PrShell
      right={
        authenticated ? (
          <Link
            href="/console"
            className="pr-link"
            style={{ fontSize: 13, fontWeight: 600, color: PR.dim, textDecoration: "none" }}
          >
            Console →
          </Link>
        ) : (
          <button
            onClick={() => ready && login()}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: PR.dim,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: FB,
            }}
          >
            Sign in
          </button>
        )
      }
    >
      <div className="pr-fade" style={{ maxWidth: 940, margin: "0 auto", padding: "56px 28px 80px" }}>
        {/* ─── Hero ─── */}
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              background: PR.panel,
              border: `1px solid ${PR.border}`,
              borderRadius: 999,
              padding: "5px 13px",
              marginBottom: 20,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: PR.green }} />
            <span style={{ fontSize: 12, color: PR.dim }}>
              112 AI personas · 8 audience cohorts · no traffic needed
            </span>
          </div>

          <h1
            style={{
              fontFamily: FD,
              fontSize: "clamp(34px,6vw,52px)",
              lineHeight: 1.04,
              letterSpacing: "-0.02em",
              margin: "0 0 16px",
              color: PR.ink,
            }}
          >
            {mode === "A" ? (
              <>
                Who&apos;s actually going to <span style={{ color: PR.accent }}>use this?</span>
              </>
            ) : (
              <>
                Verify a <span style={{ color: PR.accent }}>specific audience.</span>
              </>
            )}
          </h1>
          <p
            style={{
              fontSize: 17,
              color: PR.text,
              maxWidth: 460,
              margin: "0 auto 22px",
              lineHeight: 1.5,
            }}
          >
            {mode === "A"
              ? "Paste a link to your site. 112 AI personas try it out and tell you who falls in love — and who quietly leaves."
              : "Tell us who you're targeting. ~50 matching personas run a pass / conditional / fail check."}
          </p>

          {/* Mode toggle */}
          <div
            style={{
              display: "inline-flex",
              gap: 3,
              marginBottom: 18,
              padding: 3,
              background: PR.panelAlt,
              borderRadius: 10,
              border: `1px solid ${PR.border}`,
            }}
          >
            {([
              { id: "A" as const, label: "Discovery" },
              { id: "B" as const, label: "Verify audience" },
            ]).map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setMode(m.id);
                  setError(null);
                }}
                style={{
                  padding: "6px 14px",
                  fontSize: 12.5,
                  borderRadius: 7,
                  background: mode === m.id ? PR.panel : "transparent",
                  color: mode === m.id ? PR.ink : PR.dim,
                  border: mode === m.id ? `1px solid ${PR.borderStrong}` : "1px solid transparent",
                  boxShadow: mode === m.id ? "0 1px 2px rgba(10,37,64,.08)" : "none",
                  cursor: "pointer",
                  fontFamily: FB,
                  fontWeight: mode === m.id ? 600 : 500,
                }}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* URL input */}
          <div
            style={{
              display: "flex",
              maxWidth: 460,
              margin: "0 auto",
              background: PR.panel,
              border: `1.5px solid ${PR.borderStrong}`,
              borderRadius: 14,
              overflow: "hidden",
              padding: 5,
              boxShadow: "0 12px 30px -18px rgba(10,37,64,.32)",
            }}
          >
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onAnalyze();
              }}
              placeholder="yoursite.com"
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                padding: "12px 16px",
                fontSize: 15,
                fontFamily: FB,
                color: PR.ink,
              }}
            />
            <PrButton
              onClick={onAnalyze}
              disabled={submitting || !url.trim()}
              style={{ fontSize: 15, padding: "12px 24px", borderRadius: 10 }}
            >
              {submitting ? "Starting…" : mode === "A" ? "Try it →" : "Verify →"}
            </PrButton>
          </div>

          {mode === "B" && (
            <div
              style={{
                display: "flex",
                maxWidth: 460,
                margin: "10px auto 0",
                background: PR.panel,
                border: `1px solid ${PR.borderStrong}`,
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onAnalyze();
                }}
                placeholder='Target audience — e.g. "30s DeFi expert mobile-first"'
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  padding: "12px 16px",
                  fontSize: 14,
                  fontFamily: FB,
                  color: PR.ink,
                }}
              />
            </div>
          )}

          {error && <div style={{ color: PR.redInk, fontSize: 13, marginTop: 12 }}>{error}</div>}

          <div style={{ fontSize: 12.5, color: PR.faint, marginTop: 12 }}>
            {mode === "A"
              ? "Free to start · about 6 minutes · no test users needed"
              : "~2 min · up to 50 personas · $30 free credit on signup"}
          </div>
        </div>

        {/* ─── Value cards ─── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
            gap: 14,
            marginTop: 48,
          }}
        >
          <ValueCard n="01" title="Works with zero traffic" body="Get audience signal before launch — no visitors required." />
          <ValueCard n="02" title="Works on any URL" body="Yours, a competitor's, or an idea you're sizing up." />
          <ValueCard n="03" title="Checked against real people" body="Real surveys grade the AI — we show where it's right." />
        </div>

        {/* ─── Live Now ─── */}
        {feedsLoaded && live.length > 0 && (
          <div style={{ marginTop: 48 }}>
            <SectionHeader label="LIVE NOW" pulse />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {live.slice(0, 6).map((s) => (
                <LiveChip key={s.id} scan={s} />
              ))}
            </div>
          </div>
        )}

        {/* ─── Top fit ─── */}
        {feedsLoaded && top.length > 0 && (
          <div style={{ marginTop: 40 }}>
            <SectionHeader label="TOP AUDIENCE FIT" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 12 }}>
              {top.map((s, i) => (
                <ScanCard key={s.id} scan={s} rank={i + 1} variant="top" />
              ))}
            </div>
          </div>
        )}

        {/* ─── Recent ─── */}
        <div style={{ marginTop: 40 }}>
          <SectionHeader label="RECENT ANALYSES" />
          {!feedsLoaded ? (
            <div style={{ padding: 40, textAlign: "center", color: PR.faint, fontSize: 13 }}>Loading…</div>
          ) : recent.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: PR.faint, fontSize: 13 }}>
              No analyses yet. Be the first — drop a URL above.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 12 }}>
              {recent.map((s) => (
                <ScanCard key={s.id} scan={s} variant="recent" />
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: 56,
            paddingTop: 20,
            borderTop: `1px solid ${PR.border}`,
            fontSize: 12,
            color: PR.faint,
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <span>41R · find your customers before launch</span>
          <span style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <Link href="/validator/how-it-works" className="pr-link" style={{ color: PR.dim, textDecoration: "none" }}>
              How it works →
            </Link>
            <Link href="/proof" className="pr-link" style={{ color: PR.dim, textDecoration: "none" }}>
              On-chain proof →
            </Link>
          </span>
        </div>
      </div>
    </PrShell>
  );
}

function ValueCard({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <PrCard pad={22} style={{ textAlign: "left" }}>
      <div style={{ fontFamily: FM, fontSize: 11, color: PR.accent, marginBottom: 9 }}>{n}</div>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5, color: PR.ink }}>{title}</div>
      <p style={{ fontSize: 13, color: PR.dim, margin: 0, lineHeight: 1.55 }}>{body}</p>
    </PrCard>
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
        letterSpacing: "0.1em",
        color: PR.faint,
      }}
    >
      {pulse && (
        <span style={{ width: 7, height: 7, borderRadius: 999, background: PR.green }} />
      )}
      {label}
      <div style={{ flex: 1, height: 1, background: PR.border }} />
    </div>
  );
}

function ScanCard({ scan, rank, variant }: { scan: ScanSummary; rank?: number; variant: "top" | "recent" }) {
  const score = scan.audience_fit_score != null ? Math.round(scan.audience_fit_score) : null;
  const cohort = scan.best_cohort_label ?? scan.best_cohort_id ?? "—";
  return (
    <Link
      href={`/validator/report/${scan.id}`}
      style={{
        display: "block",
        textDecoration: "none",
        color: PR.ink,
        background: PR.panel,
        border: `1px solid ${PR.border}`,
        borderRadius: 14,
        padding: 16,
        position: "relative",
      }}
    >
      {variant === "top" && rank != null && (
        <div
          style={{
            position: "absolute",
            top: 12,
            right: 14,
            fontFamily: FM,
            fontSize: 11,
            fontWeight: 700,
            color: rank <= 3 ? PR.accent : PR.faint,
          }}
        >
          #{rank}
        </div>
      )}
      <div
        style={{
          fontSize: 12,
          color: PR.dim,
          fontFamily: FM,
          marginBottom: 6,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {trimUrl(scan.target_url)}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <div style={{ fontFamily: FD, fontSize: 30, fontWeight: 700, color: scoreTone(score) }}>
          {score ?? "—"}
        </div>
        <div style={{ fontSize: 11, color: PR.faint, fontFamily: FM }}>{scan.mode === "B" ? "VERIFY" : "FIT"}</div>
      </div>
      <div style={{ fontSize: 12, color: PR.dim, marginBottom: 6, lineHeight: 1.4 }}>
        {scan.category && (
          <span
            style={{
              fontFamily: FM,
              fontSize: 9,
              background: PR.accentSoft,
              color: PR.accent,
              padding: "2px 7px",
              borderRadius: 999,
              marginRight: 6,
            }}
          >
            {scan.category}
          </span>
        )}
        Best: {cohort}
        {scan.best_cohort_score != null && ` (${Math.round(scan.best_cohort_score)})`}
      </div>
      <div style={{ fontSize: 10, color: PR.faint, fontFamily: FM }}>
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
        background: PR.panel,
        border: `1px solid ${PR.border}`,
        borderRadius: 999,
        fontSize: 11,
        fontFamily: FM,
        color: PR.dim,
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: PR.green }} />
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
