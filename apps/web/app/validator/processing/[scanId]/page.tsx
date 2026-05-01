"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { C, Card, FM, Frame, Pill } from "../../_components/ui";

// Screen 3: Processing — live persona stream + abandonment funnel.
// Maps to ScreenProcessing in screens-v2.jsx. Phase 0 simulates the
// stream with a setInterval ticker; Phase 1 will swap to SSE per
// spec §6.3 / §11.8.

const FUNNEL = [
  { step: "Landing", n: 67, drop: 0, color: C.ok },
  { step: "Hero scroll", n: 54, drop: 13, color: C.ok },
  { step: "Features", n: 42, drop: 12, color: C.warn },
  { step: "Wallet connect", n: 21, drop: 21, color: C.bad, hot: true },
  { step: "First swap try", n: 14, drop: 7, color: C.warn },
  { step: "Swap complete", n: 9, drop: 5, color: C.ok },
];

const FEED = [
  { t: "now", id: "p_8a3f", cohort: "Teen newcomer", emo: "😟", msg: "I have no idea what this site does. Too much English jargon.", step: "Hero", tag: "misfit" },
  { t: "2s",  id: "p_2c91", cohort: "DeFi beginner", emo: "😕", msg: "I can't find where the slippage setting is.", step: "Swap", tag: "friction" },
  { t: "5s",  id: "p_4f02", cohort: "30s DeFi pro", emo: "😊", msg: "MEV protection being explicit gives me real confidence.", step: "Feature", tag: "positive" },
  { t: "8s",  id: "p_71bc", cohort: "Designer (20s)", emo: "🤔", msg: "Interface is clean, but the visual hierarchy is weak.", step: "Landing", tag: "mixed" },
  { t: "12s", id: "p_9012", cohort: "Senior (50+)", emo: "😣", msg: "Buttons and text are too small — I can't read it.", step: "Hero", tag: "friction" },
];

function ProcessingInner() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const scanId = (params?.scanId as string) || "demo";
  const url = search.get("url") || "yoursite.com";

  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setProgress((p) => Math.min(p + 1, 100));
    }, 600);
    return () => clearInterval(id);
  }, []);

  const total = 113;
  const done = Math.floor((progress / 100) * 60);
  const running = progress >= 100 ? 53 : progress < 5 ? 0 : 29;
  const queued = total - done - running;

  return (
    <Frame active="discovery">
      <div style={{ padding: "24px 32px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 18 }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>Analyzing {url}</h1>
          <span style={{ fontSize: 13, color: C.textDim, fontFamily: FM }}>
            {Math.floor((progress / 100) * 113)} / 113 · scan {scanId}
          </span>
          <div style={{ flex: 1 }} />
          <Pill tone="accent">⚡ Live</Pill>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 14, marginBottom: 14 }}>
          <Card padding={16}>
            <div style={{ fontSize: 11, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
              Personas in flight · 113
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 4 }}>
              {Array.from({ length: total }).map((_, i) => {
                const status = i < done ? "done" : i < done + running ? "running" : "queued";
                const bg = status === "done" ? C.ok : status === "running" ? C.accent : "#e6e2d6";
                return (
                  <div
                    key={i}
                    title={`p_${i.toString(16).padStart(4, "0")}`}
                    style={{
                      aspectRatio: "1",
                      borderRadius: "50%",
                      background: bg,
                      opacity: status === "queued" ? 0.5 : 1,
                      boxShadow: status === "running" ? `0 0 0 2px ${C.accentSoft}` : "none",
                      animation: status === "running" ? "validatorPulse 1.4s ease-in-out infinite" : "none",
                    }}
                  />
                );
              })}
            </div>
            <style>{`@keyframes validatorPulse{0%,100%{opacity:1}50%{opacity:.5}}`}</style>
            <div style={{ display: "flex", gap: 14, marginTop: 14, fontSize: 11, color: C.textDim }}>
              <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: C.ok, marginRight: 6, verticalAlign: "middle" }} />Done {done}</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: C.accent, marginRight: 6, verticalAlign: "middle" }} />Responding {running}</span>
              <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 999, background: "#d4cfc1", marginRight: 6, verticalAlign: "middle" }} />Queued {queued}</span>
            </div>
          </Card>

          <Card padding={16}>
            <div style={{ fontSize: 11, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 12 }}>
              Real-time abandonment funnel
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {FUNNEL.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 110, fontSize: 12, color: C.textDim }}>{s.step}</div>
                  <div style={{ flex: 1, position: "relative", height: 22, background: "#f3f0e8", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{
                      position: "absolute", left: 0, top: 0, height: "100%",
                      width: `${(s.n / 67) * 100}%`,
                      background: s.color, opacity: 0.85, transition: "width .6s",
                    }} />
                    <div style={{
                      position: "absolute", left: 8, top: 0, height: "100%",
                      display: "flex", alignItems: "center",
                      fontSize: 11, fontFamily: FM, color: "#fff", fontWeight: 600,
                    }}>{s.n}</div>
                  </div>
                  {s.drop > 0 && (
                    <div style={{ width: 48, fontSize: 11, fontFamily: FM, color: C.bad, textAlign: "right" }}>−{s.drop}</div>
                  )}
                  {s.hot && <Pill tone="bad" style={{ fontSize: 10 }}>🔥 hot</Pill>}
                </div>
              ))}
            </div>
            <div style={{
              marginTop: 12, padding: 10, background: C.badSoft, borderRadius: 6,
              fontSize: 12, color: C.bad, lineHeight: 1.5,
            }}>
              <b>Currently hottest drop-off:</b> Wallet connect step — 21
              personas leaving. &ldquo;I don&apos;t know which wallet to
              use&rdquo; pattern dominant.
            </div>
          </Card>
        </div>

        <Card padding={16}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: C.textFaint, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Live AI feedback · last 30s
            </div>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: C.accent, animation: "validatorPulse 1s infinite" }} />
          </div>
          {FEED.map((p, i) => {
            const tagTone = p.tag === "positive" ? "ok" : p.tag === "misfit" || p.tag === "friction" ? "bad" : "warn";
            return (
              <div key={i} style={{
                display: "flex", gap: 10, padding: "10px 0",
                borderTop: i ? `1px solid ${C.border}` : "none",
                alignItems: "center",
              }}>
                <span style={{ fontFamily: FM, fontSize: 10, color: C.textFaint, width: 30 }}>{p.t}</span>
                <span style={{ fontSize: 18, width: 24 }}>{p.emo}</span>
                <span style={{ fontFamily: FM, fontSize: 11, color: C.textFaint, width: 50 }}>{p.id}</span>
                <span style={{ fontSize: 11, color: C.textDim, width: 130 }}>{p.cohort}</span>
                <Pill tone={tagTone} style={{ fontSize: 10, width: "auto" }}>{p.step}</Pill>
                <span style={{ flex: 1, fontSize: 12, fontStyle: "italic", color: C.text }}>&ldquo;{p.msg}&rdquo;</span>
              </div>
            );
          })}
        </Card>

        <div style={{
          marginTop: 18, display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ fontSize: 12, color: C.textFaint, fontFamily: FM }}>
            {progress < 100 ? "Analysis in progress…" : "Analysis complete"}
          </div>
          <button
            onClick={() => router.push(`/validator/report/${scanId}`)}
            disabled={progress < 100}
            style={{
              background: progress >= 100 ? C.accent : "#e6e2d6",
              color: progress >= 100 ? "#fff" : C.textFaint,
              border: "none", borderRadius: 7, padding: "8px 14px",
              fontSize: 13, fontWeight: 500,
              cursor: progress >= 100 ? "pointer" : "not-allowed",
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
