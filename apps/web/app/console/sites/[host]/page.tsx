"use client";

// /console/sites/[host] — site workspace detail (Console Sprint 1).
//
// S1 ships the Overview + Reports tabs (console-ia-redesign.md §7.1):
// hero leads with the BEST-FIT AUDIENCE (who), score second, misfit
// cohort shown too — "who it's NOT for" is also a finding and the
// on-screen version of the honesty contract (§0.4). Analytics +
// Settings tabs land with site_workspaces/keys in Sprint 2-3.
//
// [host] is the normalized URL host (S1 grouping key — see
// hostOf() in ../../page.tsx). Sprint 2 swaps this for a workspace id.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { scanApi, API_BASE, type ScanSummary, type ScanReport } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { C, FM, FS, Frame, Pill } from "../../../validator/_components/ui";
import { hostOf } from "../../_lib";

export default function SiteDetailPage() {
  const params = useParams<{ host: string }>();
  const host = decodeURIComponent(params.host ?? "");
  const { ready, authenticated, login } = usePrivy();
  const { t } = useI18n();

  const [scans, setScans] = useState<ScanSummary[] | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [tab, setTab] = useState<"overview" | "reports">("overview");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    scanApi
      .getMyScans()
      .then(async (mine) => {
        if (cancelled) return;
        const siteScans = mine.scans
          .filter((s) => hostOf(s.target_url) === host)
          .sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          );
        setScans(siteScans);
        const latestCompleted = siteScans.find((s) => s.status === "completed");
        if (latestCompleted) {
          const r = await scanApi.getReport(latestCompleted.id);
          if (!cancelled) setReport(r);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, host]);

  const completedScores = useMemo(
    () =>
      (scans ?? [])
        .filter((s) => s.status === "completed" && s.audience_fit_score != null)
        .map((s) => ({
          at: s.completed_at ?? s.created_at,
          score: s.audience_fit_score!,
        }))
        .reverse(), // oldest → newest for the sparkline
    [scans],
  );

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
          <h1 style={{ fontSize: 24, fontWeight: 600, fontFamily: FS, marginBottom: 14 }}>
            {t("common.signInTitle")}
          </h1>
          <button
            onClick={login}
            style={{
              padding: "10px 22px",
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

  const latest = scans?.find((s) => s.status === "completed") ?? null;
  const delta =
    completedScores.length >= 2
      ? Math.round(
          completedScores[completedScores.length - 1]!.score -
            completedScores[completedScores.length - 2]!.score,
        )
      : null;

  return (
    <Frame>
      <div className="v-page-pad" style={{ maxWidth: 1080, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <Link
            href="/console"
            style={{ fontSize: 12, color: C.textFaint, fontFamily: FM, textDecoration: "none" }}
          >
            ← {t("console.title")}
          </Link>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 26, fontWeight: 600, fontFamily: FM, margin: 0 }}>
            {host}
          </h1>
          {report?.scan.category && <Pill>{report.scan.category}</Pill>}
        </div>
        {report?.scan.one_line_pitch && (
          <div style={{ fontSize: 13, color: C.textDim, marginBottom: 18 }}>
            {report.scan.one_line_pitch}
          </div>
        )}

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            gap: 4,
            borderBottom: `1px solid ${C.border}`,
            marginBottom: 20,
            marginTop: 10,
          }}
        >
          {(["overview", "reports"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                background: "transparent",
                border: "none",
                borderBottom: tab === k ? `2px solid ${C.accent}` : "2px solid transparent",
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: tab === k ? 600 : 400,
                color: tab === k ? C.text : C.textDim,
                cursor: "pointer",
                fontFamily: FS,
              }}
            >
              {t(k === "overview" ? "console.overview" : "console.reports")}
            </button>
          ))}
        </div>

        {error && <div style={{ color: C.bad, fontSize: 13, marginBottom: 14 }}>{error}</div>}

        {scans === null ? (
          <Center>{t("common.loading")}</Center>
        ) : tab === "overview" ? (
          <Overview
            scans={scans}
            latest={latest}
            report={report}
            delta={delta}
            scores={completedScores}
            copied={copied}
            setCopied={setCopied}
          />
        ) : (
          <Reports scans={scans} />
        )}
      </div>
    </Frame>
  );
}

// ─── Overview tab ──────────────────────────────────────────────────
function Overview({
  scans,
  latest,
  report,
  delta,
  scores,
  copied,
  setCopied,
}: {
  scans: ScanSummary[];
  latest: ScanSummary | null;
  report: ScanReport | null;
  delta: number | null;
  scores: { at: string; score: number }[];
  copied: boolean;
  setCopied: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const result = report?.result ?? null;
  const score =
    latest?.audience_fit_score != null ? Math.round(latest.audience_fit_score) : null;
  const tone =
    score == null ? C.textFaint : score >= 60 ? C.ok : score >= 40 ? C.warn : C.bad;

  const copySurveyLink = () => {
    if (!latest) return;
    const url = `${window.location.origin}/validator/survey/${latest.id}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  if (!latest) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: C.textDim, fontSize: 13 }}>
        {t("console.noCompleted")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Hero — who first, score second (§7.1) */}
      <div
        style={{
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 20,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: C.textFaint,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontFamily: FM,
            marginBottom: 10,
          }}
        >
          {t("console.bestFit")}
        </div>
        {result ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 20, fontWeight: 600 }}>
                ✦ {result.best.cohort_label}
              </span>
              <span style={{ fontFamily: FM, fontSize: 15, color: C.ok }}>
                fit {Math.round(result.best.cohort_fit_score)}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ fontSize: 13, color: C.textDim }}>
                ✗ {t("console.misfit")}: {result.worst.cohort_label}
              </span>
              <span style={{ fontFamily: FM, fontSize: 12, color: C.bad }}>
                fit {Math.round(result.worst.cohort_fit_score)}
              </span>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 13, color: C.textDim, marginBottom: 14 }}>
            {t("common.loading")}
          </div>
        )}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            paddingTop: 14,
            borderTop: `1px solid ${C.border}`,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 26, fontWeight: 600, fontFamily: FM, color: tone }}>
            {score ?? "—"}
          </span>
          {delta != null && delta !== 0 && (
            <span style={{ fontSize: 12, fontFamily: FM, color: delta > 0 ? C.ok : C.bad }}>
              {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
            </span>
          )}
          {scores.length >= 2 && <Sparkline points={scores.map((s) => s.score)} />}
          <div style={{ flex: 1 }} />
          <Link
            href={`/validator/detail?url=${encodeURIComponent(latest.target_url)}`}
            style={{
              background: C.accent,
              color: "#fff",
              borderRadius: 7,
              padding: "7px 13px",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            {t("console.rescan")} · $2
          </Link>
        </div>
      </div>

      {/* Survey status */}
      {report && (
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: 16,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 13 }}>
            <b style={{ fontFamily: FM }}>{report.survey_response_count}</b>{" "}
            {t("console.surveyResponses")}
          </span>
          {report.human_aggregate_computed && (
            <Pill tone="ok">{t("console.humanCompared")}</Pill>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={copySurveyLink}
            style={{
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 7,
              padding: "6px 12px",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: FS,
              color: C.text,
            }}
          >
            {copied ? t("console.copied") : t("console.copySurveyLink")}
          </button>
          <Link
            href={`/validator/compare/${latest.id}`}
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 7,
              padding: "6px 12px",
              fontSize: 12,
              textDecoration: "none",
              color: C.text,
            }}
          >
            {t("console.openCompare")} →
          </Link>
        </div>
      )}

      {/* Scan history */}
      <div
        style={{
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          {t("console.scanHistory")}
        </div>
        <ScanTable scans={scans} />
      </div>

      <div style={{ fontSize: 11, color: C.textFaint }}>{t("console.publicNote")}</div>
    </div>
  );
}

// ─── Reports tab ──────────────────────────────────────────────────
function Reports({ scans }: { scans: ScanSummary[] }) {
  const { t } = useI18n();
  const completed = scans.filter((s) => s.status === "completed");
  if (completed.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: C.textDim, fontSize: 13 }}>
        {t("console.noCompleted")}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {completed.map((s) => (
        <div
          key={s.id}
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: 14,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontFamily: FM, fontSize: 12, color: C.textDim }}>
            {fmtDate(s.completed_at ?? s.created_at)}
          </span>
          <Pill>{s.mode === "B" ? "VERIFY" : "FIT"}</Pill>
          <span style={{ fontFamily: FM, fontSize: 15, fontWeight: 600 }}>
            {s.audience_fit_score != null ? Math.round(s.audience_fit_score) : "—"}
          </span>
          <div style={{ flex: 1 }} />
          <Link href={`/validator/report/${s.id}`} style={linkBtn}>
            {t("console.openReport")}
          </Link>
          <Link href={`/validator/compare/${s.id}`} style={linkBtn}>
            {t("console.openCompare")}
          </Link>
          <a
            href={`${API_BASE}/api/scan/${s.id}/report.md`}
            target="_blank"
            rel="noopener noreferrer"
            style={linkBtn}
          >
            {t("console.shareMd")} ↗
          </a>
        </div>
      ))}
      <div style={{ fontSize: 11, color: C.textFaint }}>{t("console.publicNote")}</div>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  border: `1px solid ${C.border}`,
  borderRadius: 7,
  padding: "5px 11px",
  fontSize: 12,
  textDecoration: "none",
  color: C.text,
};

// ─── Pieces ────────────────────────────────────────────────────────
function ScanTable({ scans }: { scans: ScanSummary[] }) {
  const { t } = useI18n();
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: "left", color: C.textFaint, fontFamily: FM, fontSize: 10 }}>
            <th style={th}>{t("console.date")}</th>
            <th style={th}>{t("console.mode")}</th>
            <th style={th}>{t("console.score")}</th>
            <th style={th}>{t("console.personas")}</th>
            <th style={th}>{t("console.status")}</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {scans.map((s) => (
            <tr key={s.id} style={{ borderTop: `1px solid ${C.border}` }}>
              <td style={td}>
                <span style={{ fontFamily: FM }}>
                  {fmtDate(s.completed_at ?? s.created_at)}
                </span>
              </td>
              <td style={td}>{s.mode}</td>
              <td style={{ ...td, fontFamily: FM, fontWeight: 600 }}>
                {s.audience_fit_score != null ? Math.round(s.audience_fit_score) : "—"}
              </td>
              <td style={{ ...td, fontFamily: FM }}>{s.personas_completed}</td>
              <td style={td}>
                <Pill
                  tone={
                    s.status === "completed" ? "ok" : s.status === "failed" ? "bad" : "warn"
                  }
                  style={{ fontSize: 10 }}
                >
                  {s.status}
                </Pill>
              </td>
              <td style={{ ...td, textAlign: "right" }}>
                {s.status === "completed" ? (
                  <Link
                    href={`/validator/report/${s.id}`}
                    style={{ color: C.accent, textDecoration: "none", fontSize: 12 }}
                  >
                    {t("console.openReport")} →
                  </Link>
                ) : s.status === "failed" ? null : (
                  <Link
                    href={`/validator/processing/${s.id}`}
                    style={{ color: C.textDim, textDecoration: "none", fontSize: 12 }}
                  >
                    …
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "6px 8px",
  fontWeight: 500,
  letterSpacing: "0.06em",
};
const td: React.CSSProperties = { padding: "9px 8px", color: C.text };

function Sparkline({ points }: { points: number[] }) {
  const W = 96;
  const H = 28;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * (W - 4) + 2;
  const y = (v: number) => H - 4 - ((v - min) / span) * (H - 8);
  const d = points.map((p, i) => `${i ? "L" : "M"} ${x(i)} ${y(p)}`).join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <path d={d} stroke={C.accent} strokeWidth={1.5} fill="none" strokeLinejoin="round" />
      <circle
        cx={x(points.length - 1)}
        cy={y(points[points.length - 1]!)}
        r={2.5}
        fill={C.accent}
      />
    </svg>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
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
