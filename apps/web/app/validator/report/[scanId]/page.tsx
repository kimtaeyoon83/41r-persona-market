"use client";

import Link from "next/link";
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
  // Acquisition Layer v1.1 — toggle between research-panel view
  // (Stage 1, persona-conditional) and visitor-weighted view
  // (Stage 1 × Stage 2 acquisition priors). Default: panel, since
  // the weighted view depends on heuristic priors that are still v1.0.
  const [view, setView] = useState<"panel" | "visitor">("panel");

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
  const visitorAvailable = view === "visitor" && weighted != null;
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
              <Pill tone="accent">Report</Pill>
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
              {r.scan.target_url} — Survival Report
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
            {/* Acquisition Layer v1.1 — view toggle. Only shown when the
                weighted view is available (Mode A + post-Stage-3 scans). */}
            {weighted && (
              <div
                style={{
                  marginTop: 12,
                  display: "inline-flex",
                  gap: 0,
                  background: "#f3f0e8",
                  border: `1px solid ${C.border}`,
                  borderRadius: 999,
                  padding: 3,
                  fontSize: 11,
                  fontFamily: FM,
                }}
              >
                {(
                  [
                    { id: "panel" as const, label: "Research panel", sub: "engaged audience — recommended for cross-site comparison" },
                    { id: "visitor" as const, label: "Visitor-weighted", sub: "experimental — directional only, not a traffic forecast" },
                  ]
                ).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setView(m.id)}
                    title={m.sub}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 999,
                      background: view === m.id ? C.panel : "transparent",
                      color: view === m.id ? C.text : C.textDim,
                      border:
                        view === m.id
                          ? `1px solid ${C.borderStrong}`
                          : "1px solid transparent",
                      cursor: "pointer",
                      fontFamily: FM,
                      fontWeight: view === m.id ? 600 : 400,
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Btn>Re-run</Btn>
            <Btn>Export ↗</Btn>
            <Btn primary>Share report</Btn>
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
            label="Audience-Fit Score"
            sub="Composite of best · median · task-success · sentiment"
            help={{
              title: "Audience-Fit Score 산출 방식",
              body: (
                <>
                  <p style={{ margin: "0 0 10px" }}>
                    <strong>이 숫자가 뜻하는 것</strong>: 0-100 사이의 종합
                    점수. 8개 코호트 ×{" "}
                    {`~14`}명 페르소나가 사이트 스크린샷에 반응한 결과를
                    합성한 결과. <strong>%가 아닙니다</strong> — 점수.
                  </p>
                  <p style={{ margin: "0 0 8px" }}>
                    <strong>공식 (Option A)</strong>: 백엔드의{" "}
                    <code>computeAudienceFit()</code> (
                    <code>services/audience_fit.ts:221</code>) 가 계산:
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
                    <strong>각 코호트 점수의 산출</strong>: 코호트 안의
                    페르소나들이 응답한 5개 dimension(engagement,
                    task_success, happiness, adoption, retention)의 평균을
                    confidence-weighted aggregate한 값.
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
                    <strong>왜 이 가중치?</strong> Engagement와 task_success는
                    페르소나 시뮬레이션에서 측정 신뢰도가 가장 높음 (각
                    0.30). SUS-기반 happiness는 잘 검증된 usability 지표
                    (0.25). Adoption은 의도 측정이라 신호가 약해 0.10.
                    Retention은 calibration이 약함 (r=0.18) — 데이터는
                    수집하되 점수에 큰 영향 안 주려고 0.05.
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>왜 best+median?</strong> 평균이 아닌 best 0.40 +
                    median 0.30 조합은 <em>niche-PMF</em>를 페널티 안 주기
                    위함. 한 코호트에 강하게 매칭되고 나머지는 무시되는
                    제품도 정확한 신호로 surface (best 가중). 동시에
                    median 항이 단일 outlier가 점수를 dominant하지 못하게
                    방지.
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
              <b>Analysis in progress</b> — {r.scan.personas_completed} of{" "}
              {r.scan.personas_attempted || 112} personas analyzed · status{" "}
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
              {verdictLabel(effectiveResult!.audience_fit_score)}
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Verdict</div>
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
        <SectionLabel
          n={2}
          label="Engagement"
          sub="First-session flow in plain terms"
          help={{
            title: "Engagement & Retention Curve 산출 방식",
            body: (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>측정 단위</strong>: 페르소나는 자유롭게 숫자를
                  답하지 않음. 5개 engagement band + 4개 retention band
                  중 하나 선택만 함 — 페르소나가 직접 &quot;30일 후 27%
                  돌아옴&quot; 같은 가짜 정밀도 만들지 않게 하기 위함.
                </p>
                <p style={{ margin: "0 0 8px" }}>
                  <strong>Engagement band → score 매핑</strong> (
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
                  {`abandon  10  ← <15초 이탈 (참조 분포 50%)
skim     30  ← <1분 빠른 훑어봄    (~25%)
browse   55  ← 1-5분 탐색            (~17%)
engage   75  ← 5-15분 능동 사용     (~5%)
extended 90  ← >15분 깊은 활용      (~3%)`}
                </pre>
                <p style={{ margin: "0 0 8px" }}>
                  <strong>Retention band → D-curve 매핑</strong> (
                  <code>audience_fit.ts:62</code>) — 각 band마다 D-1/D-3/
                  D-7/D-30 4점이 하드코딩:
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
                  <strong>Retention curve 차트</strong>: 모든 유효 페르소나의
                  D-curve를 코호트별 평균 →{" "}
                  <code>buildRetentionCurve()</code> (
                  <code>routes/scan.ts:1199</code>) 가 코호트들을 한 번 더
                  평균 + 정수 반올림 → 4점 차트 표시.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Engagement breakdown 카드</strong>: 5개 dimension의
                  scan-전체 평균. Bar 색상은 점수 대역 (≥70 ✓, 50-70 ⚠,
                  &lt;50 ⛔).
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Defense-in-depth clamp</strong> (
                  <code>llm.ts:265</code>): persona가{" "}
                  <code>engagement=abandon</code>이라고 답했는데도 signup
                  intent를 높게 답할 경우 (Haiku가 가끔 이렇게 drift),
                  signup/completion ≤ 0.05로 강제 clamp + retention 강제{" "}
                  <code>no_return</code>. 모순된 응답이 cohort 평균을
                  오염시키지 않게 하는 안전장치.
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
          </Card>
        </div>

        {/* ③ Friction & Bottleneck */}
        <SectionLabel
          n={3}
          label="Friction & Bottleneck"
          sub="Where the journey breaks"
          help={{
            title: "Friction Cluster 산출 방식",
            body: (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>입력</strong>: 모든 유효 페르소나 응답에서
                  추출된 <code>voice_biggest_friction</code> 인용문 (한
                  페르소나당 1개). Mode A 스캔이면 보통 ~100명, Mode B는
                  ~50명.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>1단계 — Haiku 클러스터링 호출</strong> (route tag{" "}
                  <code>validator.cluster_frictions</code>, 파일{" "}
                  <code>services/dimensions/frictions.ts:145</code>):
                  numbered list로 모든 quote를 prompt에 담아서 Haiku에게
                  3-5개 themed cluster를 만들라고 요청. 각 cluster는{" "}
                  <code>title</code>, <code>summary</code>,{" "}
                  <code>where</code>, <code>representative_quote</code>,{" "}
                  <code>persona_indices</code> 필드.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>2단계 — assembleFrictionClusters</strong> (
                  <code>frictions.ts:55</code>): LLM 출력을{" "}
                  <code>n</code> (cluster 크기) 내림차순 정렬, top 5에서
                  cap.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>3단계 — Long-tail bucket 강제</strong>: LLM이
                  어떤 cluster에도 할당하지 않은 페르소나는 모두
                  &quot;Other / long-tail frictions&quot; 버킷으로 합침.
                  invariant: <code>Σ cluster.n + long_tail.n
                  === items.length</code>. 이게 없으면 LLM이 깔끔하게
                  themed화 못한 5-10%의 친 입력을 silently drop함.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>impact 숫자</strong>: 각 cluster 카드에 표시되는{" "}
                  <code>+N fit est.</code> 값은{" "}
                  <code>Math.round(n / total × 30)</code> 로 산출되는 <em>
                  rough fit-cost 추정치</em>. cluster를 해소하면 audience-
                  fit score가 대략 +N 정도 올라갈 가능성이 있다는
                  지시값일 뿐, 측정값이 아님.
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Long-tail 첫 quote의 한계</strong>: 한국어 인용 등
                  영어 cluster에 묶이지 않는 outlier가 long-tail의 가장
                  앞에 노출될 수 있음 (LLM이 다국어 클러스터링에 약함).
                  이런 경우 long-tail의 quote는 13명 모두를 대표하는
                  것이 아닌, 우연히 첫 번째로 indexed된 입력일 뿐.
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

        {/* ④ Persona Resonance */}
        <SectionLabel
          n={4}
          label="Persona Resonance"
          sub="Who used it how — click a card for drill-down"
          help={{
            title: "Persona Pool 출처와 분류 방식",
            body: (
              <>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>페르소나 풀</strong>: ~800명의 procedurally-seeded
                  합성 페르소나가 DB에 사전 시드됨 (
                  <code>scripts/seed-validator-cohorts.ts</code>). 8개 표준
                  코호트마다 14명씩 + 추가 시드. 페르소나는 실제 사람이
                  아니라 PersonaVector로 정의된 통계적 인물 — voice_sample
                  (한 줄 톤 샘플), age_group, tech_literacy,
                  crypto_experience, expertise.{`{`}defi, nft,
                  general_web{`}`}, feedback_pattern.{`{`}security_aware,
                  ui_critical, detail_oriented{`}`} 등 0-1 사이 axis로
                  구성.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>8개 표준 코호트</strong> (
                  <code>packages/shared/src/cohorts.ts</code>): crypto_native,
                  defi_beginner, designer_20s, senior, teen_newcomer,
                  mobile_power, web3_pro, non_tech_30s. 각각 selector
                  (axis별 range / categorical 조건)로 정의되어 있음.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>스캔당 샘플링</strong>: 각 페르소나는 자기에게
                  맞는 (selector match) 코호트 중 selector midpoint와
                  L2 거리 가장 가까운 코호트에 배정. quota는 코호트당
                  14명 — 다 차면 다음 best 코호트로 fallback. 한 페르소나는{" "}
                  <strong>오직 한 코호트</strong>에만 들어감 (이중
                  카운팅으로 평균 오염 방지).
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>각 페르소나의 응답 생성</strong>: 그 페르소나의
                  vector + 사이트 스크린샷(USE_VISION=1) 또는 URL+분류
                  결과만(USE_VISION=0)을 prompt에 담아 Sonnet/Haiku 호출.
                  return JSON: 5개 dimension 점수 + voice quote 4개 +
                  self-consistency check.
                </p>
                <p style={{ margin: "0 0 10px" }}>
                  <strong>Fit vs Non-fit 분류</strong>: 각 페르소나가
                  속한 코호트의 <code>cohort_fit_score</code> 가 평균보다
                  높으면 Fit panel, 낮으면 Non-fit panel로 노출. 페르소나
                  카드 클릭하면 <code>/validator/persona/[id]?scan=...</code>{" "}
                  로 이동해 5축 dimension 점수 + 모든 voice quote 확인
                  가능.
                </p>
                <p style={{ margin: 0 }}>
                  <strong>&quot;synth&quot; 마커</strong>: 합성 풀 페르소나는
                  pool 이름 (예: Jonas Bauer)이 마치 실제 사용자처럼 보일
                  수 있으므로 카드에 작은 &quot;synth&quot; 배지로 명시.
                  스테이크홀더가 데모를 볼 때 가상이라는 점이 즉시
                  보이도록 보장하는 신뢰 contract.
                </p>
              </>
            ),
          }}
        />
        <div className="v-grid-stack-sm" style={{ marginBottom: 24 }}>
          <PersonaBoard
            tone="ok"
            label="Fit personas"
            personas={fitPersonas}
            scanId={scanId}
          />
          <PersonaBoard
            tone="bad"
            label="Non-fit personas"
            personas={nonFitPersonas}
            scanId={scanId}
          />
        </div>

        {/* ⑤ AARRR funnel — Mode A only (Mode B audience is already
            narrow and "funnel" semantics don't apply). Free feature
            on the main report after the Pro tier was retired (D8). */}
        {effectiveAarrr && (
          <>
            <div
              style={{
                padding: "10px 14px",
                background: C.warnSoft,
                border: `1px solid ${C.warn}33`,
                borderRadius: 8,
                marginBottom: 10,
                fontSize: 11,
                color: C.text,
                lineHeight: 1.55,
                fontFamily: FS,
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
                {visitorAvailable ? "EXPERIMENTAL · DIRECTIONAL ONLY" : "PERSONA-CONDITIONAL"}
              </span>
              {visitorAvailable
                ? "Visitor-weighted absolute values are calibrated against limited GA4 data (n=1) and overshoot reality by 5-30×. Use for relative ranking only — not as a conversion forecast. Switch to Research panel for honest cross-site comparison."
                : "These % reflect engaged-persona behavior, not visitor traffic. Compare across sites; do not read as absolute conversion."}{" "}
              <Link
                href="/validator/how-it-works"
                style={{ color: C.accent, textDecoration: "underline" }}
              >
                why
              </Link>
            </div>
            <AarrrFunnelBlock funnel={effectiveAarrr} />
          </>
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
              SERVICE INFO
            </div>
            <div style={{ fontSize: 13 }}>
              Analyzed with <b>{r.scan.weights_version ?? "v1.0"}</b> weights
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Btn href="/validator/how-it-works">How it works →</Btn>
            <Btn href={`/validator/survey/${scanId}`}>Take baseline survey →</Btn>
            <Btn href="/validator/calibration">Calibration report →</Btn>
          </div>
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
          title: "AARRR Funnel 산출 방식",
          body: (
            <>
              <p style={{ margin: "0 0 10px" }}>
                <strong>의미</strong>: 페르소나 풀 중 각 단계 임계값을
                통과하는 비율. <strong>cumulative funnel</strong> — 각
                stage의 통과 set은 이전 stage 통과 set의 부분집합. 그래서
                항상 monotonically non-increasing (Activation ≥
                Retention ≥ Referral ≥ Revenue).
              </p>
              <p style={{ margin: "0 0 8px" }}>
                <strong>임계값</strong> (
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
                {`Acquisition  baseline (모든 valid 페르소나, 100%)
Activation   + task_success ≥ 30
Retention    + retention_d7 ≥ 5
Referral     + happiness ≥ 60
Revenue      + adoption ≥ 30`}
              </pre>
              <p style={{ margin: "0 0 10px" }}>
                <strong>v1.1 retune (2026-05-06)</strong>: Retention 임계값
                30→5, Revenue 65→30 으로 낮춤. 측정된 페르소나 분포에서
                85%가 retention &quot;weak&quot; band(D7=5)에 위치하고
                moderate(≥30)는 3%뿐 — 옛 임계값 30은 도달 불가, funnel을
                실질적으로 죽임. 5와 30 임계는 cumulative funnel이
                stage마다 의미있게 떨어지도록 calibrate한 v1.1 baseline.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                <strong>BIGGEST LEAK 표시</strong>: stage-to-stage drop이
                가장 큰 단계를 자동으로 highlight. 절대 수치보다 <em>
                어디가 누수의 핵심이냐</em>를 surface하는 게 목적. v1.0
                팀이 절대 % 를 conversion forecast로 마케팅하다 GA4 대비
                5-30× 과대평가가 드러난 사례 이후 v1.1에서 reframe한
                결과.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                <strong>Panel view vs Visitor view</strong>: Panel은 페르소나-
                conditional 결과 (engaged 페르소나가 보면 어떤가).
                Visitor는 site-realistic 트래픽 priors + INTENT_ACTION
                multipliers (activation 0.50, retention 0.20, referral
                0.10, revenue 0.05)를 곱해 실제 GA4 reality에 더 가까운
                추정치를 만들려는 시도. <strong>experimental — directional
                only, not a traffic forecast</strong>로 라벨링됨 (Merch
                GA4 n=1로만 calibrate되어 카테고리 간 압축이 큼).
              </p>
              <p style={{ margin: 0 }}>
                <strong>옳은 사용</strong>: 사이트 간/이터레이션 간 상대
                비교 + bottleneck 진단. 절대 % 를 GA4 대체로 쓰면 안
                됨 — 페르소나가 측정하는 것은 의도(intent)이고 GA4가
                측정하는 것은 행동(action)이라 본질적으로 5-30× gap이
                존재.
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
              BIGGEST LEAK
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
          title: "Verification Verdict 산출 방식",
          body: (
            <>
              <p style={{ margin: "0 0 10px" }}>
                <strong>Mode B (Verify) 의 목적</strong>: &quot;이 제품이
                특정 오디언스에게 잘 맞는가?&quot; 를 검증. Mode A는 8개
                코호트 디스커버리를 하지만 Mode B는 사용자가 명시한
                단일 오디언스에 대한 fit 검증.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                <strong>1단계 — 자연어 → CohortSelector 파싱</strong> (
                <code>services/dimensions/audience_parser.ts</code>):
                Haiku에게 사용자 입력 (예: &quot;30대 DeFi 전문가, 모바일
                위주&quot;)을 받아서 PersonaVector axis들의 range / set
                조건으로 변환.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                <strong>2단계 — 페르소나 매칭</strong>: ~800명 풀에서
                CohortSelector에 strict-match되는 페르소나 추출 → 부족하면
                점진적 완화 (가장 좁은 numeric range부터 drop) → 최대
                50명, 최소 10명 보장. L2 거리로 정렬해 선택.
              </p>
              <p style={{ margin: "0 0 10px" }}>
                <strong>3단계 — 응답 + 점수 합성</strong>: 그 단일 코호트의
                평균 5개 dimension 점수 → cohort_fit_score (Mode A와 동일
                공식). Mode B는 best/median 분리가 없으니 그냥 그 코호트
                점수가 곧 audience_fit_score.
              </p>
              <p style={{ margin: "0 0 8px" }}>
                <strong>Verdict band (spec §1.3)</strong>:
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
                {`≥ 60   Pass         지정 오디언스에 강한 fit
40-60  Conditional  부분적 fit, 개선 여지 있음
< 40   Fail         이 오디언스에 안 맞음`}
              </pre>
              <p style={{ margin: 0 }}>
                <strong>왜 best/median이 없나?</strong> Mode B는 단일 코호트만
                다루기 때문에 분포 합성이 불필요. audience_fit_score 표시도{" "}
                <code>Math.floor(score × 10) / 10</code> 로 39.99가
                &quot;39.9 (Fail)&quot;처럼 명확하게 읽히도록 처리 (40.0이
                &quot;Fail&quot;로 라벨링되는 인지 부조화 방지).
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
