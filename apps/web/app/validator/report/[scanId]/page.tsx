"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { scanApi, type ScanReport } from "@/lib/api";
import {
  Bar,
  Btn,
  C,
  Card,
  FM,
  FS,
  Frame,
  PMFGauge,
  PersonaBoard,
  Pill,
  RetentionCurve,
  SectionLabel,
} from "../../_components/ui";

// Screen 4: Survival Summary report. Maps to ScreenReport in
// screens-v2.jsx, hydrated from GET /api/scan/:id/report.
//
// Phase 1A.5 ships:
//   - id='demo'  → API returns the baked demo fixture (full render)
//   - id=<uuid>  → API returns scan record. Pending scans show an
//                  "in progress" placeholder. Completed scans render
//                  with real data once Phase 1B ships the LLM pipeline.

const TONE_COLOR: Record<string, string> = {
  ok: C.ok,
  bad: C.bad,
  warn: C.warn,
  faint: C.textFaint,
};

export default function ValidatorReportPage() {
  const params = useParams();
  const scanId = (params?.scanId as string) || "demo";

  const [report, setReport] = useState<ScanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const IN_FLIGHT_STATUSES = new Set([
      "pending",
      "sampling",
      "responding",
      "aggregating",
    ]);

    const fetchOnce = async () => {
      try {
        const r = await scanApi.getReport(scanId);
        if (cancelled) return;
        setReport(r);
        setLoading(false);
        // While the scan is still running, poll every 800ms so the UI
        // refreshes as scan_persona_responses + scan_cohort_results
        // rows accumulate. Stop once status flips to completed/failed.
        if (IN_FLIGHT_STATUSES.has(r.scan.status)) {
          timer = setTimeout(fetchOnce, 800);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load report");
        setLoading(false);
      }
    };

    setLoading(true);
    setError(null);
    fetchOnce();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [scanId]);

  if (loading) {
    return (
      <Frame active="report">
        <PlaceholderState message="Loading report…" />
      </Frame>
    );
  }

  if (error || !report) {
    return (
      <Frame active="report">
        <PlaceholderState message={error ?? "Report not found"} tone="bad" />
      </Frame>
    );
  }

  // Progressive render: even when result is null (scan still running)
  // we render whatever cohort + persona rows have already landed in
  // the DB. Synthesis-only blocks (gauge / KPIs / formula) hide until
  // completion; the rest fill in as data flows.
  const r = report;
  const result = r.result; // null while in-flight, populated when completed
  const fitPersonas = r.fit_personas ?? [];
  const nonFitPersonas = r.non_fit_personas ?? [];
  const frictions = r.frictions ?? [];
  const retentionCurve = r.retention_curve ?? [];
  const formulaRows = r.formula_rows ?? [];
  const dimensionBreakdown = r.dimension_breakdown ?? [];
  const kpis = r.kpis ?? [];

  return (
    <Frame active="report">
      <div style={{ padding: "24px 32px 36px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 20,
            gap: 16,
          }}
        >
          <div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <Pill tone="accent">Report</Pill>
              {r.scan.category && <Pill>{r.scan.category} · auto-detected</Pill>}
              <span style={{ fontSize: 11, color: C.textFaint }}>
                · {r.scan.personas_completed} personas · scan {r.scan.id.slice(0, 8)}
              </span>
            </div>
            <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              {r.scan.target_url} — Survival Report
            </h1>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <Btn>Re-run</Btn>
            <Btn>Export ↗</Btn>
            <Btn primary>Share report</Btn>
          </div>
        </div>

        {/* ① Audience-Fit Score (renamed from "PMF Survival Score" — Option A) */}
        <SectionLabel
          n={1}
          label="Audience-Fit Score"
          sub="Composite of best · median · task-success · sentiment"
        />
        {!result && (
          <div
            style={{
              background: C.warnSoft,
              border: "1px solid #ecdcb4",
              borderRadius: 12,
              padding: 16,
              marginBottom: 24,
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 13,
              color: C.warn,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: C.warn,
                animation: "validatorPulse 1s infinite",
              }}
            />
            <span>
              <b>Analysis in progress</b> — {r.scan.personas_completed} of{" "}
              {r.scan.personas_attempted || 112} personas analyzed · status{" "}
              <code style={{ fontFamily: FM, fontSize: 12 }}>{r.scan.status}</code>
            </span>
            <style>{`@keyframes validatorPulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
          </div>
        )}
        {result && <div
          style={{
            background: C.warnSoft,
            border: "1px solid #ecdcb4",
            borderRadius: 12,
            padding: 20,
            display: "flex",
            alignItems: "center",
            gap: 24,
            marginBottom: 24,
          }}
        >
          <PMFGauge value={Math.round(result.audience_fit_score)} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                background: "#fff",
                border: `1px solid ${verdictBorder(result.audience_fit_score)}`,
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                color: verdictBorder(result.audience_fit_score),
                marginBottom: 10,
              }}
            >
              {verdictLabel(result.audience_fit_score)}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Verdict</div>
            <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, marginBottom: 14 }}>
              Best-fit cohort{" "}
              <b style={{ color: C.text }}>{result.best.cohort_label}</b> scores{" "}
              <b style={{ color: C.text }}>{Math.round(result.best.cohort_fit_score)}</b>;
              the worst{" "}
              <b style={{ color: C.text }}>{result.worst.cohort_label}</b> sits at{" "}
              <b style={{ color: C.text }}>{Math.round(result.worst.cohort_fit_score)}</b>.
              Median across cohorts is{" "}
              <b style={{ color: C.text }}>{Math.round(result.median_score)}</b>.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              {kpis.map((s) => (
                <div
                  key={s.l}
                  style={{
                    padding: 10,
                    background: "#fff",
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: C.textFaint,
                      fontFamily: FM,
                      letterSpacing: "0.06em",
                    }}
                  >
                    {s.l.toUpperCase()}
                  </div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 600,
                      color: TONE_COLOR[s.tone] ?? C.text,
                      marginTop: 2,
                      fontFamily: FM,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {s.v}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 1 }}>{s.sub}</div>
                </div>
              ))}
            </div>
            {formulaRows.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary
                  style={{
                    fontSize: 11,
                    color: C.warn,
                    cursor: "pointer",
                    fontWeight: 600,
                    listStyle: "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  ▾ View formula
                </summary>
                <div
                  style={{
                    marginTop: 10,
                    padding: 12,
                    background: "#fff",
                    borderRadius: 6,
                    border: `1px solid ${C.border}`,
                  }}
                >
                  <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8, fontFamily: FM }}>
                    Cohort fit = Σ (dimension_score × weight)
                  </div>
                  {formulaRows.map((row) => (
                    <div
                      key={row.d}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1.4fr 0.6fr 0.6fr 1.4fr 0.7fr",
                        gap: 8,
                        padding: "5px 0",
                        borderTop: `1px solid ${C.border}`,
                        fontSize: 11,
                        alignItems: "center",
                      }}
                    >
                      <span>{row.d}</span>
                      <span style={{ fontFamily: FM, color: C.textDim }}>{row.s}</span>
                      <span style={{ fontFamily: FM, color: C.textDim }}>
                        × {row.w.toFixed(2)}
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Bar
                          value={row.c * 100}
                          color={row.c >= 0.7 ? C.ok : row.c >= 0.4 ? C.warn : C.bad}
                          bg="#f3f0e8"
                          height={3}
                        />
                        <span style={{ fontFamily: FM, color: C.textFaint, fontSize: 10 }}>
                          r={row.c.toFixed(2)}
                        </span>
                      </span>
                      <span style={{ fontFamily: FM, fontWeight: 600, textAlign: "right" }}>
                        = {(row.s * row.w).toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>}

        {/* ② Engagement */}
        <SectionLabel n={2} label="Engagement" sub="First-session flow in plain terms" />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.1fr 1fr",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <Card padding={18}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 14,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>Retention curve</div>
              <span style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}>
                n={r.scan.personas_completed} · ±5
              </span>
            </div>
            {retentionCurve.length > 0 ? (
              <RetentionCurve data={retentionCurve} />
            ) : (
              <div style={{ fontSize: 12, color: C.textFaint }}>No retention data yet.</div>
            )}
          </Card>
          <Card padding={18}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
              Engagement breakdown
            </div>
            {dimensionBreakdown.map((m, i) => {
              const tone = TONE_COLOR[m.tone] ?? C.text;
              return (
                <div
                  key={m.l}
                  style={{
                    padding: "8px 0",
                    borderTop: i ? `1px solid ${C.border}` : "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 4,
                    }}
                  >
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{m.l}</span>
                      <span style={{ fontSize: 11, color: C.textDim, marginLeft: 6 }}>
                        · {m.sub}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 13,
                        fontFamily: FM,
                        fontWeight: 600,
                        color: tone,
                      }}
                    >
                      {m.v}
                      {m.suffix || ""}
                    </span>
                  </div>
                  {!m.suffix && <Bar value={m.v} color={tone} bg="#f3f0e8" height={4} />}
                </div>
              );
            })}
            <div
              style={{
                marginTop: 10,
                padding: 8,
                background: C.expSoft,
                borderRadius: 5,
                fontSize: 11,
                color: C.exp,
                lineHeight: 1.5,
              }}
            >
              ⚗ AARRR 5-stage funnel lives in <b>Pro mode</b> — Acquisition / Activation /
              Retention / Referral / Revenue measured separately.
            </div>
          </Card>
        </div>

        {/* ③ Friction & Bottleneck */}
        <SectionLabel n={3} label="Friction & Bottleneck" sub="Where the journey breaks" />
        <Card padding={18} style={{ marginBottom: 24 }}>
          {frictions.map((f, i) => (
            <div
              key={f.rank}
              style={{
                display: "flex",
                gap: 14,
                padding: "12px 0",
                borderTop: i ? `1px solid ${C.border}` : "none",
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: i === 0 ? C.bad : i === 1 ? C.warn : "#d4cfc1",
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  fontFamily: FM,
                  flexShrink: 0,
                }}
              >
                {f.rank}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: 10,
                    marginBottom: 4,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{f.title}</div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      fontSize: 11,
                      color: C.textFaint,
                      fontFamily: FM,
                    }}
                  >
                    <span>
                      n = {f.n}/{r.scan.personas_completed}
                    </span>
                    <span>·</span>
                    <Pill tone="ok">{f.impact}</Pill>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: C.textDim, marginBottom: 6 }}>
                  <Pill style={{ fontSize: 10, marginRight: 8 }}>{f.where}</Pill>
                  {f.detail}
                </div>
                <div
                  style={{
                    padding: "8px 12px",
                    background: "#f7f4ec",
                    borderLeft: `2px solid ${C.accent}`,
                    fontSize: 12,
                    fontStyle: "italic",
                    color: C.text,
                  }}
                >
                  &ldquo;{f.quote}&rdquo;
                </div>
              </div>
            </div>
          ))}
        </Card>

        {/* ④ Persona Resonance */}
        <SectionLabel
          n={4}
          label="Persona Resonance"
          sub="Who used it how — click a card for drill-down"
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            marginBottom: 24,
          }}
        >
          <PersonaBoard tone="ok" label="Fit personas" personas={fitPersonas} />
          <PersonaBoard tone="bad" label="Non-fit personas" personas={nonFitPersonas} />
        </div>

        <div
          style={{
            marginTop: 8,
            padding: "14px 18px",
            background: "#f3f0e8",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            border: `1px solid ${C.border}`,
            fontFamily: FS,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 12,
                color: C.textFaint,
                fontFamily: FM,
                letterSpacing: "0.06em",
                marginBottom: 2,
              }}
            >
              SERVICE INFO
            </div>
            <div style={{ fontSize: 13 }}>
              Analyzed with <b>{r.scan.weights_version ?? "v1.0"}</b> weights
            </div>
          </div>
          <Btn href="/validator/calibration">Calibration report →</Btn>
        </div>
      </div>
    </Frame>
  );
}

function verdictLabel(score: number): string {
  if (score < 40) return "⚠ WARNING — CRITICAL CHURN DETECTED";
  if (score < 60) return "⚠ WARNING — IMPROVEMENT NEEDED";
  return "✓ HEALTHY — STRONG AUDIENCE FIT";
}

function verdictBorder(score: number): string {
  if (score < 40) return C.bad;
  if (score < 60) return C.warn;
  return C.ok;
}

function PlaceholderState({
  message,
  tone = "neutral",
}: {
  message: string;
  tone?: "neutral" | "warn" | "bad";
}) {
  const color = tone === "warn" ? C.warn : tone === "bad" ? C.bad : C.textDim;
  return (
    <div
      style={{
        padding: "80px 32px",
        textAlign: "center",
        fontFamily: FS,
        color,
        fontSize: 14,
      }}
    >
      {message}
    </div>
  );
}
