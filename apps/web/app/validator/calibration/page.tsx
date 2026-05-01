"use client";

import {
  Bar,
  C,
  type CalibVersion,
  Card,
  FM,
  Frame,
  Pill,
  WeightChart,
} from "../_components/ui";

// Screen 7: Calibration deep view. Maps to ScreenCalibrationV21 in
// screens-v2.jsx. Per spec §5: 3-track calibration infra (Stagehand /
// Human SUS / Analytics) + per-dimension correlation table + weight
// evolution chart.

const VERSIONS: CalibVersion[] = [
  { v: "v1.0", d: "2026-01", hap: 0.25, eng: 0.3,  tsk: 0.3,  ado: 0.1,  ret: 0.05 },
  { v: "v1.1", d: "2026-02", hap: 0.24, eng: 0.32, tsk: 0.31, ado: 0.09, ret: 0.04 },
  { v: "v1.2", d: "2026-03", hap: 0.22, eng: 0.36, tsk: 0.33, ado: 0.06, ret: 0.03 },
  { v: "v1.3", d: "2026-04", hap: 0.2,  eng: 0.42, tsk: 0.36, ado: 0.05, ret: 0.03, current: true },
];

const CORRELATIONS = [
  { d: "Engagement", v: 0.78, conf: "High",        change: "+0.06" },
  { d: "Sentiment",  v: 0.65, conf: "Medium-High", change: "+0.04" },
  { d: "Onboarding", v: 0.71, conf: "High",        change: "+0.03" },
  { d: "Discovery",  v: 0.38, conf: "Low-Medium",  change: "+0.05" },
  { d: "Retention",  v: 0.18, conf: "Low",         change: "−0.01" },
];

const TRACKS = [
  { k: "Track A · Stagehand", v: "1,400" },
  { k: "Track B · Human SUS", v: "347" },
  { k: "Track C · Analytics", v: "100" },
];

export default function ValidatorCalibrationPage() {
  return (
    <Frame active="calibration">
      <div style={{ padding: "24px 32px 32px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 18,
          }}
        >
          <div>
            <Pill style={{ marginBottom: 8 }}>Service info · Q1 2026</Pill>
            <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Calibration & Service Information
            </h1>
            <div style={{ fontSize: 13, color: C.textDim, marginTop: 4 }}>
              Model accuracy · persona dataset · weight evolution · 1,847 records
            </div>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            {TRACKS.map((t) => (
              <div key={t.k} style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: C.textFaint, fontFamily: FM }}>{t.k}</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    fontFamily: FM,
                    marginTop: 2,
                  }}
                >
                  {t.v}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Card padding={18} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            Model accuracy · LLM inference vs ground truth
          </div>
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 14 }}>
            Pearson correlation. ≥0.7 strong / 0.4–0.7 medium / &lt;0.4 still
            calibrating.
          </div>
          {CORRELATIONS.map((c, i) => (
            <div
              key={c.d}
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 0.7fr 3fr 0.6fr",
                alignItems: "center",
                gap: 14,
                padding: "12px 0",
                borderTop: i ? `1px solid ${C.border}` : "none",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500 }}>{c.d}</div>
              <div>
                <Pill tone={c.v >= 0.7 ? "ok" : c.v >= 0.4 ? "warn" : "bad"}>{c.conf}</Pill>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Bar
                  value={c.v * 100}
                  color={c.v >= 0.7 ? C.ok : c.v >= 0.4 ? C.warn : C.bad}
                  bg="#f3f0e8"
                  height={6}
                />
                <span
                  style={{
                    fontFamily: FM,
                    fontSize: 12,
                    fontWeight: 600,
                    minWidth: 38,
                  }}
                >
                  {c.v.toFixed(2)}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: FM,
                  color: c.change.startsWith("+") ? C.ok : C.bad,
                  textAlign: "right",
                }}
              >
                {c.change}
              </div>
            </div>
          ))}
        </Card>

        <Card padding={18}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            Weight evolution v1.0 → v1.3
          </div>
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 18 }}>
            Dimensions with stronger validation gain weight automatically.
            Engagement +40%, Onboarding +20%.
          </div>
          <WeightChart versions={VERSIONS} />
        </Card>
      </div>
    </Frame>
  );
}
