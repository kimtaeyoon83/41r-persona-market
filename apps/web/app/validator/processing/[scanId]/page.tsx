"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { scanApi, type ScanReport } from "@/lib/api";
import { C, Card, FM, Frame, Pill } from "../../_components/ui";

// Screen 3: Processing — live persona stream + cohort progress.
// Polls /api/scan/:id/report every 800ms; drives the dot grid +
// cohort progress bars + recent-response feed from the live data.
// Auto-redirects to /validator/report/:scanId on status='completed'.

const STATUS_LABELS: Record<string, string> = {
  pending: "Queued",
  capturing: "Capturing site",
  sampling: "Selecting personas",
  responding: "Personas reacting",
  aggregating: "Aggregating cohorts",
  completed: "Complete",
  failed: "Failed",
};

function sentimentTone(s: "positive" | "mixed" | "friction"): "ok" | "warn" | "bad" {
  return s === "positive" ? "ok" : s === "mixed" ? "warn" : "bad";
}

function sentimentEmo(s: "positive" | "mixed" | "friction"): string {
  return s === "positive" ? "😊" : s === "mixed" ? "🤔" : "😣";
}

function timeAgo(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  if (ms < 1500) return "now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return `${m}m`;
}

function ProcessingInner() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const scanId = (params?.scanId as string) || "demo";
  const url = search.get("url") || "yoursite.com";

  const [report, setReport] = useState<ScanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const cancelled = useRef(false);

  // Live polling — same cadence as the report screen so the two
  // hand off cleanly when status transitions to 'completed'.
  useEffect(() => {
    cancelled.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fetchOnce = async () => {
      try {
        const r = await scanApi.getReport(scanId);
        if (cancelled.current) return;
        setReport(r);
        if (r.scan.status === "completed") {
          router.replace(`/validator/report/${scanId}`);
          return;
        }
        if (r.scan.status !== "failed") {
          timer = setTimeout(fetchOnce, 800);
        }
      } catch (e) {
        if (cancelled.current) return;
        setError(e instanceof Error ? e.message : "Failed to load scan");
        timer = setTimeout(fetchOnce, 2000);
      }
    };
    fetchOnce();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      cancelled.current = true;
      if (timer) clearTimeout(timer);
      clearInterval(tick);
    };
  }, [scanId, router]);

  if (error && !report) {
    return (
      <Frame active="discovery">
        <div style={{ padding: 32 }}>
          <Pill tone="bad">Error</Pill>
          <div style={{ marginTop: 8, fontSize: 13, color: C.bad }}>{error}</div>
        </div>
      </Frame>
    );
  }

  if (!report) {
    return (
      <Frame active="discovery">
        <div style={{ padding: 32, color: C.textFaint, fontSize: 13 }}>
          Loading scan…
        </div>
      </Frame>
    );
  }

  const { scan, recent_responses, cohort_progress } = report;
  const done = scan.personas_completed;
  // 113 ≈ Mode A target (8 cohorts × 14 + 1). Mode B uses whatever
  // the worker decides — fall back to attempted or done so the dot
  // grid never overshoots.
  const total =
    scan.personas_attempted > 0
      ? scan.personas_attempted
      : scan.mode === "A"
      ? 113
      : Math.max(done, 1);
  const isWorking =
    scan.status !== "completed" && scan.status !== "failed";
  const queued = Math.max(total - done, 0);

  return (
    <Frame active="discovery">
      <div className="v-page-pad">
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              margin: 0,
              letterSpacing: "-0.01em",
            }}
          >
            Analyzing {url}
          </h1>
          <span style={{ fontSize: 13, color: C.textDim, fontFamily: FM }}>
            {done} / {total} · scan {scanId.slice(0, 8)}
          </span>
          <div style={{ flex: 1 }} />
          <Pill tone={scan.status === "failed" ? "bad" : "accent"}>
            {scan.status === "failed" ? "✕" : "⚡"}{" "}
            {STATUS_LABELS[scan.status] ?? scan.status}
          </Pill>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.4fr",
            gap: 14,
            marginBottom: 14,
          }}
        >
          <Card padding={16}>
            <div
              style={{
                fontSize: 11,
                color: C.textFaint,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 12,
              }}
            >
              Personas in flight · {total}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(12, 1fr)",
                gap: 4,
              }}
            >
              {Array.from({ length: total }).map((_, i) => {
                const status =
                  i < done
                    ? "done"
                    : i === done && isWorking
                    ? "running"
                    : "queued";
                const bg =
                  status === "done"
                    ? C.ok
                    : status === "running"
                    ? C.accent
                    : "#e6e2d6";
                return (
                  <div
                    key={i}
                    style={{
                      aspectRatio: "1",
                      borderRadius: "50%",
                      background: bg,
                      opacity: status === "queued" ? 0.5 : 1,
                      boxShadow:
                        status === "running"
                          ? `0 0 0 2px ${C.accentSoft}`
                          : "none",
                      animation:
                        status === "running"
                          ? "validatorPulse 1.4s ease-in-out infinite"
                          : "none",
                    }}
                  />
                );
              })}
            </div>
            <style>{`@keyframes validatorPulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
            <div
              style={{
                display: "flex",
                gap: 14,
                marginTop: 14,
                fontSize: 11,
                color: C.textDim,
              }}
            >
              <span>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: C.ok,
                    marginRight: 6,
                    verticalAlign: "middle",
                  }}
                />
                Done {done}
              </span>
              <span>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: "#d4cfc1",
                    marginRight: 6,
                    verticalAlign: "middle",
                  }}
                />
                Queued {queued}
              </span>
              {scan.personas_flagged > 0 && (
                <span>
                  <span
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: 999,
                      background: C.bad,
                      marginRight: 6,
                      verticalAlign: "middle",
                    }}
                  />
                  Flagged {scan.personas_flagged}
                </span>
              )}
            </div>
          </Card>

          <Card padding={16}>
            <div
              style={{
                fontSize: 11,
                color: C.textFaint,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 12,
              }}
            >
              Cohort progress · {cohort_progress.length} live
            </div>
            {cohort_progress.length === 0 ? (
              <div style={{ fontSize: 12, color: C.textFaint, padding: "20px 0" }}>
                Waiting for first persona response…
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {cohort_progress.map((c) => {
                  const pct = Math.min(
                    100,
                    Math.round((c.n_completed / Math.max(c.n_target, 1)) * 100)
                  );
                  const colour =
                    pct >= 100 ? C.ok : pct >= 50 ? C.accent : C.warn;
                  return (
                    <div
                      key={c.cohort_id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          width: 130,
                          fontSize: 12,
                          color: C.textDim,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={c.cohort_label}
                      >
                        {c.cohort_label}
                      </div>
                      <div
                        style={{
                          flex: 1,
                          position: "relative",
                          height: 22,
                          background: "#f3f0e8",
                          borderRadius: 4,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            height: "100%",
                            width: `${pct}%`,
                            background: colour,
                            opacity: 0.85,
                            transition: "width .6s",
                          }}
                        />
                        <div
                          style={{
                            position: "absolute",
                            left: 8,
                            top: 0,
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            fontSize: 11,
                            fontFamily: FM,
                            color: pct > 25 ? "#fff" : C.text,
                            fontWeight: 600,
                          }}
                        >
                          {c.n_completed} / {c.n_target}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        <Card padding={16}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: C.textFaint,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Live AI feedback · {recent_responses.length} most recent
            </div>
            {isWorking && (
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: C.accent,
                  animation: "validatorPulse 1s infinite",
                }}
              />
            )}
          </div>
          {recent_responses.length === 0 ? (
            <div style={{ fontSize: 12, color: C.textFaint, padding: "20px 0" }}>
              Persona reactions stream in here as they arrive.
            </div>
          ) : (
            recent_responses.map((p, i) => (
              <div
                key={p.persona_id}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "10px 0",
                  borderTop: i ? `1px solid ${C.border}` : "none",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: FM,
                    fontSize: 10,
                    color: C.textFaint,
                    width: 30,
                  }}
                >
                  {timeAgo(p.created_at, now)}
                </span>
                <span style={{ fontSize: 18, width: 24 }}>
                  {sentimentEmo(p.sentiment)}
                </span>
                <span
                  style={{
                    fontFamily: FM,
                    fontSize: 11,
                    color: C.textFaint,
                    width: 70,
                  }}
                >
                  p_{p.persona_id.slice(0, 6)}
                </span>
                <span style={{ fontSize: 11, color: C.textDim, width: 130 }}>
                  {p.cohort_label}
                </span>
                <Pill
                  tone={sentimentTone(p.sentiment)}
                  style={{ fontSize: 10, width: "auto" }}
                >
                  {p.sentiment}
                </Pill>
                <span
                  style={{
                    flex: 1,
                    fontSize: 12,
                    fontStyle: "italic",
                    color: C.text,
                  }}
                >
                  &ldquo;{p.voice}&rdquo;
                </span>
              </div>
            ))
          )}
        </Card>

        <div
          style={{
            marginTop: 18,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 12, color: C.textFaint, fontFamily: FM }}>
            {scan.status === "failed"
              ? "Scan failed — see error logs."
              : isWorking
              ? "Analysis in progress…"
              : "Analysis complete"}
          </div>
          <button
            onClick={() => router.push(`/validator/report/${scanId}`)}
            disabled={isWorking}
            style={{
              background: !isWorking ? C.accent : "#e6e2d6",
              color: !isWorking ? "#fff" : C.textFaint,
              border: "none",
              borderRadius: 7,
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 500,
              cursor: !isWorking ? "pointer" : "not-allowed",
              fontFamily: "inherit",
            }}
          >
            View report →
          </button>
        </div>
      </div>
    </Frame>
  );
}

export default function ValidatorProcessingPage() {
  return (
    <Suspense fallback={<Frame active="discovery">{null}</Frame>}>
      <ProcessingInner />
    </Suspense>
  );
}
