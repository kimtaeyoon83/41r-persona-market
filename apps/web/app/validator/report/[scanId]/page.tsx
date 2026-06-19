"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { API_BASE, scanApi, type ScanReport } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
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
  const { t } = useI18n();
  const scanId = (params?.scanId as string) || "demo";

  const [report, setReport] = useState<ScanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Acquisition Layer v1.1 — toggle between research-panel view
  // (Stage 1, persona-conditional) and visitor-weighted view
  // (Stage 1 × Stage 2 acquisition priors). Default: panel, since
  // the weighted view depends on heuristic priors that are still v1.0.
  // The visitor-weighted toggle is hidden until INTENT_ACTION
  // calibration matures (see "Next version" hint chip below). When
  // restoring the toggle, swap this back to:
  //   const [view, setView] = useState<"panel" | "visitor">("panel");
  // and set `visitorAvailable` below back to `view === "visitor" && weighted != null`.
  const [shareState, setShareState] = useState<"idle" | "copied" | "failed">("idle");

  const onShareReport = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareState("copied");
    } catch {
      setShareState("failed");
    }
    setTimeout(() => setShareState("idle"), 1500);
  };

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

  // Acquisition Layer v1.1 — derive the effective top-line based on
  // toggle. When weighted is null (Mode B / no data / pre-deploy
  // scans) we silently fall back to panel so the UI never breaks.
  const weighted = result?.weighted ?? null;
  // Phase 5+ — visitor view locked behind "Next version" hint, so this
  // is pinned to false. When toggle is restored, change back to:
  //   const visitorAvailable = view === "visitor" && weighted != null;
  const visitorAvailable: boolean = false;
  const effectiveResult = visitorAvailable
    ? {
        audience_fit_score: weighted!.audience_fit_score,
        best: weighted!.best,
        worst: weighted!.worst,
        median_score: weighted!.median_score,
        global_task_success_avg: weighted!.global_task_success_avg,
        global_sentiment_avg: weighted!.global_sentiment_avg,
      }
    : result;
  const effectiveAarrr = visitorAvailable ? r.aarrr_weighted : r.aarrr;

  return (
    <Frame active="report">
      <div className="v-page-pad">
        <div
          className="v-stack-sm"
          style={{
            justifyContent: "space-between",
            marginBottom: 20,
            gap: 16,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
              <Pill tone="accent">{t("report.pill")}</Pill>
              {r.scan.category && (
                <Pill>
                  {r.scan.category}
                  {r.scan.category_confidence != null && (
                    <span style={{ opacity: 0.7, marginLeft: 4 }}>
                      · {Math.round(r.scan.category_confidence * 100)}%
                    </span>
                  )}
                </Pill>
              )}
              <span style={{ fontSize: 11, color: C.textFaint }}>
                · {r.scan.personas_completed} personas · scan {r.scan.id.slice(0, 8)}
              </span>
            </div>
            <h1 style={{ fontSize: "clamp(18px, 5vw, 24px)", fontWeight: 600, margin: 0, letterSpacing: "-0.01em", wordBreak: "break-word", lineHeight: 1.25 }}>
              {r.scan.target_url} — {t("report.titleSuffix")}
            </h1>
            {r.scan.one_line_pitch && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 13,
                  color: C.textDim,
                  fontStyle: "italic",
                  lineHeight: 1.5,
                  maxWidth: 720,
                }}
              >
                &ldquo;{r.scan.one_line_pitch}&rdquo;
              </div>
            )}
            {/* Ch1 objective signals strip (2026-06-10 behavior-sim
                spike transfer) — deterministic page facts, no LLM.
                Hidden entirely on legacy scans (capture_signals null),
                same conditional pattern as the pitch above. */}
            {r.scan.capture_signals && (
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: FM,
                    letterSpacing: "0.08em",
                    color: C.textFaint,
                    textTransform: "uppercase",
                  }}
                  title="Measured from the live page at capture time — deterministic, no LLM judgment."
                >
                  {t("report.measuredNoLlm")}
                </span>
                <Pill>{r.scan.capture_signals.visible_word_count.toLocaleString()} words</Pill>
                <Pill>{r.scan.capture_signals.cta_count} CTAs</Pill>
                <Pill>{r.scan.capture_signals.link_count} links</Pill>
                {r.scan.capture_signals.nav_menu_labels.length > 0 && (
                  <Pill
                    style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    menu: {r.scan.capture_signals.nav_menu_labels.slice(0, 5).join(" · ")}
                    {r.scan.capture_signals.nav_menu_labels.length > 5 &&
                      ` +${r.scan.capture_signals.nav_menu_labels.length - 5}`}
                  </Pill>
                )}
                {r.scan.capture_signals.popup_detected && <Pill tone="warn">entry popup</Pill>}
                {r.scan.capture_signals.login_wall && <Pill tone="warn">login wall</Pill>}
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <ShareWithAi scanId={r.scan.id} />
            </div>
            {/* Acquisition Layer v1.1 — Visitor-weighted view toggle
                hidden behind "Coming in next version" until the
                INTENT_ACTION + per-category arrival_share priors are
                validated against more than the Merch GA4 n=1 baseline.
                The toggle UI is intentionally removed (not just
                disabled) so the user sees only the Panel view, which
                is what the report already defaults to. The `view`
                state stays for forward-compat — restore the toggle
                JSX here when calibration matures. */}
            {weighted && (
              <div
                style={{
                  marginTop: 12,
                  fontSize: 11,
                  fontFamily: FM,
                  color: C.textDim,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 10px",
                  background: C.panel,
                  border: `1px solid ${C.border}`,
                  borderRadius: 999,
                }}
                title="Visitor-weighted view (intent → action conversion estimate) is on the roadmap. Currently showing the research-panel view, which is honest for cross-site comparison."
              >
                <span style={{ color: C.warn, fontWeight: 600, letterSpacing: "0.05em" }}>
                  NEXT VERSION
                </span>
                <span>
                  Visitor-weighted view (currently showing research-panel)
                </span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Btn href={`/?url=${encodeURIComponent(r.scan.target_url)}`}>
              {t("report.rerun")}
            </Btn>
            <a
              href={`${API_BASE}/api/scan/${r.scan.id}/report.md`}
              download={`audience-fit-${r.scan.id.slice(0, 8)}.md`}
              style={{
                background: C.panel,
                color: C.text,
                border: `1px solid ${C.border}`,
                borderRadius: 7,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: FS,
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              {t("report.export")}
            </a>
            <Btn primary onClick={onShareReport}>
              {shareState === "copied"
                ? t("report.copied")
                : shareState === "failed"
                  ? t("report.copyFailed")
                  : t("report.share")}
            </Btn>
          </div>
        </div>

        {/* Mode B verdict block — replaces the Audience-Fit gauge for
            Mode B scans (single audience, pass/conditional/fail). */}
        {r.scan.mode === "B" && (
          <ModeBVerdictBlock
            verdict={r.scan.mode_b_verdict}
            score={effectiveResult?.audience_fit_score ?? null}
            audience={r.scan.target_audience_text ?? ""}
            parsedSelector={r.scan.mode_b_parsed_selector}
            personasCompleted={r.scan.personas_completed}
          />
        )}

        {/* ① Audience-Fit Score — Mode A only. Mode B uses the verdict
            block above instead. */}
        {r.scan.mode === "A" && (
          <SectionLabel
            n={1}
            label={t("report.sec1")}
            sub={t("report.sec1Sub")}
            help={{
              title: "How the Audience-Fit Score is computed",
              body: (
                <>
                  <p style={{ margin: "0 0 10px" }}>
                    <strong>What the number means</strong>: a 0-100 composite
                    score. 8 cohorts × ~14 personas each react to the site
                    screenshot, and the per-cohort fits are blended into one
                    headline. <strong>It is not a percentage</strong> — it
                    is a score.
                  </p>
                  <p style={{ margin: "0 0 8px" }}>
                    <strong>Formula (Option A)</strong>, computed by
                    backend <code>computeAudienceFit()</code> at{" "}
                    <code>services/audience_fit.ts:221</code>:
                  </p>
                  <pre
                    style={{
                      margin: "0 0 10px",
                      padding: 10,
                      background: "#f3f0e8",
                      borderRadius: 6,
                      fontSize: 11.5,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      fontFamily: FM,
                    }}
                  >
                    {`audience_fit_score =
  0.40 × best_cohort_fit_score
+ 0.30 × median_cohort_fit_score
+ 0.20 × global_task_success_avg
+ 0.10 × global_sentiment_avg`}
                  </pre>
                  <p style={{ margin: "0 0 8px" }}>
                    <strong>Per-cohort fit</strong> is itself a weighted
                    aggregate of the 5 persona dimensions
                    (engagement·task_success·happiness·adoption·retention),
                    averaged over the cohort&apos;s personas:
                  </p>
                  <pre
                    style={{
                      margin: "0 0 10px",
                      padding: 10,
                      background: "#f3f0e8",
                      borderRadius: 6,
                      fontSize: 11.5,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      fontFamily: FM,
                    }}
                  >
                    {`cohort_fit = engagement   × 0.30
           + task_success × 0.30
           + happiness    × 0.25
           + adoption     × 0.10
           + retention_d7 × 0.05`}
                  </pre>
                  <p style={{ margin: "0 0 8px" }}>
                    <strong>Why these weights?</strong> Engagement and
                    task_success have the highest measurement confidence in
                    persona simulation (0.30 each). SUS-based happiness is
                    a well-validated usability signal (0.25). Adoption
                    measures intent and so is degraded vs real conversion
                    (0.10). Retention calibration is weakest (r=0.18) —
                    the data is collected for future calibration but kept
                    at 0.05 so it doesn&apos;t drive the headline.
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Why best + median, not just average?</strong>{" "}
                    The 0.40 best + 0.30 median pair is what lets the
                    validator surface a niche-PMF win honestly: a product
                    that resonates strongly with one audience and is
                    ignored by the rest still scores high (best). At the
                    same time, the median term keeps a single outlier
                    cohort from dominating — to score high, both a strong
                    best AND a non-collapsing middle of the distribution
                    are required.
                  </p>
                </>
              ),
            }}
          />
        )}
        {!result && r.scan.mode === "A" && (
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
              <b>{t("report.analysisInProgress")}</b> — {r.scan.personas_completed} / {r.scan.personas_attempted || 112} personas · status{" "}
              <code style={{ fontFamily: FM, fontSize: 12 }}>{r.scan.status}</code>
            </span>
            <style>{`@keyframes validatorPulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
          </div>
        )}
        {result && r.scan.mode === "A" && <div
          className="v-stack-sm"
          style={{
            background: C.warnSoft,
            border: "1px solid #ecdcb4",
            borderRadius: 12,
            padding: 20,
            alignItems: "center",
            gap: 24,
            marginBottom: 24,
          }}
        >
          <PMFGauge value={Math.round(effectiveResult!.audience_fit_score)} />
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                background: "#fff",
                border: `1px solid ${verdictBorder(effectiveResult!.audience_fit_score)}`,
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                color: verdictBorder(effectiveResult!.audience_fit_score),
                marginBottom: 10,
              }}
            >
              {t(verdictLabel(effectiveResult!.audience_fit_score))}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{t("report.verdict")}</div>
            <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6, marginBottom: 14 }}>
              Best-fit cohort{" "}
              <b style={{ color: C.text }}>{effectiveResult!.best.cohort_label}</b> scores{" "}
              <b style={{ color: C.text }}>{Math.round(effectiveResult!.best.cohort_fit_score)}</b>;
              the worst{" "}
              <b style={{ color: C.text }}>{effectiveResult!.worst.cohort_label}</b> sits at{" "}
              <b style={{ color: C.text }}>{Math.round(effectiveResult!.worst.cohort_fit_score)}</b>.
              Median across cohorts is{" "}
              <b style={{ color: C.text }}>{Math.round(effectiveResult!.median_score)}</b>.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
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
                  {t("report.viewFormula")}
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
        <SectionLabel
          n={2}
          label={t("report.sec2")}
          sub={t("report.sec2Sub")}
          help={{
            title: "How Engagement & Retention curves are produced",
            body: (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Why bands, not raw numbers?</strong> Personas
                  don&apos;t emit free-form percentages. They pick one of
                  5 engagement bands and one of 4 retention bands — this
                  prevents fake precision like &quot;27.3% return on day
                  30&quot; that an LLM would happily fabricate.
                </p>
                <p style={{ margin: "0 0 8px" }}>
                  <strong>Engagement band → score lookup</strong> (
                  <code>audience_fit.ts:47</code>):
                </p>
                <pre
                  style={{
                    margin: "0 0 10px",
                    padding: 10,
                    background: "#f3f0e8",
                    borderRadius: 6,
                    fontSize: 11.5,
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                    fontFamily: FM,
                  }}
                >
                  {`abandon   10   ← <15s leave (reference dist ~50%)
skim      30   ← <1min skim         (~25%)
browse    55   ← 1-5min explore      (~17%)
engage    75   ← 5-15min active      (~5%)
extended  90   ← >15min deep         (~3%)`}
                </pre>
                <p style={{ margin: "0 0 8px" }}>
                  <strong>Retention band → D-curve lookup</strong> (
                  <code>audience_fit.ts:62</code>) — each band has a
                  hard-coded 4-point D-1/D-3/D-7/D-30 curve:
                </p>
                <pre
                  style={{
                    margin: "0 0 10px",
                    padding: 10,
                    background: "#f3f0e8",
                    borderRadius: 6,
                    fontSize: 11.5,
                    lineHeight: 1.7,
                    whiteSpace: "pre-wrap",
                    fontFamily: FM,
                  }}
                >
                  {`band       D-1  D-3  D-7  D-30
no_return    5    1    0    0
weak        40   15    5    1
moderate    70   50   30   10
strong      85   70   55   30`}
                </pre>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Retention curve chart</strong>: all valid
                  personas&apos; D-curves are averaged within each cohort,
                  then <code>buildRetentionCurve()</code> in{" "}
                  <code>routes/scan.ts:1199</code> averages those across
                  cohorts and rounds to integers — that 4-point series is
                  what the chart plots.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Engagement breakdown card</strong>: scan-wide
                  averages of the 5 dimensions. Bar colour follows score
                  bands (≥ 70 ✓, 50-70 ⚠, &lt; 50 ⛔).
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Defense-in-depth clamp</strong> (
                  <code>llm.ts:265</code>): when a persona answers{" "}
                  <code>engagement = abandon</code> but still claims a
                  high signup intent (Haiku occasionally drifts this way),
                  signup_likelihood and completion_likelihood are clamped
                  to ≤ 0.05 and retention is forced to{" "}
                  <code>no_return</code>. This keeps cohort averages from
                  being poisoned by self-contradicting answers.
                </p>
              </>
            ),
          }}
        />
        <div className="v-grid-stack-sm" style={{ marginBottom: 14 }}>
          <Card padding={18}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 14,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>{t("report.retentionCurve")}</div>
              <span style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}>
                n={r.scan.personas_completed} · ±5
              </span>
            </div>
            {retentionCurve.length > 0 ? (
              <RetentionCurve data={retentionCurve} />
            ) : (
              <div style={{ fontSize: 12, color: C.textFaint }}>{t("report.noRetention")}</div>
            )}
          </Card>
          <Card padding={18}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
              {t("report.engagementBreakdown")}
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
          </Card>
        </div>

        {/* ③ Friction & Bottleneck */}
        <SectionLabel
          n={3}
          label={t("report.sec3")}
          sub={t("report.sec3Sub")}
          help={{
            title: "How friction clusters are built",
            body: (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Input</strong>: every valid persona&apos;s{" "}
                  <code>voice_biggest_friction</code> quote (one per
                  persona). A typical Mode A scan feeds ~100 quotes; Mode B
                  feeds ~50.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Step 1 — Haiku clustering call</strong> (route
                  tag <code>validator.cluster_frictions</code>, file{" "}
                  <code>services/dimensions/frictions.ts:145</code>): the
                  full numbered list is sent to Haiku, which returns 3-5
                  themed clusters. Each carries <code>title</code>,{" "}
                  <code>summary</code>, <code>where</code>,{" "}
                  <code>representative_quote</code>, and the{" "}
                  <code>persona_indices</code> it claims to cover.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Step 2 — assembleFrictionClusters</strong> (
                  <code>frictions.ts:55</code>): clusters are sorted by{" "}
                  <code>n</code> (cluster size) descending and capped at
                  the top 5.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Step 3 — long-tail bucket invariant</strong>:
                  every persona index that the LLM did not assign to any
                  named cluster goes into an &quot;Other / long-tail
                  frictions&quot; bucket. The invariant{" "}
                  <code>Σ cluster.n + long_tail.n === items.length</code>{" "}
                  is what stops the report from silently dropping 5-10% of
                  friction inputs the clusterer fails to theme.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Impact value</strong>: the{" "}
                  <code>+N fit est.</code> chip shown on each cluster is
                  computed as <code>Math.round(n / total × 30)</code> — a
                  <em> rough fit-cost estimate</em>. It&apos;s an
                  indicator that fixing the cluster <em>could</em> lift
                  the audience-fit score by roughly that much; not a
                  measured value.
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Long-tail first-quote caveat</strong>: an
                  outlier — for example a non-English quote that cannot
                  cluster with English ones because the LLM is weak at
                  multilingual grouping — can land first in the long-tail
                  bucket and end up as the surfaced sample. In that case,
                  the surfaced quote is the first-indexed unassigned
                  input, not a representative of the whole bucket.
                </p>
              </>
            ),
          }}
        />
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

        {/* Improvement priority table — derived from the same friction
            data, reformatted as an action checklist. Excludes the
            long-tail bucket (not a single actionable item). */}
        {(() => {
          const actionable = frictions.filter(
            (f) =>
              !f.title.toLowerCase().includes("long-tail") &&
              f.where !== "Various",
          );
          if (actionable.length === 0) return null;
          const total = r.scan.personas_completed || 1;
          return (
            <>
              <SectionLabel
                n="A"
                label={t("report.improve")}
                sub={t("report.improveSub")}
                help={{
                  title: "How to read this priority table",
                  body: (
                    <>
                      <p style={{ margin: "0 0 10px" }}>
                        <strong>What it is</strong>: the same friction
                        clusters as above, reformatted as an action
                        checklist. Each row is one thing to fix, in priority
                        order (top = biggest leverage).
                      </p>
                      <p style={{ margin: "0 0 10px" }}>
                        <strong>Columns</strong>:
                      </p>
                      <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
                        <li>
                          <strong>What to fix</strong> — the cluster title
                          + LLM-generated detail line (one sentence
                          describing the problem in actionable terms)
                        </li>
                        <li>
                          <strong>Where</strong> — the page / step the
                          friction surfaces on
                        </li>
                        <li>
                          <strong>Affected</strong> — N personas out of
                          the total who raised this; higher N means a
                          broader audience hits this
                        </li>
                        <li>
                          <strong>Impact</strong> — rough fit-cost
                          estimate (
                          <code>+round(n / total × 30)</code>): how much
                          the audience-fit score might lift if this
                          friction is resolved. Indicator, not a measured
                          uplift.
                        </li>
                      </ul>
                      <p style={{ margin: 0 }}>
                        <strong>Excluded</strong>: the &quot;Other /
                        long-tail&quot; bucket. Long-tail aggregates
                        unassigned outlier frictions and isn&apos;t a
                        single actionable item.
                      </p>
                    </>
                  ),
                }}
              />
              <Card padding={0} style={{ marginBottom: 24, overflow: "hidden" }}>
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 12.5,
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: "#f7f4ec",
                          textAlign: "left",
                          color: C.textDim,
                          fontFamily: FM,
                          fontSize: 11,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                        }}
                      >
                        <th style={{ padding: "12px 14px", width: 48 }}>#</th>
                        <th style={{ padding: "12px 14px" }}>{t("report.colFix")}</th>
                        <th style={{ padding: "12px 14px", width: 180 }}>
                          {t("report.colWhere")}
                        </th>
                        <th
                          style={{
                            padding: "12px 14px",
                            width: 110,
                            textAlign: "right",
                          }}
                        >
                          {t("report.colAffected")}
                        </th>
                        <th
                          style={{
                            padding: "12px 14px",
                            width: 100,
                            textAlign: "right",
                          }}
                        >
                          {t("report.colImpact")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {actionable.map((f, i) => {
                        const tone =
                          i === 0 ? C.bad : i === 1 ? C.warn : C.text;
                        return (
                          <tr
                            key={f.rank}
                            style={{
                              borderTop: `1px solid ${C.border}`,
                              verticalAlign: "top",
                            }}
                          >
                            <td
                              style={{
                                padding: "14px",
                                color: tone,
                                fontFamily: FM,
                                fontWeight: 600,
                              }}
                            >
                              {f.rank}
                            </td>
                            <td style={{ padding: "14px" }}>
                              <div
                                style={{ fontWeight: 600, marginBottom: 4 }}
                              >
                                {f.title}
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: C.textDim,
                                  lineHeight: 1.55,
                                }}
                              >
                                {f.detail}
                              </div>
                            </td>
                            <td
                              style={{
                                padding: "14px",
                                fontSize: 11,
                                color: C.textDim,
                                fontFamily: FM,
                              }}
                            >
                              {f.where}
                            </td>
                            <td
                              style={{
                                padding: "14px",
                                fontFamily: FM,
                                color: C.textDim,
                                fontSize: 12,
                                textAlign: "right",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {f.n} / {total}
                            </td>
                            <td
                              style={{
                                padding: "14px",
                                textAlign: "right",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "3px 8px",
                                  borderRadius: 999,
                                  fontFamily: FM,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  background: tone === C.bad
                                    ? "#fde7e1"
                                    : tone === C.warn
                                      ? "#fff1d9"
                                      : "#eee9da",
                                  color: tone,
                                }}
                              >
                                {f.impact}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          );
        })()}

        {/* ④ Persona Resonance */}
        <SectionLabel
          n={4}
          label={t("report.sec4")}
          sub={t("report.sec4Sub")}
          help={{
            title: "Where the personas come from",
            body: (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Persona pool</strong>: ~800 procedurally-seeded
                  synthetic personas pre-loaded in the DB by{" "}
                  <code>scripts/seed-validator-cohorts.ts</code>. Each
                  cohort has 14 personas + extra seeds. A persona is not
                  a real person — it&apos;s a statistical character
                  defined by a PersonaVector: voice_sample (a one-line
                  tone seed), age_group, tech_literacy, crypto_experience,
                  expertise.{`{`}defi, nft, general_web{`}`},
                  feedback_pattern.{`{`}security_aware, ui_critical,
                  detail_oriented{`}`}, and other 0-1 axes.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>8 standard cohorts</strong> (
                  <code>packages/shared/src/cohorts.ts</code>):
                  crypto_native, defi_beginner, designer_20s, senior,
                  teen_newcomer, mobile_power, web3_pro, non_tech_30s.
                  Each has a selector — a set of axis ranges / categorical
                  filters that define who belongs.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Per-scan sampling</strong>: each persona is
                  matched to the cohort whose selector midpoint sits
                  closest by L2 distance among the cohorts they qualify
                  for. Cohort quota = 14 — once full, the persona
                  cascades to the next-best cohort. A persona is{" "}
                  <strong>assigned to exactly one cohort</strong>, which
                  prevents one individual from double-counting in two
                  cohort means.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Response generation</strong>: each persona&apos;s
                  vector + the site context (screenshot when{" "}
                  <code>USE_VISION=1</code>, URL + classifier output
                  otherwise) is sent to Sonnet/Haiku, which returns the
                  5 dimension scores, four voice quotes, and a
                  self-consistency check.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Fit vs Non-fit split</strong>: a persona is shown
                  on the Fit panel if their cohort&apos;s{" "}
                  <code>cohort_fit_score</code> is above the median;
                  otherwise on the Non-fit panel. Click a card to drill
                  into <code>/validator/persona/[id]?scan=...</code> for
                  the full 5-axis breakdown plus every voice quote that
                  persona produced.
                </p>
                <p style={{ margin: 0 }}>
                  <strong>The &quot;synth&quot; marker</strong>: synthetic
                  pool names (e.g. &quot;Jonas Bauer&quot;) can read like
                  real users to a stakeholder watching a demo. The small
                  &quot;synth&quot; badge on each card is the trust
                  contract that prevents that — the badge ships with the
                  pool name and never separately.
                </p>
              </>
            ),
          }}
        />
        <div className="v-grid-stack-sm" style={{ marginBottom: 24 }}>
          <PersonaBoard
            tone="ok"
            label={t("report.fitPersonas")}
            personas={fitPersonas}
            scanId={scanId}
          />
          <PersonaBoard
            tone="bad"
            label={t("report.nonFitPersonas")}
            personas={nonFitPersonas}
            scanId={scanId}
          />
        </div>

        {/* ⑤ AARRR funnel — Mode A only.
            v1.1 calibration is still rough (Merch GA4 n=1 INTENT_ACTION
            multipliers — CLAUDE.md "Known Limitations §2"), so the
            funnel is rendered behind a "Coming in next version" overlay
            with the actual chart blurred underneath. The chart still
            renders to preserve layout + give a hint of structure; click
            interactions are blocked by the overlay so the data isn't
            actionable until calibration validates against more sites. */}
        {effectiveAarrr && (
          <div style={{ position: "relative", marginBottom: 10 }}>
            {/* Blurred chart — no pointer events, so the overlay is
                the only interactive layer. */}
            <div
              style={{
                filter: "blur(6px) grayscale(0.3)",
                opacity: 0.4,
                pointerEvents: "none",
                userSelect: "none",
              }}
              aria-hidden
            >
              <AarrrFunnelBlock funnel={effectiveAarrr} />
            </div>
            {/* Overlay banner — centered above the blurred funnel. */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "auto",
              }}
            >
              <div
                style={{
                  padding: "16px 22px",
                  background: C.panel,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  boxShadow: "0 6px 24px rgba(0,0,0,0.08)",
                  fontFamily: FS,
                  textAlign: "center",
                  maxWidth: 480,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: FM,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    color: C.warn,
                    marginBottom: 6,
                  }}
                >
                  {t("report.comingNext")}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 4 }}>
                  AARRR funnel
                </div>
                <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.55 }}>
                  {t("report.aarrrCalibrating")}{" "}
                  <Link
                    href="/validator/how-it-works"
                    style={{ color: C.accent, textDecoration: "underline" }}
                  >
                    why
                  </Link>
                </div>
              </div>
            </div>
          </div>
        )}

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
              {t("report.serviceInfo")}
            </div>
            <div style={{ fontSize: 13 }}>
              {t("report.analyzedWith")} <b>{r.scan.weights_version ?? "v1.0"}</b> {t("report.weightsSuffix")}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn href="/validator/how-it-works">{t("report.howItWorks")}</Btn>
            <Btn href={`/validator/survey/${scanId}`}>{t("report.takeSurvey")}</Btn>
            {/* Phase 5 — Compare AI vs Human. The button always
                navigates; the compare page handles the n=0 empty
                state and offers a "Compute now" button itself, so
                we don't need to disable here. */}
            <Btn
              primary={r.survey_response_count > 0}
              href={`/validator/compare/${scanId}`}
            >
              {t("report.compareWithHumans")} (n={r.survey_response_count}) →
            </Btn>
            <Btn href="/validator/calibration">{t("report.calibrationReport")}</Btn>
          </div>
        </div>

        {r.report_anchor && (
          <div
            style={{
              marginTop: 8,
              padding: "10px 14px",
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              fontFamily: FM,
              fontSize: 11,
              color: C.textFaint,
            }}
          >
            <span style={{ color: C.accent, letterSpacing: "0.06em" }}>ON-CHAIN</span>
            <span>Report anchored · Walrus · Seal-encrypted:</span>
            <a
              href={r.report_anchor.walrus_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: C.accent, wordBreak: "break-all", textDecoration: "none" }}
            >
              {r.report_anchor.walrus_blob_id} ↗
            </a>
          </div>
        )}
      </div>
    </Frame>
  );
}

function verdictLabel(
  score: number,
): "report.verdictCritical" | "report.verdictImprove" | "report.verdictHealthy" {
  if (score < 40) return "report.verdictCritical";
  if (score < 60) return "report.verdictImprove";
  return "report.verdictHealthy";
}

function verdictBorder(score: number): string {
  if (score < 40) return C.bad;
  if (score < 60) return C.warn;
  return C.ok;
}

// ─── AARRR funnel block — main report section (Phase 2 D8) ──────
// Visualises the 5-stage AARRR funnel as horizontal bars whose
// width is proportional to the % of personas passing each stage.
// The bars narrow from Acquisition (always 100%) downward — the
// classic AARRR drop-off shape.
const AARRR_COLORS = [C.ok, C.accent, C.warn, C.exp, C.bad];

function AarrrFunnelBlock({
  funnel,
}: {
  funnel: NonNullable<ScanReport['aarrr']>;
}) {
  const { t } = useI18n();
  // Compute stage-to-stage dropoff (in score percentage points). The
  // 2026-05-07 user feedback was that absolute % numbers look too
  // similar across sites — and they do, especially in weighted view.
  // Surfacing the biggest drop reframes the funnel from "predict
  // conversion" to "diagnose where you leak", which is the actual
  // marketing-actionable signal a persona-conditional tool can give.
  const dropoffs = funnel.stages.map((s, i) => {
    if (i === 0) return 0;
    const prev = funnel.stages[i - 1]!.score;
    return Math.max(0, prev - s.score);
  });
  // Find the biggest drop (excluding Acquisition → Activation in
  // weighted view where the structural traffic-weighting drop always
  // dominates and is not a product issue per se). For panel view the
  // biggest drop genuinely indicates the bottleneck.
  let biggestDropIdx = 1;
  for (let i = 2; i < dropoffs.length; i++) {
    if (dropoffs[i]! > dropoffs[biggestDropIdx]!) biggestDropIdx = i;
  }
  const biggestDrop = dropoffs[biggestDropIdx]!;
  const biggestDropStage = funnel.stages[biggestDropIdx]!;
  return (
    <>
      <SectionLabel
        n="P"
        label="AARRR Funnel"
        sub={`Acquisition → Activation → Retention → Referral → Revenue · n=${funnel.total_personas}`}
        help={{
          title: "How the AARRR funnel filters personas",
          body: (
            <>
              <p style={{ margin: "0 0 10px" }}>
                <strong>What it shows</strong>: the share of the persona
                pool that clears each stage&apos;s threshold. This is a{" "}
                <strong>cumulative funnel</strong> — every stage&apos;s
                passing set is a subset of the previous stage&apos;s, so
                the bars are guaranteed monotonically non-increasing
                (Activation ≥ Retention ≥ Referral ≥ Revenue).
              </p>
              <p style={{ margin: "0 0 8px" }}>
                <strong>Thresholds</strong> (
                <code>services/aarrr.ts:42</code>):
              </p>
              <pre
                style={{
                  margin: "0 0 10px",
                  padding: 10,
                  background: "#f3f0e8",
                  borderRadius: 6,
                  fontSize: 11.5,
                  lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                  fontFamily: FM,
                }}
              >
                {`Acquisition  baseline (all valid personas, 100%)
Activation   + task_success ≥ 30
Retention    + retention_d7 ≥ 5
Referral     + happiness ≥ 60
Revenue      + adoption ≥ 30`}
              </pre>
              <p style={{ margin: "0 0 10px" }}>
                <strong>v1.1 retune (2026-05-06)</strong>: retention
                threshold dropped from 30 → 5 and revenue from 65 → 30.
                Observed distribution put ~85% of personas in the
                retention &quot;weak&quot; band (D7=5) and only ~3% in
                moderate (≥ 30); the old gates killed the funnel
                post-activation. The retuned 5 / 30 baselines are what
                makes the cumulative funnel actually drop meaningfully at
                each stage.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                <strong>BIGGEST LEAK callout</strong>: highlights the
                stage with the largest drop from the previous stage —
                i.e. <em>where audience intent is lost the most</em>.
                This reframing came after the v1.0 absolute-% headlines
                were marketed as conversion forecasts and shown to
                overshoot real GA4 reality by 5-30×.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                <strong>Panel vs Visitor view</strong>: Panel is the
                persona-conditional result (&quot;if these engaged
                personas saw the site, what would they do?&quot;).
                Visitor multiplies in site-realistic traffic priors +
                INTENT_ACTION factors (activation 0.50, retention 0.20,
                referral 0.10, revenue 0.05) to approximate GA4-style
                reality. The visitor toggle is labelled{" "}
                <strong>&quot;experimental — directional only, not a
                traffic forecast&quot;</strong> because it was calibrated
                against Google Merch GA4 alone (n=1) and the universal
                multipliers compress site-to-site differences.
              </p>
              <p style={{ margin: 0 }}>
                <strong>How to read it</strong>: use the funnel for
                cross-site / cross-iteration <em>relative</em> comparison
                and for bottleneck diagnosis. Don&apos;t treat the
                absolute % as a GA4 substitute — personas measure intent
                and GA4 measures action, and the ~5-30× gap between them
                is a fundamental property of intent-based simulation.
              </p>
            </>
          ),
        }}
      />
      <Card padding={20} style={{ marginBottom: 24 }}>
        {biggestDrop >= 5 && (
          <div
            style={{
              marginBottom: 14,
              padding: "10px 14px",
              background: C.warnSoft,
              border: `1px solid ${C.warn}55`,
              borderRadius: 8,
              fontSize: 12,
              fontFamily: FS,
              color: C.text,
              lineHeight: 1.5,
            }}
          >
            <span
              style={{
                fontFamily: FM,
                color: C.warn,
                fontWeight: 600,
                letterSpacing: "0.06em",
                marginRight: 6,
              }}
            >
              {t("report.biggestLeak")}
            </span>
            <strong>{biggestDropStage.label}</strong> — {biggestDrop.toFixed(0)} pt
            drop from previous stage. This is where your audience is
            losing intent the most. Fix this stage first.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {funnel.stages.map((s, i) => {
            const color = AARRR_COLORS[i] ?? C.accent;
            const widthPct = Math.max(2, s.score);
            const drop = dropoffs[i] ?? 0;
            const isBiggest = i === biggestDropIdx && biggestDrop >= 5;
            return (
              <div
                key={s.key}
                style={{ display: "flex", alignItems: "center", gap: 12 }}
              >
                <div
                  style={{
                    width: 100,
                    fontSize: 13,
                    fontWeight: 600,
                    color: C.text,
                  }}
                >
                  {s.label}
                </div>
                <div
                  style={{
                    flex: 1,
                    position: "relative",
                    height: 28,
                    background: "#f3f0e8",
                    borderRadius: 6,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      height: "100%",
                      width: `${widthPct}%`,
                      background: color,
                      opacity: 0.85,
                      transition: "width .6s",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: 10,
                      top: 0,
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      fontSize: 12,
                      fontFamily: FM,
                      color: "#fff",
                      fontWeight: 600,
                    }}
                  >
                    {s.score.toFixed(0)}%
                  </div>
                </div>
                <div
                  style={{
                    width: 70,
                    fontSize: 11,
                    fontFamily: FM,
                    color: C.textDim,
                    textAlign: "right",
                  }}
                >
                  {s.n_passing}/{s.total}
                </div>
                <div
                  style={{
                    width: 180,
                    fontSize: 10,
                    color: C.textFaint,
                    fontFamily: FM,
                  }}
                  title={s.threshold}
                >
                  {s.threshold}
                </div>
                <div
                  style={{
                    width: 70,
                    fontSize: 11,
                    fontFamily: FM,
                    color: drop > 0 ? (isBiggest ? C.warn : C.textDim) : "transparent",
                    fontWeight: isBiggest ? 700 : 500,
                    textAlign: "right",
                  }}
                  title={drop > 0 ? `Drop from ${funnel.stages[i - 1]!.label}` : undefined}
                >
                  {i === 0 ? "" : `▼ ${drop.toFixed(0)} pt`}
                </div>
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 14,
            padding: 10,
            background: C.expSoft,
            borderRadius: 6,
            fontSize: 11,
            color: C.exp,
            lineHeight: 1.5,
          }}
        >
          ⓘ The drop column shows the bottleneck: how many percentage
          points your audience loses moving to the next stage. Use it
          to prioritise which stage to fix first. Absolute % is a
          relative signal — compare across your iterations, not as a
          conversion forecast.
        </div>
      </Card>
    </>
  );
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

// ─── Mode B verdict block ─────────────────────────────────────────
// Replaces the Audience-Fit gauge for Mode B scans. Shows Pass /
// Conditional / Fail badge + score + parsed selector chips.
const VERDICT_CONFIG: Record<
  "pass" | "conditional" | "fail",
  { label: string; color: string; soft: string; border: string }
> = {
  pass: {
    label: "PASS",
    color: C.ok,
    soft: C.okSoft,
    border: "#cfe3d6",
  },
  conditional: {
    label: "CONDITIONAL",
    color: C.warn,
    soft: C.warnSoft,
    border: "#ecdcb4",
  },
  fail: {
    label: "FAIL",
    color: C.bad,
    soft: C.badSoft,
    border: "#eccac4",
  },
};

function formatSelectorChip(key: string, value: unknown): string | null {
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((v) => typeof v === "number")) {
      return `${key} ∈ [${(value[0] as number).toFixed(1)}, ${(value[1] as number).toFixed(1)}]`;
    }
    return `${key}: ${value.join(", ")}`;
  }
  return `${key}: ${String(value)}`;
}

function ModeBVerdictBlock({
  verdict,
  score,
  audience,
  parsedSelector,
  personasCompleted,
}: {
  verdict: "pass" | "conditional" | "fail" | null;
  score: number | null;
  audience: string;
  parsedSelector: unknown;
  personasCompleted: number;
}) {
  const cfg = verdict ? VERDICT_CONFIG[verdict] : null;
  const selectorEntries =
    parsedSelector && typeof parsedSelector === "object"
      ? Object.entries(parsedSelector as Record<string, unknown>).filter(
          ([, v]) => v !== undefined && v !== null,
        )
      : [];

  return (
    <>
      <SectionLabel
        n={1}
        label="Verification Verdict"
        sub="Pass · Conditional · Fail thresholds: ≥60 / 40-60 / <40"
        help={{
          title: "How the verification verdict is computed",
          body: (
            <>
              <p style={{ margin: "0 0 10px" }}>
                <strong>What Mode B (Verify) does</strong>: it answers
                &quot;does this product fit a specific audience?&quot;.
                Mode A discovers across 8 cohorts; Mode B narrows the
                question to one user-defined audience and verifies the
                fit there.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                <strong>Step 1 — natural-language → CohortSelector</strong>{" "}
                (<code>services/dimensions/audience_parser.ts</code>):
                Haiku reads the user&apos;s description (e.g. &quot;30s
                DeFi expert, mobile-first&quot;) and emits a structured
                CohortSelector with axis ranges + categorical filters.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                <strong>Step 2 — persona matching</strong>: from the ~800
                pool, strict-match the parsed selector. If fewer than 10
                personas match, progressively drop the narrowest numeric
                range until 10+ match. Sort by L2 distance to the
                selector midpoint and take up to 50.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                <strong>Step 3 — score synthesis</strong>: average the 5
                dimension scores across the picked personas →
                cohort_fit_score (same formula as Mode A). Because Mode B
                only has a single cohort, that score is the
                audience_fit_score directly — no best/median blend.
              </p>
              <p style={{ margin: "0 0 8px" }}>
                <strong>Verdict bands</strong> (spec §1.3):
              </p>
              <pre
                style={{
                  margin: "0 0 10px",
                  padding: 10,
                  background: "#f3f0e8",
                  borderRadius: 6,
                  fontSize: 11.5,
                  lineHeight: 1.7,
                  whiteSpace: "pre-wrap",
                  fontFamily: FM,
                }}
              >
                {`≥ 60   Pass         strong fit with the named audience
40-60  Conditional  partial fit, room to improve
< 40   Fail         wrong audience for this product`}
              </pre>
              <p style={{ margin: 0 }}>
                <strong>Why no best / median?</strong> Mode B only has one
                cohort, so there is no distribution to synthesise across.
                The displayed score uses{" "}
                <code>Math.floor(score × 10) / 10</code>, so 39.99 reads
                as &quot;39.9 (Fail)&quot; and avoids the cognitive
                dissonance of a number that rounds up to 40.0 sitting
                under a &quot;Fail&quot; label.
              </p>
            </>
          ),
        }}
      />
      <div
        style={{
          background: cfg?.soft ?? C.warnSoft,
          border: `1px solid ${cfg?.border ?? "#ecdcb4"}`,
          borderRadius: 12,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <div className="v-stack-sm" style={{ alignItems: "center", gap: 24 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: C.textFaint, fontFamily: FM, letterSpacing: "0.06em", marginBottom: 4 }}>
              TARGET AUDIENCE
            </div>
            <div style={{ fontSize: "clamp(15px, 4vw, 18px)", fontWeight: 600, color: C.text, marginBottom: 14, wordBreak: "break-word" }}>
              &ldquo;{audience}&rdquo;
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {selectorEntries.map(([k, v]) => {
                const txt = formatSelectorChip(k, v);
                return txt ? (
                  <span
                    key={k}
                    style={{
                      fontSize: 11,
                      padding: "3px 9px",
                      borderRadius: 999,
                      background: "#fff",
                      border: `1px solid ${C.border}`,
                      color: C.textDim,
                      fontFamily: FM,
                    }}
                  >
                    {txt}
                  </span>
                ) : null;
              })}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 16px",
                background: "#fff",
                border: `2px solid ${cfg?.color ?? C.warn}`,
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 700,
                color: cfg?.color ?? C.warn,
                letterSpacing: "0.06em",
                marginBottom: 12,
              }}
            >
              {cfg?.label ?? "PENDING"}
            </div>
            <div
              style={{
                fontSize: 56,
                fontWeight: 600,
                color: cfg?.color ?? C.warn,
                fontFamily: FM,
                letterSpacing: "-0.03em",
                lineHeight: 1,
              }}
            >
              {score != null ? Math.round(score) : "—"}
            </div>
            <div
              style={{
                fontSize: 11,
                color: C.textFaint,
                fontFamily: FM,
                letterSpacing: "0.1em",
                marginTop: 4,
              }}
            >
              / 100 · {personasCompleted} personas
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Share with AI ────────────────────────────────────────────
// Generates a public markdown URL the user can paste into ChatGPT
// or Claude. Both LLMs auto-fetch URLs in the prompt and read the
// markdown directly — much cleaner than copy-pasting the entire
// report into a chat. Backend renders the doc at
// /api/scan/:id/report.md (server-side, no JS, no auth).

function ShareWithAi({ scanId }: { scanId: string }) {
  const [open, setOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const url = `${API_BASE}/api/scan/${scanId}/report.md`;
  const suggestedPrompt =
    `Read the audience-fit report at ${url} and answer:\n` +
    `1. Which friction cluster should we fix first, and why?\n` +
    `2. What does the cohort breakdown tell us about who this product is for?\n` +
    `3. If we could change one thing on the site to lift the score, what would it be?\n` +
    `\n` +
    `Note: this report measures persona INTENT, not measured action. ` +
    `Don't treat absolute %s as conversion forecasts — use them for relative ranking.`;

  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1500);
    } catch {
      setCopiedKey("error");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          fontSize: 12,
          fontFamily: FM,
          fontWeight: 500,
          color: C.text,
          background: C.panel,
          border: `1px solid ${C.borderStrong}`,
          borderRadius: 999,
          cursor: "pointer",
        }}
      >
        <span aria-hidden="true">🤖</span> Share with AI
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              background: "rgba(20, 18, 14, 0.35)",
              backdropFilter: "blur(2px)",
              WebkitBackdropFilter: "blur(2px)",
            }}
          />
          <div
            role="dialog"
            aria-label="Share this report with an AI"
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 51,
              width: 560,
              maxWidth: "calc(100vw - 32px)",
              maxHeight: "80vh",
              overflowY: "auto",
              padding: "18px 20px",
              background: C.panel,
              border: `1px solid ${C.borderStrong}`,
              borderRadius: 10,
              boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
              fontFamily: FS,
              fontSize: 13,
              lineHeight: 1.6,
              color: C.text,
              textAlign: "left",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
                paddingBottom: 10,
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <div
                style={{
                  fontFamily: FM,
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.textDim,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                Share with AI
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  border: "none",
                  background: "transparent",
                  color: C.textDim,
                  fontSize: 18,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>

            <p style={{ margin: "0 0 14px", color: C.textDim }}>
              Paste this <strong>public link</strong> into ChatGPT or Claude.
              Both LLMs will auto-fetch it and read the report — no need to
              copy-paste the data itself.
            </p>

            {/* Public report URL */}
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontFamily: FM,
                  fontSize: 10,
                  color: C.textFaint,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Report URL
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                <code
                  style={{
                    flex: 1,
                    minWidth: 0,
                    padding: "10px 12px",
                    background: "#f3f0e8",
                    borderRadius: 8,
                    fontSize: 11.5,
                    fontFamily: FM,
                    color: C.text,
                    wordBreak: "break-all",
                    lineHeight: 1.5,
                  }}
                >
                  {url}
                </code>
                <button
                  type="button"
                  onClick={() => copy(url, "url")}
                  style={{
                    padding: "0 14px",
                    border: `1px solid ${C.borderStrong}`,
                    background: copiedKey === "url" ? C.text : C.panel,
                    color: copiedKey === "url" ? C.bg : C.text,
                    borderRadius: 8,
                    fontSize: 12,
                    fontFamily: FM,
                    fontWeight: 500,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {copiedKey === "url" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            {/* Suggested prompt */}
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontFamily: FM,
                  fontSize: 10,
                  color: C.textFaint,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Suggested prompt
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: "12px",
                  background: "#f3f0e8",
                  borderRadius: 8,
                  fontSize: 11.5,
                  fontFamily: FM,
                  color: C.text,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  lineHeight: 1.55,
                  marginBottom: 8,
                }}
              >
                {suggestedPrompt}
              </pre>
              <button
                type="button"
                onClick={() => copy(suggestedPrompt, "prompt")}
                style={{
                  padding: "8px 14px",
                  border: `1px solid ${C.borderStrong}`,
                  background: copiedKey === "prompt" ? C.text : C.panel,
                  color: copiedKey === "prompt" ? C.bg : C.text,
                  borderRadius: 8,
                  fontSize: 12,
                  fontFamily: FM,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {copiedKey === "prompt" ? "Copied" : "Copy prompt"}
              </button>
            </div>

            {/* Quick-launch links */}
            <div>
              <div
                style={{
                  fontFamily: FM,
                  fontSize: 10,
                  color: C.textFaint,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  marginBottom: 6,
                }}
              >
                Open directly
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a
                  href={`https://claude.ai/new?q=${encodeURIComponent(suggestedPrompt)}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: "8px 14px",
                    border: `1px solid ${C.borderStrong}`,
                    background: C.panel,
                    color: C.text,
                    borderRadius: 8,
                    fontSize: 12,
                    fontFamily: FM,
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  Open in Claude →
                </a>
                <a
                  href={`https://chat.openai.com/?q=${encodeURIComponent(suggestedPrompt)}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: "8px 14px",
                    border: `1px solid ${C.borderStrong}`,
                    background: C.panel,
                    color: C.text,
                    borderRadius: 8,
                    fontSize: 12,
                    fontFamily: FM,
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  Open in ChatGPT →
                </a>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: C.textFaint,
                  marginTop: 10,
                  lineHeight: 1.5,
                }}
              >
                The new chat opens with the prompt pre-filled. Paste the URL
                above if the LLM doesn&apos;t fetch it automatically (some
                ChatGPT plans require browsing to be enabled).
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
