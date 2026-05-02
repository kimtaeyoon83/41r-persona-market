"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { scanApi, type ScanPersonaDetail } from "@/lib/api";
import { Bar, C, Card, FM, FS, Frame, Pill } from "../../_components/ui";

// Screen 5: Persona drill-down. Reads
// /api/scan/:scanId/persona/:personaId — pass scanId via the
// `?scan=<scanId>` query string (the report screen sets this when
// it links each PersonaBoard card). When scanId is absent we
// render a friendly hint pointing back to a report.

function fitTone(score: number | null): "ok" | "warn" | "bad" {
  if (score == null) return "warn";
  if (score >= 65) return "ok";
  if (score >= 40) return "warn";
  return "bad";
}

function fitLabel(score: number | null): string {
  if (score == null) return "no data";
  if (score >= 65) return "Strong fit";
  if (score >= 40) return "Mixed";
  return "Strong misfit";
}

function PersonaInner() {
  const params = useParams();
  const search = useSearchParams();
  const personaId = (params?.id as string) || "";
  const scanId = search.get("scan");

  const [data, setData] = useState<ScanPersonaDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scanId || !personaId) return;
    let cancelled = false;
    scanApi
      .getPersona(scanId, personaId)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load persona");
      });
    return () => {
      cancelled = true;
    };
  }, [scanId, personaId]);

  if (!scanId) {
    return (
      <Frame active="report">
        <div style={{ padding: 32 }}>
          <Pill tone="warn">Missing scan context</Pill>
          <div style={{ marginTop: 12, fontSize: 13, color: C.textDim }}>
            Open a persona from a report card. Direct links require
            <code style={{ fontFamily: FM, marginLeft: 4 }}>?scan=&lt;scanId&gt;</code>.
          </div>
        </div>
      </Frame>
    );
  }

  if (error) {
    return (
      <Frame active="report">
        <div style={{ padding: 32 }}>
          <Pill tone="bad">Error</Pill>
          <div style={{ marginTop: 8, fontSize: 13, color: C.bad }}>{error}</div>
          <Link
            href={`/validator/report/${scanId}`}
            style={{ fontSize: 12, color: C.accent, marginTop: 12, display: "inline-block" }}
          >
            ← Back to report
          </Link>
        </div>
      </Frame>
    );
  }

  if (!data) {
    return (
      <Frame active="report">
        <div style={{ padding: 32, color: C.textFaint, fontSize: 13 }}>
          Loading persona…
        </div>
      </Frame>
    );
  }

  const { persona, response, scan } = data;
  const present = [response.happiness, response.engagement, response.task_success].filter(
    (v): v is number => v != null
  );
  const fitScore =
    present.length === 0
      ? null
      : Math.round(present.reduce((a, b) => a + b, 0) / present.length);
  const tone = fitTone(fitScore);
  const initials = persona.display_name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("") || "?";

  // Per-dimension snapshot — NOT a page-step funnel. We don't track
  // per-page actions; spec §4 measures outcomes (engagement band,
  // task_success likelihood, etc.) so each chip here is a dimension
  // score, not a behavioural step the user did or did not reach.
  const dimensionSnapshot = [
    { label: "Engagement", v: response.engagement },
    { label: "Task", v: response.task_success },
    { label: "Happiness", v: response.happiness },
    { label: "Adoption", v: response.adoption },
    { label: "Retention D-7", v: response.retention_d7 },
  ];

  const sus = response.sus_responses ?? [];
  const susScore = response.sus_raw_score;

  const metrics = [
    {
      l: "Onboarding",
      v: response.signup_likelihood,
      asPct: true,
      sub: response.is_flagged ? "Flagged response" : "Sign-up likelihood",
    },
    {
      l: "Completion",
      v: response.completion_likelihood,
      asPct: true,
      sub: "Task likelihood",
    },
    {
      l: "Happiness",
      v: response.happiness != null ? response.happiness / 100 : null,
      asPct: true,
      sub: "SUS aggregate",
    },
    {
      l: "Return D-7",
      v: response.retention_d7 != null ? response.retention_d7 / 100 : null,
      asPct: true,
      sub: "Likelihood to return",
    },
  ];

  function metricTone(v: number | null): string {
    if (v == null) return C.textFaint;
    if (v >= 0.6) return C.ok;
    if (v >= 0.3) return C.warn;
    return C.bad;
  }

  return (
    <Frame active="report">
      <div style={{ padding: "24px 32px 32px" }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 18,
            alignItems: "center",
            fontSize: 12,
            color: C.textFaint,
          }}
        >
          <Link
            href={`/validator/report/${scan.id}`}
            style={{ color: C.textFaint, textDecoration: "none" }}
          >
            ← Report
          </Link>
          <span>/</span>
          <span style={{ color: C.textDim }}>Persona Resonance</span>
          <span>/</span>
          <span style={{ color: C.text, fontWeight: 500 }}>
            {persona.display_name}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 18 }}>
          <Card padding={18}>
            <div
              style={{
                width: "100%",
                aspectRatio: "1",
                borderRadius: 10,
                background: "linear-gradient(135deg,#f3e2d4,#e6d4c0)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 48,
                marginBottom: 14,
                color: C.accent,
                fontWeight: 600,
                fontFamily: FM,
              }}
            >
              {initials}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {persona.display_name}{" "}
              <span style={{ fontSize: 11, color: C.textFaint, fontWeight: 400 }}>
                (synthetic)
              </span>
            </div>
            <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
              {persona.age} · {persona.cohort_label}
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Pill tone={tone}>
                {fitLabel(fitScore)} · {fitScore ?? "—"}
              </Pill>
              {response.is_flagged && <Pill tone="bad">Flagged</Pill>}
            </div>

            {persona.vector_axes.length > 0 && (
              <div
                style={{
                  marginTop: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {persona.vector_axes.map((a) => (
                  <div key={a.k} style={{ fontSize: 11 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ color: C.textDim, fontFamily: FM }}>
                        {a.k}
                      </span>
                      <span style={{ fontFamily: FM }}>{a.v.toFixed(2)}</span>
                    </div>
                    <Bar
                      value={a.v * 100}
                      color={C.accent}
                      bg="#f3f0e8"
                      height={3}
                    />
                  </div>
                ))}
              </div>
            )}

            {persona.voice_sample && (
              <div
                style={{
                  marginTop: 14,
                  padding: 10,
                  background: "#f7f4ec",
                  borderRadius: 6,
                  fontSize: 11,
                  color: C.textDim,
                  lineHeight: 1.55,
                }}
              >
                <b style={{ color: C.text }}>Persona personality</b>
                <span
                  style={{
                    fontSize: 10,
                    color: C.textFaint,
                    fontFamily: FM,
                    marginLeft: 6,
                  }}
                >
                  pre-defined trait, not a scan response
                </span>
                <br />
                &ldquo;{persona.voice_sample}&rdquo;
              </div>
            )}
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card padding={16}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 4,
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                }}
              >
                <span>Dimension snapshot</span>
                <span
                  style={{
                    fontSize: 11,
                    color: C.textFaint,
                    fontWeight: 400,
                    fontFamily: FM,
                  }}
                >
                  per-axis score · not a step funnel
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 10,
                  flexWrap: "wrap",
                }}
              >
                {dimensionSnapshot.map((s, i) => {
                  const v = s.v;
                  const stepTone =
                    v == null ? "neutral" : v >= 60 ? "ok" : v >= 30 ? "warn" : "bad";
                  const fg =
                    stepTone === "ok"
                      ? C.ok
                      : stepTone === "warn"
                      ? C.warn
                      : stepTone === "bad"
                      ? C.bad
                      : C.textFaint;
                  const bg =
                    stepTone === "ok"
                      ? C.okSoft
                      : stepTone === "warn"
                      ? C.warnSoft
                      : stepTone === "bad"
                      ? C.badSoft
                      : "#f3f0e8";
                  const bd =
                    stepTone === "ok"
                      ? "#cfe3d6"
                      : stepTone === "warn"
                      ? "#ecdcb4"
                      : stepTone === "bad"
                      ? "#eccac4"
                      : "#e6e2d6";
                  return (
                    <div key={s.label} style={{ display: "flex", alignItems: "center" }}>
                      <div
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 500,
                          background: bg,
                          color: fg,
                          border: `1px solid ${bd}`,
                        }}
                      >
                        {s.label}{" "}
                        <span style={{ fontFamily: FM, opacity: 0.7 }}>
                          {v == null ? "—" : Math.round(v)}
                        </span>
                      </div>
                      {i < dimensionSnapshot.length - 1 && (
                        <span style={{ color: C.textFaint, margin: "0 4px" }}>·</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card padding={16}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 10,
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  Sentiment · SUS 10 questions
                </div>
                <div style={{ fontFamily: FM, fontSize: 13 }}>
                  raw {susScore != null ? Math.round(susScore) : "—"} / 100
                </div>
              </div>
              {sus.length === 0 ? (
                <div style={{ fontSize: 12, color: C.textFaint, padding: "20px 0" }}>
                  SUS responses not available for this row.
                </div>
              ) : (
                <div
                  style={{
                    display: "flex",
                    gap: 4,
                    marginBottom: 10,
                    alignItems: "flex-end",
                    height: 48,
                  }}
                >
                  {sus.map((s, i) => (
                    <div key={i} style={{ flex: 1 }}>
                      <div
                        style={{
                          height: s * 8 + 6,
                          background: s >= 4 ? C.ok : s >= 3 ? C.warn : C.bad,
                          borderRadius: 3,
                          marginBottom: 4,
                        }}
                      />
                      <div
                        style={{
                          fontSize: 9,
                          fontFamily: FM,
                          color: C.textFaint,
                          textAlign: "center",
                        }}
                      >
                        Q{i + 1}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {response.voice_first_impression && (
                <div
                  style={{
                    padding: 10,
                    background: "#f7f4ec",
                    borderLeft: `2px solid ${C.accent}`,
                    fontSize: 12,
                    fontStyle: "italic",
                    color: C.text,
                    lineHeight: 1.55,
                  }}
                >
                  &ldquo;{response.voice_first_impression}&rdquo;
                </div>
              )}
            </Card>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 10,
              }}
            >
              {metrics.map((m) => {
                const display =
                  m.v == null
                    ? "—"
                    : m.asPct
                    ? `${Math.round(m.v * 100)}%`
                    : String(Math.round(m.v));
                return (
                  <Card key={m.l} padding={12}>
                    <div
                      style={{
                        fontSize: 10,
                        color: C.textFaint,
                        fontFamily: FM,
                        letterSpacing: "0.06em",
                      }}
                    >
                      {m.l.toUpperCase()}
                    </div>
                    <div
                      style={{
                        fontSize: 18,
                        fontWeight: 600,
                        color: metricTone(m.v),
                        marginTop: 4,
                        fontFamily: FM,
                      }}
                    >
                      {display}
                    </div>
                    <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
                      {m.sub}
                    </div>
                  </Card>
                );
              })}
            </div>

            {response.voice_biggest_friction && (
              <Card padding={14} style={{ background: C.badSoft, borderColor: "#eccac4" }}>
                <div
                  style={{
                    fontSize: 11,
                    color: C.bad,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 6,
                    fontWeight: 600,
                    fontFamily: FS,
                  }}
                >
                  Biggest friction
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.text,
                    lineHeight: 1.55,
                    fontStyle: "italic",
                  }}
                >
                  &ldquo;{response.voice_biggest_friction}&rdquo;
                </div>
              </Card>
            )}

            {response.voice_would_return_because && (
              <Card padding={14} style={{ background: C.okSoft, borderColor: "#cfe3d6" }}>
                <div
                  style={{
                    fontSize: 11,
                    color: C.ok,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 6,
                    fontWeight: 600,
                    fontFamily: FS,
                  }}
                >
                  Would return because
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: C.text,
                    lineHeight: 1.55,
                    fontStyle: "italic",
                  }}
                >
                  &ldquo;{response.voice_would_return_because}&rdquo;
                </div>
              </Card>
            )}

            <Card padding={14} style={{ background: "#fbf8f0", borderColor: "#ecdcb4" }}>
              <div
                style={{
                  fontSize: 11,
                  color: C.warn,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 6,
                  fontWeight: 600,
                  fontFamily: FS,
                }}
              >
                Trust contract
              </div>
              <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.55 }}>
                Response generated from PersonaVector + site captures via a single
                Sonnet vision call.{" "}
                <span style={{ fontFamily: FM }}>
                  scan {scan.id.slice(0, 8)} · persona {persona.id.slice(0, 8)}
                </span>{" "}
                ·{" "}
                <span style={{ color: C.text }}>
                  AI persona inference, not actual user testimony.
                </span>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </Frame>
  );
}

export default function ValidatorPersonaDetailPage() {
  return (
    <Suspense
      fallback={
        <Frame active="report">
          <div style={{ padding: 32, color: C.textFaint, fontSize: 13 }}>
            Loading persona…
          </div>
        </Frame>
      }
    >
      <PersonaInner />
    </Suspense>
  );
}
