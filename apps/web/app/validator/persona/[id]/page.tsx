"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import React from "react";
import { Bar, C, Card, FM, FS, Frame, Pill } from "../../_components/ui";

// Screen 5: Persona drill-down. Maps to ScreenPersonaDetail in
// screens-v2.jsx. Phase 0 ships with one shared demo profile;
// Phase 1 hydrates per-id from /api/scan/:scanId/persona/:id.

const VECTOR_AXES = [
  { k: "tech_literacy", v: 0.42 },
  { k: "crypto_experience", v: 0.05 },
  { k: "price_sensitivity", v: 0.88 },
  { k: "mobile_first", v: 0.95 },
  { k: "risk_tolerance", v: 0.3 },
  { k: "english_fluency", v: 0.45 },
];

const SUS = [4, 2, 5, 3, 4, 2, 4, 3, 4, 3];

const METRICS = [
  { l: "Onboarding", v: "8%", tone: C.bad, sub: "Wallet connect failed" },
  { l: "Time to Aha", v: "—", tone: C.bad, sub: "Did not reach" },
  { l: "Discovery", v: "0", tone: C.bad, sub: "No further exploration" },
  { l: "Return Intent", v: "5%", tone: C.bad, sub: "no_return" },
];

export default function ValidatorPersonaDetailPage() {
  const params = useParams();
  const id = (params?.id as string) || "p_jiwon";

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
            href="/validator/report/demo"
            style={{ color: C.textFaint, textDecoration: "none" }}
          >
            ← Report
          </Link>
          <span>/</span>
          <span style={{ color: C.textDim }}>Persona Resonance</span>
          <span>/</span>
          <span style={{ color: C.text, fontWeight: 500 }}>{id} · Jiwon L.</span>
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
              JL
            </div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              Jiwon L.{" "}
              <span style={{ fontSize: 11, color: C.textFaint, fontWeight: 400 }}>
                (synthetic)
              </span>
            </div>
            <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
              16 · High school student · Seoul · Mobile
            </div>
            <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Pill tone="bad">Strong misfit · 21</Pill>
            </div>

            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              {VECTOR_AXES.map((a) => (
                <div key={a.k} style={{ fontSize: 11 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 2,
                    }}
                  >
                    <span style={{ color: C.textDim, fontFamily: FM }}>{a.k}</span>
                    <span style={{ fontFamily: FM }}>{a.v.toFixed(2)}</span>
                  </div>
                  <Bar value={a.v * 100} color={C.accent} bg="#f3f0e8" height={3} />
                </div>
              ))}
            </div>

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
              <b style={{ color: C.text }}>Voice sample.</b>
              <br />
              &ldquo;If my friends use it, I will too. I don&apos;t like
              difficult things.&rdquo;
            </div>
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card padding={16}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                Session journey
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {["Land", "Hero", "Feature", "Wallet?", "Abandon"].map((s, i) => (
                  <React.Fragment key={s}>
                    <div
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 500,
                        background: i < 3 ? C.okSoft : i === 3 ? C.warnSoft : C.badSoft,
                        color: i < 3 ? C.ok : i === 3 ? C.warn : C.bad,
                        border: `1px solid ${
                          i < 3 ? "#cfe3d6" : i === 3 ? "#ecdcb4" : "#eccac4"
                        }`,
                      }}
                    >
                      {s}
                    </div>
                    {i < 4 && <span style={{ color: C.textFaint }}>→</span>}
                  </React.Fragment>
                ))}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}>
                  14s · 1 click
                </span>
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
                <div style={{ fontFamily: FM, fontSize: 13 }}>raw 35 / 100</div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  marginBottom: 10,
                  alignItems: "flex-end",
                  height: 48,
                }}
              >
                {SUS.map((s, i) => (
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
              <div
                style={{
                  padding: 10,
                  background: "#f7f4ec",
                  borderLeft: `2px solid ${C.accent}`,
                  fontSize: 12,
                  fontStyle: "italic",
                }}
              >
                &ldquo;I have no idea what this site does. Too much English, too
                many unfamiliar words.&rdquo;
              </div>
            </Card>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 10,
              }}
            >
              {METRICS.map((m) => (
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
                      color: m.tone,
                      marginTop: 4,
                      fontFamily: FM,
                    }}
                  >
                    {m.v}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
                    {m.sub}
                  </div>
                </Card>
              ))}
            </div>

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
                Response generated from PersonaVector + 8 site captures via a single
                Sonnet vision call.
                <span style={{ fontFamily: FM }}> trace_id 8a3f-04a1</span> ·{" "}
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
