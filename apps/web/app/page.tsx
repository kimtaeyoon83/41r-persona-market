"use client";

// Public homepage — Phase 2 §8.1 / P2-4.
//
// Anyone (no login) lands here. Three feeds populate the page:
//   - Recent Analyses (last 20 completed)
//   - Top PMF leaderboard (10 by audience_fit_score)
//   - Live Now (in-flight scans)
// Hero: URL input → Analyze button → /validator/detail (Mode A).

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { scanApi, type ScanSummary } from "@/lib/api";
import { C, FM, FS, Frame, Pill } from "./validator/_components/ui";

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState("yoursite.com");
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

  const onAnalyze = () => {
    if (!url.trim()) return;
    setError(null);
    router.push(`/validator/detail?url=${encodeURIComponent(url.trim())}`);
  };

  return (
    <Frame active="discovery">
      <div style={{ padding: "60px 32px 80px", maxWidth: 1080, margin: "0 auto" }}>
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
              fontSize: 44,
              fontWeight: 600,
              lineHeight: 1.15,
              letterSpacing: "-0.025em",
              margin: 0,
              marginBottom: 14,
              color: C.text,
              fontFamily: FS,
            }}
          >
            Find your audience fit in <span style={{ color: C.accent }}>5 minutes</span>.
          </h1>
          <div
            style={{
              fontSize: 15,
              color: C.textDim,
              marginBottom: 28,
              lineHeight: 1.55,
            }}
          >
            Drop a URL. 800 AI personas across 8 cohorts react. You get an audience-fit score,
            <br />
            cohort × dimension breakdown, and a friction map within minutes.
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
              disabled={!url.trim()}
              style={{
                padding: "14px 24px",
                fontSize: 13,
                fontWeight: 600,
                background: C.text,
                color: C.bg,
                border: "none",
                cursor: "pointer",
                fontFamily: FS,
              }}
            >
              Analyze →
            </button>
          </div>

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
            Free during beta · No login · Public results
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
          <span>41R · Devnet · Phase 2 Internal Testing</span>
          <Link href="/validator" style={{ color: C.textDim, textDecoration: "none" }}>
            Verify a specific audience (Mode B) →
          </Link>
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
