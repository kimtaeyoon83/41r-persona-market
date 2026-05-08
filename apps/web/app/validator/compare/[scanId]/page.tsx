"use client";

// Phase 5 — AI vs Human comparison report.
//
// Renders the AI-side audience-fit signal next to the human-side
// aggregate in a single page. Both sides share the same vocabulary
// (audience_fit_score, dimension means, frictions, AARRR) so the
// reader can directly compare. The middle "diff" column surfaces
// per-dimension Δ + friction overlap + AI-only / Human-only clusters.
//
// The human side stays null until the operator clicks "Compare with
// humans (n=X)" on the report page, which calls
// scanApi.recomputeHumanAggregate(). Once cached on the scan row,
// this page reads it from GET /:id/compare without re-running.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { scanApi, type ScanCompareReport } from "@/lib/api";
import { C, FM, FS, Frame } from "../../_components/ui";

const DIM_LABELS: Record<keyof ScanCompareReport["ai"]["dimension_means"], string> = {
  engagement: "Engagement",
  task_success: "Task success",
  happiness: "Happiness",
  adoption: "Adoption",
  retention_d7: "Retention D-7",
};

export default function ComparePage() {
  const params = useParams<{ scanId: string }>();
  const scanId = params?.scanId ?? "";

  const [report, setReport] = useState<ScanCompareReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  useEffect(() => {
    if (!scanId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    scanApi
      .getCompareReport(scanId)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load comparison");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [scanId]);

  const onRecompute = async () => {
    if (recomputing || !scanId) return;
    setRecomputing(true);
    setError(null);
    try {
      await scanApi.recomputeHumanAggregate(scanId);
      const refreshed = await scanApi.getCompareReport(scanId);
      setReport(refreshed);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to recompute");
    } finally {
      setRecomputing(false);
    }
  };

  if (loading) {
    return (
      <Frame active="discovery">
        <div className="v-page-pad" style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ color: C.textDim, fontSize: 13, fontFamily: FM }}>Loading comparison…</div>
        </div>
      </Frame>
    );
  }
  if (error || !report) {
    return (
      <Frame active="discovery">
        <div className="v-page-pad" style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ color: C.bad, fontSize: 13, marginBottom: 12 }}>{error ?? "No data"}</div>
          <Link href={`/validator/report/${scanId}`} style={{ color: C.accent, fontSize: 13 }}>
            ← Back to report
          </Link>
        </div>
      </Frame>
    );
  }

  const { scan, ai, human, diff, survey_response_count } = report;

  return (
    <Frame active="discovery">
      <div className="v-page-pad" style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 22 }}>
          <Link
            href={`/validator/report/${scanId}`}
            style={{ fontSize: 12, color: C.textFaint, fontFamily: FM, textDecoration: "none" }}
          >
            ← Back to report
          </Link>
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 600,
            fontFamily: FS,
            lineHeight: 1.2,
            marginBottom: 6,
          }}
        >
          AI vs Human comparison
        </h1>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 4 }}>
          {scan.target_url}
        </div>
        <div
          style={{
            fontSize: 12,
            color: C.textFaint,
            fontFamily: FM,
            marginBottom: 22,
          }}
        >
          AI: {ai.n_personas} personas · Human: {human ? `${human.n_respondents} responses` : "not yet aggregated"}
          {human && survey_response_count > human.n_respondents && (
            <span style={{ color: C.warn, marginLeft: 8 }}>
              ({survey_response_count - human.n_respondents} new responses since last compute)
            </span>
          )}
        </div>

        {/* Recompute trigger */}
        <div
          style={{
            marginBottom: 28,
            padding: 14,
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
            {human
              ? `Human aggregate computed at ${new Date(human.computed_at).toLocaleString()}.`
              : `${survey_response_count} survey response${survey_response_count === 1 ? "" : "s"} collected — click to compute the human report.`}
          </div>
          <button
            onClick={onRecompute}
            disabled={recomputing || survey_response_count === 0}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontFamily: FS,
              fontWeight: 500,
              background: survey_response_count === 0 ? C.panel : C.text,
              color: survey_response_count === 0 ? C.textFaint : C.bg,
              border: `1px solid ${survey_response_count === 0 ? C.border : C.text}`,
              borderRadius: 7,
              cursor: survey_response_count === 0 ? "not-allowed" : "pointer",
              opacity: recomputing ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {recomputing ? "Computing…" : human ? "Recompute" : "Compute now"}
          </button>
        </div>

        {/* Headline scores */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            marginBottom: 28,
          }}
          className="v-grid-stack-sm"
        >
          <ScoreCard label="AI score" value={ai.audience_fit_score} accent={C.text} />
          <ScoreCard
            label="Δ (Human − AI)"
            value={diff?.audience_fit_delta ?? null}
            accent={diff ? deltaColor(diff.audience_fit_delta) : C.textFaint}
            showSign
            showWhenNull="—"
          />
          <ScoreCard label="Human score" value={human?.audience_fit_score ?? null} accent={C.text} />
        </div>

        {/* Dimension breakdown */}
        <h2 style={{ fontSize: 16, fontWeight: 600, fontFamily: FS, marginBottom: 12 }}>
          Dimension means
        </h2>
        <div
          style={{
            marginBottom: 28,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 0.6fr 1fr",
              padding: "10px 14px",
              background: C.panel,
              borderBottom: `1px solid ${C.border}`,
              fontSize: 11,
              fontFamily: FM,
              color: C.textDim,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
          >
            <div>Dimension</div>
            <div style={{ textAlign: "right" }}>AI</div>
            <div style={{ textAlign: "right" }}>Δ</div>
            <div style={{ textAlign: "right" }}>Human</div>
          </div>
          {(Object.keys(DIM_LABELS) as Array<keyof typeof DIM_LABELS>).map((k) => {
            const aiV = ai.dimension_means[k];
            const huV = human?.dimension_means[k];
            const dV = diff?.dimension_deltas[k];
            return (
              <div
                key={k}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr 0.6fr 1fr",
                  padding: "12px 14px",
                  borderTop: `1px solid ${C.border}`,
                  fontSize: 13,
                  alignItems: "center",
                }}
              >
                <div>{DIM_LABELS[k]}</div>
                <div style={{ textAlign: "right", fontFamily: FM }}>{aiV.toFixed(1)}</div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: FM,
                    fontWeight: 600,
                    color: dV === undefined ? C.textFaint : deltaColor(dV),
                  }}
                >
                  {dV === undefined ? "—" : `${dV >= 0 ? "+" : ""}${dV.toFixed(1)}`}
                </div>
                <div style={{ textAlign: "right", fontFamily: FM }}>
                  {huV === undefined ? "—" : huV.toFixed(1)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Friction overlap */}
        <h2 style={{ fontSize: 16, fontWeight: 600, fontFamily: FS, marginBottom: 12 }}>
          Friction overlap
        </h2>
        {!human ? (
          <div
            style={{
              padding: 16,
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              fontSize: 13,
              color: C.textDim,
              marginBottom: 28,
            }}
          >
            Compute the human aggregate to see friction comparison.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 28,
            }}
            className="v-grid-stack-sm"
          >
            <FrictionList title={`AI top frictions (${ai.frictions.length})`} items={ai.frictions} accent={C.accent} />
            <FrictionList
              title={`Human top frictions (${human.frictions?.length ?? 0})`}
              items={(human.frictions ?? []).map((f) => ({ rank: f.rank, title: f.title, n: f.n }))}
              accent={C.warn}
            />
          </div>
        )}

        {/* AI-only / Human-only callouts */}
        {diff && (diff.ai_only_frictions.length > 0 || diff.human_only_frictions.length > 0) && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 28,
            }}
            className="v-grid-stack-sm"
          >
            <CalloutBox title="AI saw, humans didn't" items={diff.ai_only_frictions} color={C.accent} />
            <CalloutBox title="Humans saw, AI missed" items={diff.human_only_frictions} color={C.warn} />
          </div>
        )}

        {/* Custom question rollup */}
        {scan.custom_questions && scan.custom_questions.length > 0 && human && (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 600, fontFamily: FS, marginBottom: 12 }}>
              Site-specific questions
            </h2>
            <div
              style={{
                marginBottom: 28,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                background: C.panel,
              }}
            >
              {scan.custom_questions.map((q, i) => {
                const rollup = human.custom_question_rollup[q.id];
                return (
                  <div
                    key={q.id}
                    style={{
                      padding: 14,
                      borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
                    }}
                  >
                    <div style={{ fontSize: 12, color: C.textFaint, fontFamily: FM, marginBottom: 4 }}>
                      {q.id.toUpperCase()} · {q.type}
                    </div>
                    <div style={{ fontSize: 13, marginBottom: 8 }}>{q.question}</div>
                    {q.type === "likert" && rollup?.likert ? (
                      <div style={{ fontSize: 13, fontFamily: FM, color: C.textDim }}>
                        Mean:{" "}
                        <span style={{ color: C.text, fontWeight: 600 }}>
                          {rollup.likert.mean.toFixed(2)}
                        </span>{" "}
                        / 5 · n={rollup.likert.n_answered}
                      </div>
                    ) : q.type === "text" && rollup?.quotes && rollup.quotes.length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {rollup.quotes.map((qt, j) => (
                          <div
                            key={j}
                            style={{
                              fontSize: 12,
                              color: C.textDim,
                              padding: "6px 10px",
                              background: C.bg,
                              borderRadius: 6,
                              fontStyle: "italic",
                            }}
                          >
                            &ldquo;{qt}&rdquo;
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: C.textFaint, fontFamily: FM }}>
                        No responses yet
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Frame>
  );
}

function deltaColor(d: number): string {
  if (Math.abs(d) < 5) return C.textDim;
  if (Math.abs(d) < 15) return C.warn;
  return C.bad;
}

function ScoreCard({
  label,
  value,
  accent,
  showSign,
  showWhenNull,
}: {
  label: string;
  value: number | null;
  accent: string;
  showSign?: boolean;
  showWhenNull?: string;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 11, color: C.textDim, fontFamily: FM, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 600, fontFamily: FM, color: accent }}>
        {value === null
          ? showWhenNull ?? "—"
          : `${showSign && value >= 0 ? "+" : ""}${value.toFixed(1)}`}
      </div>
    </div>
  );
}

function FrictionList({
  title,
  items,
  accent,
}: {
  title: string;
  items: ReadonlyArray<{ rank: number; title: string; n: number }>;
  accent: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 12, color: C.textDim, fontFamily: FM, marginBottom: 12, fontWeight: 600 }}>
        {title}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textFaint }}>No clusters</div>
      ) : (
        items.slice(0, 5).map((f) => (
          <div
            key={f.rank}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                background: accent,
                color: C.bg,
                fontSize: 11,
                fontFamily: FM,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {f.rank}
            </div>
            <div style={{ flex: 1, fontSize: 13 }}>{f.title}</div>
            <div style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}>n={f.n}</div>
          </div>
        ))
      )}
    </div>
  );
}

function CalloutBox({
  title,
  items,
  color,
}: {
  title: string;
  items: ReadonlyArray<{ title: string; n: number }>;
  color: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        background: C.panel,
        border: `1px solid ${color}33`,
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 12, color, fontFamily: FM, marginBottom: 8, fontWeight: 600 }}>
        {title}
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: C.textFaint }}>(none)</div>
      ) : (
        items.map((f, i) => (
          <div
            key={i}
            style={{
              fontSize: 13,
              padding: "4px 0",
              color: C.text,
            }}
          >
            • {f.title} <span style={{ color: C.textFaint, fontSize: 11, fontFamily: FM }}>(n={f.n})</span>
          </div>
        ))
      )}
    </div>
  );
}
