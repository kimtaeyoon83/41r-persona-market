"use client";

// /console/sites/[id] — site workspace detail (Console Sprint 2).
//
// S2 swaps the S1 host-grouping param for the workspace id and adds
// the Settings tab (keys / snippet / rotate / delete). Overview keeps
// the §7.1 hero order: best-fit audience first, score second, misfit
// line visible — the on-screen honesty contract (§0.4). The Analytics
// tab (measured KPIs + combined view) lands in Sprint 3.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import {
  consoleApi,
  scanApi,
  API_BASE,
  type ConsoleSite,
  type ScanSummary,
  type ScanReport,
  type SiteAnalytics,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { C, FM, FS, Frame, Pill } from "../../../validator/_components/ui";

type Tab = "overview" | "reports" | "analytics" | "settings";

export default function SiteDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const router = useRouter();
  const { ready, authenticated, login } = useAuth();
  const { t } = useI18n();

  const [site, setSite] = useState<ConsoleSite | null>(null);
  const [scans, setScans] = useState<ScanSummary[] | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await consoleApi.getSite(id);
    setSite(res.workspace);
    setScans(res.scans);
    const latestCompleted = res.scans.find((s) => s.status === "completed");
    if (latestCompleted) {
      const r = await scanApi.getReport(latestCompleted.id);
      setReport(r);
    }
  }, [id]);

  useEffect(() => {
    if (!ready || !authenticated || !id) return;
    let cancelled = false;
    load().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
    });
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, id, load]);

  const completedScores = useMemo(
    () =>
      (scans ?? [])
        .filter((s) => s.status === "completed" && s.audience_fit_score != null)
        .map((s) => s.audience_fit_score!)
        .reverse(),
    [scans],
  );

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1600);
    });
  };

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
          completedScores[completedScores.length - 1]! -
            completedScores[completedScores.length - 2]!,
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
            {site?.url_host ?? "…"}
          </h1>
          {site && (
            <Pill tone={site.tracked ? "ok" : "neutral"} style={{ fontSize: 9 }}>
              {site.tracked ? "● TRACKED" : "○ LITE"}
            </Pill>
          )}
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
          {(["overview", "reports", "analytics", "settings"] as const).map((k) => (
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
              {t(
                k === "overview"
                  ? "console.overview"
                  : k === "reports"
                    ? "console.reports"
                    : k === "analytics"
                      ? "console.analytics"
                      : "console.settings",
              )}
            </button>
          ))}
        </div>

        {error && <div style={{ color: C.bad, fontSize: 13, marginBottom: 14 }}>{error}</div>}

        {scans === null || site === null ? (
          <Center>{t("common.loading")}</Center>
        ) : tab === "overview" ? (
          <Overview
            scans={scans}
            latest={latest}
            report={report}
            delta={delta}
            scores={completedScores}
            copied={copied === "survey"}
            onCopySurvey={() =>
              latest && copy(`${window.location.origin}/validator/survey/${latest.id}`, "survey")
            }
          />
        ) : tab === "reports" ? (
          <Reports scans={scans} />
        ) : tab === "analytics" ? (
          <Analytics site={site} report={report} />
        ) : (
          <Settings site={site} copied={copied} copy={copy} onChanged={load} router={router} />
        )}
      </div>
    </Frame>
  );
}

// ─── Overview tab (S1 layout, workspace-fed) ───────────────────────
function Overview({
  scans,
  latest,
  report,
  delta,
  scores,
  copied,
  onCopySurvey,
}: {
  scans: ScanSummary[];
  latest: ScanSummary | null;
  report: ScanReport | null;
  delta: number | null;
  scores: number[];
  copied: boolean;
  onCopySurvey: () => void;
}) {
  const { t } = useI18n();
  const result = report?.result ?? null;
  const score =
    latest?.audience_fit_score != null ? Math.round(latest.audience_fit_score) : null;
  const tone =
    score == null ? C.textFaint : score >= 60 ? C.ok : score >= 40 ? C.warn : C.bad;

  if (!latest) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: C.textDim, fontSize: 13 }}>
        {t("console.noCompleted")}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
          {scores.length >= 2 && <Sparkline points={scores} />}
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
            onClick={onCopySurvey}
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

// ─── Analytics tab (S3 — the TRACKED tier's value) ─────────────────
// TRACKED: measured KPIs + daily trend + page ranking + the combined
// "prediction vs reality" card (MEASURED ↔ AI experimental ↔ human
// survey — the flywheel made visible, §0.2). LITE: upsell card framed
// as "verify the prediction", never "replace your analytics" (§1.2 —
// tracking is a calibration device, not the product).
function Analytics({ site, report }: { site: ConsoleSite; report: ScanReport | null }) {
  const { t } = useI18n();
  const [days, setDays] = useState<7 | 30>(7);
  const [data, setData] = useState<SiteAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!site.tracked) return;
    let cancelled = false;
    consoleApi
      .getAnalytics(site.id, days)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed");
      });
    return () => {
      cancelled = true;
    };
  }, [site.id, site.tracked, days]);

  if (!site.tracked) {
    const snippet = `<script src="${API_BASE}/api/partner/t.js" data-site="${site.site_key}" async></script>`;
    return (
      <div
        style={{
          background: C.panel,
          border: `1px dashed ${C.border}`,
          borderRadius: 10,
          padding: "36px 28px",
          textAlign: "center",
          maxWidth: 640,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
          {t("console.liteUpsellTitle")}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: C.textDim,
            lineHeight: 1.7,
            maxWidth: 460,
            margin: "0 auto 16px",
          }}
        >
          {t("console.liteUpsellBody")}
        </div>
        <code
          style={{
            display: "block",
            fontFamily: FM,
            fontSize: 11,
            background: "#f7f4ec",
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            padding: "10px 12px",
            wordBreak: "break-all",
            textAlign: "left",
          }}
        >
          {snippet}
        </code>
      </div>
    );
  }

  if (error) return <div style={{ color: C.bad, fontSize: 13 }}>{error}</div>;
  if (!data) return <Center>{t("common.loading")}</Center>;

  const aiActivation = report?.aarrr_weighted?.stages.find(
    (s) => s.key === "activation",
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Period + usage */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {([7, 30] as const).map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            style={{
              background: days === d ? C.text : "transparent",
              color: days === d ? C.bg : C.textDim,
              border: `1px solid ${C.border}`,
              borderRadius: 999,
              padding: "4px 12px",
              fontSize: 11,
              fontFamily: FM,
              cursor: "pointer",
            }}
          >
            {d}d
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}>
          {t("console.monthlyEvents")}: {data.events_this_month.toLocaleString()} /{" "}
          {data.monthly_soft_cap.toLocaleString()}
        </span>
      </div>

      {/* KPI strip */}
      <div
        className="v-grid-stack-sm"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
        }}
      >
        <Kpi label={t("console.visitors")} value={data.kpis.visitors.toLocaleString()} />
        <Kpi label={t("console.sessions")} value={data.kpis.sessions.toLocaleString()} />
        <Kpi label={t("console.pageviews")} value={data.kpis.pageviews.toLocaleString()} />
        <Kpi label={t("console.avgDwell")} value={fmtMs(data.kpis.avg_dwell_ms)} />
      </div>

      {/* Daily trend */}
      {data.daily.length > 0 ? (
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: 16,
          }}
        >
          <DailyBars daily={data.daily} />
        </div>
      ) : (
        <div style={{ padding: 24, textAlign: "center", color: C.textDim, fontSize: 12 }}>
          {t("console.noAnalytics")}
        </div>
      )}

      {/* Page ranking */}
      {data.paths.length > 0 && (
        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 10,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            {t("console.topPages")}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr
                  style={{
                    textAlign: "left",
                    color: C.textFaint,
                    fontFamily: FM,
                    fontSize: 10,
                  }}
                >
                  <th style={th}>PATH</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("console.viewsCol")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("console.avgDwell")}</th>
                  <th style={{ ...th, textAlign: "right" }}>{t("console.scrollCol")}</th>
                </tr>
              </thead>
              <tbody>
                {data.paths.map((p) => (
                  <tr key={p.path} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ ...td, fontFamily: FM, fontSize: 11 }}>{p.path}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: FM }}>{p.views}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: FM }}>
                      {fmtMs(p.avg_dwell_ms)}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontFamily: FM }}>
                      {p.avg_scroll_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Combined view — prediction vs reality (§0.2 flywheel on screen) */}
      <div
        style={{
          background: C.panel,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
          {t("console.combined")}
        </div>
        <div
          className="v-grid-stack-sm"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 10,
          }}
        >
          <CombinedCol
            label={t("console.measuredLabel")}
            tone={C.ok}
            rows={[
              [t("console.visitors"), data.kpis.visitors.toLocaleString()],
              [t("console.sessions"), data.kpis.sessions.toLocaleString()],
              [t("console.avgDwell"), fmtMs(data.kpis.avg_dwell_ms)],
            ]}
          />
          <CombinedCol
            label={t("console.aiLabel")}
            tone={C.exp}
            rows={[
              [
                "Audience fit",
                report?.result?.audience_fit_score != null
                  ? String(Math.round(report.result.audience_fit_score))
                  : "—",
              ],
              [
                "Activation",
                aiActivation ? `${Math.round(aiActivation.score)}%` : "—",
              ],
              [
                "Best fit",
                report?.result?.best.cohort_label ?? "—",
              ],
            ]}
          />
          <CombinedCol
            label={t("console.humanLabel")}
            tone={C.accent}
            rows={[
              [
                t("console.surveyResponses"),
                String(report?.survey_response_count ?? 0),
              ],
              [
                t("console.humanCompared"),
                report?.human_aggregate_computed ? "✓" : "—",
              ],
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: C.textFaint,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontFamily: FM,
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, fontFamily: FM }}>{value}</div>
    </div>
  );
}

function CombinedCol({
  label,
  tone,
  rows,
}: {
  label: string;
  tone: string;
  rows: Array<[string, string]>;
}) {
  return (
    <div
      style={{
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontFamily: FM,
          fontWeight: 600,
          color: tone,
          letterSpacing: "0.06em",
          marginBottom: 10,
          lineHeight: 1.5,
        }}
      >
        {label}
      </div>
      {rows.map(([k, v]) => (
        <div
          key={k}
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 8,
            fontSize: 12,
            padding: "3px 0",
          }}
        >
          <span style={{ color: C.textDim }}>{k}</span>
          <span style={{ fontFamily: FM, fontWeight: 600 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

function DailyBars({ daily }: { daily: Array<{ day: string; pageviews: number }> }) {
  const W = 640;
  const H = 120;
  const max = Math.max(...daily.map((d) => d.pageviews), 1);
  const bw = Math.min(36, (W - 8) / daily.length - 4);
  return (
    <svg
      viewBox={`0 0 ${W} ${H + 18}`}
      style={{ display: "block", width: "100%", maxWidth: W, height: "auto" }}
    >
      {daily.map((d, i) => {
        const h = Math.max(2, (d.pageviews / max) * H);
        const x = 4 + i * (bw + 4);
        return (
          <g key={d.day}>
            <rect x={x} y={H - h} width={bw} height={h} rx={3} fill={C.accentSoft} stroke={C.accent} strokeWidth={1} />
            <text x={x + bw / 2} y={H + 13} fontSize={8} fontFamily={FM} fill={C.textFaint} textAnchor="middle">
              {d.day.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── Settings tab (S2) ─────────────────────────────────────────────
function Settings({
  site,
  copied,
  copy,
  onChanged,
  router,
}: {
  site: ConsoleSite;
  copied: string | null;
  copy: (text: string, key: string) => void;
  onChanged: () => Promise<void>;
  router: ReturnType<typeof useRouter>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(site.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [rotated, setRotated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const snippet = `<script src="${API_BASE}/api/partner/t.js" data-site="${site.site_key}" async></script>`;

  const saveName = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await consoleApi.updateSite(site.id, { name: name || null });
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      await onChanged();
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    if (busy) return;
    if (!window.confirm(t("console.rotateConfirm"))) return;
    setBusy(true);
    try {
      const res = await consoleApi.rotateKey(site.id);
      setRotated(res.secret);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    if (!window.confirm(t("console.deleteConfirm"))) return;
    setBusy(true);
    try {
      await consoleApi.deleteSite(site.id);
      router.push("/console");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 720 }}>
      {/* Name */}
      <SettingsCard title={t("console.siteName")}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              flex: 1,
              minWidth: 200,
              padding: "9px 12px",
              fontSize: 13,
              border: `1px solid ${C.border}`,
              borderRadius: 7,
              background: "#fff",
              color: C.text,
              outline: "none",
              fontFamily: FS,
            }}
          />
          <button onClick={saveName} style={btnGhost} disabled={saving}>
            {saved ? t("console.saved") : t("console.save")}
          </button>
        </div>
      </SettingsCard>

      {/* Site key */}
      <SettingsCard title={t("console.siteKeyLabel")}>
        <CodeRow
          code={site.site_key}
          action={
            <button onClick={() => copy(site.site_key, "sitekey")} style={btnGhost}>
              {copied === "sitekey" ? t("console.copied") : t("console.copy")}
            </button>
          }
        />
      </SettingsCard>

      {/* Secret */}
      <SettingsCard title={t("console.secretLabel")}>
        {rotated ? (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.warn, marginBottom: 8 }}>
              {t("console.secretOnce")}
            </div>
            <CodeRow
              code={rotated}
              action={
                <button onClick={() => copy(rotated, "secret")} style={btnGhost}>
                  {copied === "secret" ? t("console.copiedSecret") : t("console.copy")}
                </button>
              }
            />
          </>
        ) : (
          <CodeRow
            code={`rpm_sk_…${site.secret_last4}`}
            action={
              <button onClick={rotate} style={btnGhost} disabled={busy}>
                {t("console.rotate")}
              </button>
            }
          />
        )}
      </SettingsCard>

      {/* Snippet */}
      <SettingsCard title={t("console.snippetLabel")} sub={t("console.snippetHelp")}>
        <CodeRow
          code={snippet}
          small
          action={
            <button onClick={() => copy(snippet, "snippet")} style={btnGhost}>
              {copied === "snippet" ? t("console.copied") : t("console.copy")}
            </button>
          }
        />
        <div style={{ fontSize: 11, color: C.textFaint, marginTop: 8, fontFamily: FM }}>
          {t("console.lastEvent")}:{" "}
          {site.last_event_at ? timeAgo(site.last_event_at) : t("console.noEvents")}
        </div>
      </SettingsCard>

      {/* Danger zone */}
      <div
        style={{
          border: `1px solid #eccac4`,
          borderRadius: 10,
          padding: 16,
          background: C.panel,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, fontSize: 12, color: C.textDim }}>
          {t("console.deleteConfirm")}
        </div>
        <button
          onClick={remove}
          disabled={busy}
          style={{
            background: "transparent",
            border: `1px solid #eccac4`,
            color: C.bad,
            borderRadius: 7,
            padding: "7px 13px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: FS,
          }}
        >
          {t("console.deleteSite")}
        </button>
      </div>
    </div>
  );
}

function SettingsCard({
  title,
  sub,
  children,
}: {
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: sub ? 4 : 10 }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>{sub}</div>}
      {children}
    </div>
  );
}

function CodeRow({
  code,
  action,
  small,
}: {
  code: string;
  action: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <code
        style={{
          fontFamily: FM,
          fontSize: small ? 11 : 12,
          background: "#f7f4ec",
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          padding: "8px 10px",
          wordBreak: "break-all",
          flex: 1,
          minWidth: 220,
        }}
      >
        {code}
      </code>
      {action}
    </div>
  );
}

const btnGhost: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${C.border}`,
  borderRadius: 7,
  padding: "7px 13px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: FS,
  color: C.text,
};

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

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
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
