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
  WeightChart,
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
            <Pill style={{ marginBottom: 8 }}>
              Service info · {report.period_start} → {report.period_end}
            </Pill>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 600,
                margin: 0,
                letterSpacing: "-0.01em",
              }}
            >
              Calibration & Service Information
            </h1>
            <div style={{ fontSize: 13, color: C.textDim, marginTop: 4 }}>
              Model accuracy · persona dataset · weight evolution ·{" "}
              {report.totalRecords.toLocaleString()} records
            </div>
          </div>
          <div style={{ display: "flex", gap: 14 }}>
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

        <Card padding={18}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
            Weight evolution {report.versions[0]?.v} →{" "}
            {report.versions[report.versions.length - 1]?.v}
          </div>
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 18 }}>
            Dimensions with stronger validation gain weight automatically.
            Phase 2-C-2 will derive these from per-quarter calibration runs
            instead of the hardcoded sequence.
          </div>
          <WeightChart versions={report.versions} />
        </Card>
      </div>
    </Frame>
  );
}
