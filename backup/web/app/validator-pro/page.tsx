"use client";

import { Btn, C, FM, FS, Frame, Pill } from "../_components/ui";

// Screen 6: Pro mode. Maps to ScreenProMode in screens-v2.jsx.
// Spec §1.5: AARRR funnel + daily monitoring + custom cohorts.
//
// Phase 2-E: AARRR funnel now ships in every Mode A report's Pro
// section (see /validator/report/[scanId]). Daily monitoring +
// custom cohorts deferred to Phase 3.

const STAGES = [
  { t: "Acquisition", sub: "How they reached you" },
  { t: "Activation", sub: "Aha moment reached" },
  { t: "Retention", sub: "D-1 / D-3 / D-7 / D-30" },
  { t: "Referral", sub: "Likelihood to recommend" },
  { t: "Revenue", sub: "Conversion likelihood" },
];

export default function ValidatorProModePage() {
  return (
    <Frame active="pro">
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 40,
          minHeight: "calc(100vh - 52px)",
        }}
      >
        <div style={{ maxWidth: 560, textAlign: "center", fontFamily: FS }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚗</div>
          <Pill tone="exp" style={{ marginBottom: 16 }}>
            Pro mode · AARRR live
          </Pill>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              margin: "0 0 12px",
            }}
          >
            AARRR funnel<br />
            shipped in every Mode A report
          </h1>
          <p
            style={{
              fontSize: 14,
              color: C.textDim,
              lineHeight: 1.6,
              marginBottom: 24,
            }}
          >
            Acquisition → Activation → Retention → Referral → Revenue —
            derived from per-persona dimension scores, no extra LLM cost.
            Daily monitoring + custom cohorts + Slack alerts arrive next.
          </p>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 18,
              background: C.expSoft,
              borderRadius: 10,
              border: "1px solid #dcd1f0",
              textAlign: "left",
            }}
          >
            {STAGES.map((s, i) => (
              <div
                key={s.t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 0",
                  borderTop: i ? "1px solid #dcd1f0" : "none",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 999,
                    background: C.exp,
                    color: "#fff",
                    fontSize: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: FM,
                    fontWeight: 600,
                  }}
                >
                  {i + 1}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: C.text,
                    width: 100,
                  }}
                >
                  {s.t}
                </span>
                <span style={{ fontSize: 12, color: C.textDim }}>{s.sub}</span>
              </div>
            ))}
          </div>
          <Btn primary href="/validator/report/demo" style={{ marginTop: 20 }}>
            See AARRR in demo report →
          </Btn>
        </div>
      </div>
    </Frame>
  );
}
