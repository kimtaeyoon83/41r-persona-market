"use client";

import { useEffect, useState } from "react";
import { calibrationApi, type CalibrationReport } from "@/lib/api";
import {
  Bar,
  C,
  Card,
  FM,
  Frame,
  Pill,
} from "../_components/ui";

// Screen 7: Calibration deep view. Maps to ScreenCalibrationV21 in
// screens-v2.jsx. Per spec §5: 3-track calibration infra (Stagehand /
// Human SUS / Analytics) + per-dimension correlation table + weight
// evolution chart.
//
// Phase 2-C-1: hydrated from GET /api/calibration/current. Empty
// state shown when calibration_records is empty (run
// scripts/seed-calibration.ts to populate the demo dataset).

export default function ValidatorCalibrationPage() {
  const [report, setReport] = useState<CalibrationReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    calibrationApi
      .getCurrent()
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Frame active="calibration">
        <div
          style={{
            padding: "80px 32px",
            textAlign: "center",
            color: C.textDim,
          }}
        >
          Loading calibration…
        </div>
      </Frame>
    );
  }

  if (error || !report) {
    return (
      <Frame active="calibration">
        <div
          style={{
            padding: "80px 32px",
            textAlign: "center",
            color: C.bad,
          }}
        >
          {error ?? "Calibration data unavailable"}
        </div>
      </Frame>
    );
  }

  return (
    <Frame active="calibration">
      <div className="v-page-pad">
        <div
          className="v-stack-sm"
          style={{
            justifyContent: "space-between",
            marginBottom: 18,
            gap: 14,
          }}
        >
          <div>
            <Pill style={{ marginBottom: 8 }}>
              Service info · {report.period_start} → {report.period_end}
            </Pill>
            <h1
              style={{
                fontSize: "clamp(20px, 5vw, 24px)",
                fontWeight: 600,
                margin: 0,
                letterSpacing: "-0.01em",
                wordBreak: "keep-all",
              }}
            >
              Calibration & Service Information
            </h1>
            <div style={{ fontSize: 13, color: C.textDim, marginTop: 4 }}>
              Model accuracy · persona dataset · weight evolution ·{" "}
              {report.totalRecords.toLocaleString()} records
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {report.tracks.map((t) => (
              <div key={t.key} style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 10,
                    color: C.textFaint,
                    fontFamily: FM,
                  }}
                >
                  {t.key}
                </div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    fontFamily: FM,
                    marginTop: 2,
                  }}
                >
                  {t.n.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Reality check — n=1 sanity baseline against Google Merchandise
            Store via GA4 BigQuery. Frozen from 2026-05-06 verification run.
            Update when re-running against new sites or after Acquisition
            Layer (v1.1) ships. */}
        <Card padding={20} style={{ marginBottom: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: 6,
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              Reality Check · n=1 baseline
            </div>
            <div style={{ fontSize: 11, fontFamily: FM, color: C.textFaint }}>
              Google Merch Store · GA4 2020-21 · 270K users
            </div>
          </div>
          <p style={{ fontSize: 12, color: C.textDim, lineHeight: 1.6, margin: "0 0 12px" }}>
            Single-site sanity check (not a statistical calibration). 41R
            Mode A inference compared against real GA4 data via 7 pre-defined
            plausibility hypotheses.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                padding: 12,
                background: C.okSoft,
                border: `1px solid ${C.ok}33`,
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 11, fontFamily: FM, color: C.ok, fontWeight: 600, letterSpacing: "0.06em", marginBottom: 6 }}>
                ✓ NUMERICAL MATCH (2/7)
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: C.text }}>
                <li>Site classifier: E-commerce 0.98 ✓</li>
                <li>Retention D-7: 41R 5.1 vs GA4 7.67 (1.5× gap)</li>
              </ul>
            </div>
            <div
              style={{
                padding: 12,
                background: "#f3f0e8",
                border: `1px solid ${C.border}`,
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 11, fontFamily: FM, color: C.textDim, fontWeight: 600, letterSpacing: "0.06em", marginBottom: 6 }}>
                ≈ DIRECTIONAL MATCH (2/7)
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: C.text }}>
                <li>Cohort discrimination: niche cohort lowest ✓</li>
                <li>Friction surface: account creation, hidden costs ✓</li>
              </ul>
            </div>
            <div
              style={{
                padding: 12,
                background: C.warnSoft,
                border: `1px solid ${C.warn}33`,
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 11, fontFamily: FM, color: C.warn, fontWeight: 600, letterSpacing: "0.06em", marginBottom: 6 }}>
                ⚠ KNOWN GAP (3/7)
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: C.text }}>
                <li>Engagement: 41R 0% abandon vs GA4 51%</li>
                <li>Task success: 67/100 vs 1.64% (intent ≠ action)</li>
                <li>AARRR activation: 95% vs 23% (no acq layer)</li>
              </ul>
            </div>
          </div>

          <p style={{ fontSize: 11, color: C.textFaint, lineHeight: 1.55, margin: 0 }}>
            <b style={{ color: C.text }}>Why the gaps:</b> 41R simulates
            engaged-audience reactions, not visitor traffic distribution. The
            abandon population (~50% of real users) is not modeled. The{" "}
            <b style={{ color: C.text }}>Acquisition Layer (v1.1)</b> in
            development will weight cohorts by site-realistic arrival shares
            to narrow the engagement / activation gaps. Intent-action gap
            (~10×) is fundamental to persona-conditional measurement.
          </p>
        </Card>

        {report.totalRecords === 0 && (
          <Card padding={24} style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                marginBottom: 6,
                color: C.warn,
              }}
            >
              No calibration records yet
            </div>
            <div
              style={{
                fontSize: 12,
                color: C.textDim,
                lineHeight: 1.55,
              }}
            >
              Track A (Stagehand) records will populate weekly once the
              calibration cron lands in Phase 2-C-2. Until then, run{" "}
              <code style={{ fontFamily: FM, fontSize: 11 }}>
                pnpm tsx scripts/seed-calibration.ts
              </code>{" "}
              against your local DB to insert the demo dataset (~600
              records spanning Q1 2026).
            </div>
          </Card>
        )}

        <Card padding={18} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            Model accuracy · LLM inference vs ground truth
          </div>
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 14 }}>
            Pearson correlation. ≥0.7 strong / 0.4–0.7 medium / &lt;0.4 still
            calibrating.
          </div>
          {report.correlations.map((c, i) => {
            const r = c.correlation;
            const tone =
              r === null
                ? "neutral"
                : r >= 0.7
                ? "ok"
                : r >= 0.4
                ? "warn"
                : "bad";
            const color =
              tone === "ok"
                ? C.ok
                : tone === "warn"
                ? C.warn
                : tone === "bad"
                ? C.bad
                : C.textFaint;
            return (
              <div
                key={c.dimension}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 0.7fr 3fr 0.6fr",
                  alignItems: "center",
                  gap: 14,
                  padding: "12px 0",
                  borderTop: i ? `1px solid ${C.border}` : "none",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {c.dimension}
                  <span
                    style={{
                      fontSize: 11,
                      color: C.textFaint,
                      marginLeft: 6,
                      fontFamily: FM,
                    }}
                  >
                    n={c.n}
                  </span>
                </div>
                <div>
                  <Pill tone={tone === "neutral" ? undefined : tone}>
                    {c.confidence}
                  </Pill>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Bar
                    value={r === null ? 0 : Math.abs(r) * 100}
                    color={color}
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
                    {r === null ? "—" : r.toFixed(2)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: FM,
                    color: c.change.startsWith("+")
                      ? C.ok
                      : c.change.startsWith("−")
                      ? C.bad
                      : C.textFaint,
                    textAlign: "right",
                  }}
                >
                  {c.change}
                </div>
              </div>
            );
          })}
        </Card>

        {/* Weight evolution chart removed — was driven by hardcoded
            placeholder versions in services/calibration/aggregator.ts
            (DEFAULT_VERSIONS) that don't match what scoring actually
            uses. Restore once Phase 2-C-2 retraining cron writes a
            real calibration_versions history. */}
      </div>
    </Frame>
  );
}
