"use client";

// /me/responses/[scanId] — Phase 5.1.
//
// AI-vs-Me detail view of one human survey submission. Shows what the
// user answered + how each of their 5 dimension scores compares to the
// AI persona panel's weighted means. Deep-links to the full Compare
// page (/validator/compare/[scanId]) for the aggregate-level view.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { meApi, type MySurveyResponseDetail } from "@/lib/api";
import { C, FM, FS, Frame } from "../../../validator/_components/ui";

const DIM_LABELS: Record<keyof MySurveyResponseDetail["dimension_deltas"], string> = {
  engagement: "Engagement",
  task_success: "Task success",
  happiness: "Happiness",
  adoption: "Adoption",
  retention_d7: "Retention D-7",
};

const ENGAGEMENT_LABEL: Record<string, string> = {
  abandon: "Abandon (<15s)",
  skim: "Skim (<1min)",
  browse: "Browse (1-5min)",
  engage: "Engage (5-15min)",
  extended: "Extended (>15min)",
};
const RETENTION_LABEL: Record<string, string> = {
  no_return: "No return",
  weak: "Weak — maybe once",
  moderate: "Moderate — weekly",
  strong: "Strong — daily",
};

export default function MyResponseDetailPage() {
  const params = useParams<{ scanId: string }>();
  const scanId = params?.scanId ?? "";
  const { ready, authenticated, login } = useAuth();
  const [data, setData] = useState<MySurveyResponseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !scanId) return;
    if (!authenticated) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    meApi
      .getMySurveyResponse(scanId)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [ready, authenticated, scanId]);

  if (!ready || loading) {
    return (
      <Frame active="discovery">
        <Center>Loading…</Center>
      </Frame>
    );
  }

  if (!authenticated) {
    return (
      <Frame active="discovery">
        <Center>
          <h1 style={{ fontSize: 24, fontWeight: 600, fontFamily: FS, marginBottom: 14 }}>
            Sign in to see your response
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
            Sign in
          </button>
        </Center>
      </Frame>
    );
  }

  if (error || !data) {
    return (
      <Frame active="discovery">
        <Center>
          <div style={{ color: C.bad, fontSize: 13, marginBottom: 12 }}>
            {error ?? "Response not found"}
          </div>
          <Link href="/me/responses" style={{ color: C.accent, fontSize: 13 }}>
            ← Back to my responses
          </Link>
        </Center>
      </Frame>
    );
  }

  const { scan, response, me_scores, ai_scores, dimension_deltas } = data;

  return (
    <Frame active="discovery">
      <div className="v-page-pad" style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <Link
            href="/me/responses"
            style={{ fontSize: 12, color: C.textFaint, fontFamily: FM, textDecoration: "none" }}
          >
            ← My responses
          </Link>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 600, fontFamily: FS, lineHeight: 1.2, marginBottom: 6 }}>
          AI vs You
        </h1>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 4 }}>
          {scan.target_url}
        </div>
        <div style={{ fontSize: 12, color: C.textFaint, fontFamily: FM, marginBottom: 22 }}>
          Submitted {new Date(response.submitted_at).toLocaleString()}
          {scan.category && <> · {scan.category}</>}
          <> · scan {scan.id.slice(0, 8)}…</>
        </div>

        {/* AI vs Me dimension comparison */}
        <h2 style={{ fontSize: 15, fontWeight: 600, fontFamily: FS, marginBottom: 10 }}>
          Dimension comparison
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
              gridTemplateColumns: "1fr 0.8fr 0.6fr 0.8fr",
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
            <div style={{ textAlign: "right" }}>AI panel</div>
            <div style={{ textAlign: "right" }}>Δ</div>
            <div style={{ textAlign: "right" }}>You</div>
          </div>
          {(Object.keys(DIM_LABELS) as Array<keyof typeof DIM_LABELS>).map((k) => {
            const ai = ai_scores[k];
            const me = me_scores[k];
            const d = dimension_deltas[k];
            return (
              <div
                key={k}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 0.8fr 0.6fr 0.8fr",
                  padding: "12px 14px",
                  borderTop: `1px solid ${C.border}`,
                  fontSize: 13,
                  alignItems: "center",
                }}
              >
                <div>{DIM_LABELS[k]}</div>
                <div style={{ textAlign: "right", fontFamily: FM }}>{ai.toFixed(1)}</div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: FM,
                    fontWeight: 600,
                    color: deltaColor(d),
                  }}
                >
                  {d >= 0 ? "+" : ""}{d.toFixed(1)}
                </div>
                <div style={{ textAlign: "right", fontFamily: FM }}>{me.toFixed(1)}</div>
              </div>
            );
          })}
        </div>

        {/* Your answers */}
        <h2 style={{ fontSize: 15, fontWeight: 600, fontFamily: FS, marginBottom: 10 }}>
          Your answers
        </h2>
        <div
          style={{
            marginBottom: 24,
            padding: 16,
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
          className="v-grid-stack-sm"
        >
          <KV label="Engagement" value={ENGAGEMENT_LABEL[response.dimension_inputs.engagement_category] ?? response.dimension_inputs.engagement_category} />
          <KV label="Retention" value={RETENTION_LABEL[response.dimension_inputs.retention_category] ?? response.dimension_inputs.retention_category} />
          <KV label="Signup likelihood" value={`${Math.round(response.dimension_inputs.signup_likelihood * 100)}%`} />
          <KV label="Completion likelihood" value={`${Math.round(response.dimension_inputs.completion_likelihood * 100)}%`} />
        </div>

        {/* Voice quotes */}
        {(response.voice.first_impression || response.voice.biggest_friction || response.voice.would_return_because || response.voice.if_could_change_one_thing) && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 600, fontFamily: FS, marginBottom: 10 }}>
              Your voice
            </h2>
            <div style={{ marginBottom: 24, display: "flex", flexDirection: "column", gap: 8 }}>
              <Quote label="First impression" body={response.voice.first_impression} />
              <Quote label="Biggest friction" body={response.voice.biggest_friction} />
              <Quote label="Would return because" body={response.voice.would_return_because} />
              <Quote label="One thing to change" body={response.voice.if_could_change_one_thing} />
            </div>
          </>
        )}

        {/* Custom question answers */}
        {scan.custom_questions && scan.custom_questions.length > 0 && (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 600, fontFamily: FS, marginBottom: 10 }}>
              Site-specific questions
            </h2>
            <div
              style={{
                marginBottom: 24,
                background: C.panel,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
              }}
            >
              {scan.custom_questions.map((q, i) => {
                const ans = response.custom_answers[q.id];
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
                    <div style={{ fontSize: 13, marginBottom: 6 }}>{q.question}</div>
                    <div style={{ fontSize: 13, color: C.textDim }}>
                      {ans === undefined ? (
                        <span style={{ color: C.textFaint, fontStyle: "italic" }}>(skipped)</span>
                      ) : q.type === "likert" ? (
                        <span style={{ fontFamily: FM, color: C.text }}>{ans} / 5</span>
                      ) : (
                        <span style={{ fontStyle: "italic" }}>&ldquo;{String(ans)}&rdquo;</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* CTA — go deeper into the aggregate compare view */}
        <div
          style={{
            padding: 14,
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
            See how your answers stack up against all the other humans + AI personas
            who reacted to this site.
          </div>
          <Link
            href={`/validator/compare/${scanId}`}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              background: C.text,
              color: C.bg,
              borderRadius: 7,
              textDecoration: "none",
              fontFamily: FS,
              whiteSpace: "nowrap",
            }}
          >
            Aggregate compare →
          </Link>
        </div>

        <div style={{ marginTop: 18, fontSize: 12, color: C.textFaint }}>
          <Link
            href={`/validator/survey/${scanId}`}
            style={{ color: C.textFaint, textDecoration: "underline" }}
          >
            Edit my answers →
          </Link>
        </div>
      </div>
    </Frame>
  );
}

function deltaColor(d: number): string {
  if (Math.abs(d) < 5) return C.textDim;
  if (Math.abs(d) < 15) return C.warn;
  return C.bad;
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.textFaint, fontFamily: FM, marginBottom: 3, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ fontSize: 13, color: C.text }}>{value}</div>
    </div>
  );
}

function Quote({ label, body }: { label: string; body?: string }) {
  if (!body) return null;
  return (
    <div
      style={{
        padding: 12,
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 11, color: C.textFaint, fontFamily: FM, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.text, fontStyle: "italic" }}>&ldquo;{body}&rdquo;</div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="v-page-pad"
      style={{
        maxWidth: 540,
        margin: "0 auto",
        textAlign: "center",
        paddingTop: 80,
      }}
    >
      {children}
    </div>
  );
}
