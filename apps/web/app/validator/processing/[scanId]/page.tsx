"use client";

import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { scanApi, type ScanReport } from "@/lib/api";
import { PR, FD, FB, FM, PrShell, PrButton } from "../../../_pr/ui";

// Screen 3: Processing — "Scanning" (Prototype.dc.html dark card). Polls
// /api/scan/:id/report every 800ms, drives the counter + progress bar + live
// reactions, and auto-redirects to the report on status='completed'. Polling
// + terminal-state handling is unchanged from the prior version.

const STATUS_LABELS: Record<string, string> = {
  pending: "Queued",
  capturing: "Capturing site",
  sampling: "Selecting personas",
  responding: "Personas reacting",
  aggregating: "Aggregating cohorts",
  completed: "Complete",
  failed: "Failed",
};

// Sentiment → navy-friendly verdict color (the prototype's loved=green /
// bounced=salmon palette).
function sentimentColor(s: "positive" | "mixed" | "friction"): string {
  return s === "positive" ? "#7fd6a0" : s === "mixed" ? "#e8c887" : "#f0a58e";
}
function sentimentWord(s: "positive" | "mixed" | "friction"): string {
  return s === "positive" ? "loved it" : s === "mixed" ? "mixed" : "bounced";
}

function timeAgo(iso: string, now: number): string {
  const ms = now - new Date(iso).getTime();
  if (ms < 1500) return "now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.round(s / 60)}m`;
}

function ProcessingInner() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const scanId = (params?.scanId as string) || "demo";
  const url = (search.get("url") || "yoursite.com").replace(/^https?:\/\//, "");

  const [report, setReport] = useState<ScanReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const cancelled = useRef(false);

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
        if (r.scan.status !== "failed" && r.scan.status !== "pending_payment") {
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
      <PrShell step="3 / 4 · Scanning">
        <Centered>
          <div style={{ color: PR.redInk, fontSize: 14, fontWeight: 600 }}>Couldn&apos;t load scan</div>
          <div style={{ color: PR.dim, fontSize: 13, marginTop: 6 }}>{error}</div>
        </Centered>
      </PrShell>
    );
  }

  if (!report) {
    return (
      <PrShell step="3 / 4 · Scanning">
        <Centered>
          <div style={{ color: PR.faint, fontSize: 13 }}>Loading scan…</div>
        </Centered>
      </PrShell>
    );
  }

  const { scan, recent_responses } = report;

  if (scan.status === "pending_payment") {
    return (
      <PrShell step="3 / 4 · Scanning">
        <div style={{ maxWidth: 520, margin: "0 auto", padding: "56px 28px" }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: PR.ink }}>
            This analysis is waiting for payment
          </div>
          <p style={{ fontSize: 14, color: PR.dim, lineHeight: 1.6, marginTop: 8 }}>
            It was started on the USDC escrow rail but the payment was never completed, so it
            hasn&apos;t run. Start a new analysis — your credit balance covers it instantly.
          </p>
          <PrButton onClick={() => router.push("/")} style={{ marginTop: 16 }}>
            Start a new analysis →
          </PrButton>
        </div>
      </PrShell>
    );
  }

  const done = scan.personas_completed;
  const total =
    scan.personas_attempted > 0
      ? scan.personas_attempted
      : scan.mode === "A"
        ? 112
        : Math.max(done, 1);
  const isWorking = scan.status !== "completed" && scan.status !== "failed";
  const pct = Math.round((done / Math.max(total, 1)) * 100);

  return (
    <PrShell step="3 / 4 · Scanning">
      <div className="pr-fade" style={{ maxWidth: 560, margin: "0 auto", padding: "56px 28px" }}>
        <div style={{ background: PR.navy, borderRadius: 18, padding: 30, color: PR.navyText }}>
          <div style={{ fontFamily: FM, fontSize: 11, color: PR.navyDim, marginBottom: 6 }}>
            {scan.status === "failed" ? "SCAN FAILED" : `SCANNING ${url}`}
          </div>
          <div style={{ textAlign: "center", margin: "16px 0 20px" }}>
            <div style={{ fontFamily: FD, fontSize: 46, fontWeight: 700, lineHeight: 1 }}>
              {done} <span style={{ fontSize: 20, color: PR.navyDim }}>/ {total}</span>
            </div>
            <div style={{ fontSize: 13, color: PR.navyDim, marginTop: 4 }}>
              {STATUS_LABELS[scan.status] ?? "personas have reacted…"}
            </div>
            <div
              style={{
                height: 6,
                background: PR.navy2,
                borderRadius: 999,
                overflow: "hidden",
                marginTop: 16,
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: "100%",
                  background: PR.accent,
                  transition: "width .3s",
                }}
              />
            </div>
          </div>

          <div
            style={{
              fontFamily: FM,
              fontSize: 10,
              color: PR.navyFaint,
              letterSpacing: "0.08em",
              marginBottom: 11,
            }}
          >
            LIVE REACTIONS
          </div>
          {recent_responses.length === 0 ? (
            <div style={{ fontSize: 12, color: PR.navyDim, padding: "10px 0" }}>
              Persona reactions stream in here as they arrive…
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {recent_responses.slice(0, 4).map((p) => (
                <div
                  key={p.persona_id}
                  style={{
                    background: PR.navy2,
                    border: "1px solid rgba(255,255,255,.08)",
                    borderRadius: 11,
                    padding: 12,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{p.cohort_label}</span>
                    <span style={{ fontSize: 12, color: sentimentColor(p.sentiment), fontWeight: 700, whiteSpace: "nowrap" }}>
                      {sentimentWord(p.sentiment)} · {timeAgo(p.created_at, now)}
                    </span>
                  </div>
                  <p style={{ fontSize: 12, color: PR.navyDim, margin: 0, fontStyle: "italic" }}>
                    &ldquo;{p.voice}&rdquo;
                  </p>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontFamily: FM, fontSize: 11, color: PR.navyFaint, textAlign: "center", marginTop: 16 }}>
            {scan.status === "failed" ? "scan failed — see logs" : "first results in seconds…"}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
          <span style={{ fontFamily: FM, fontSize: 11, color: PR.faint }}>scan {scanId.slice(0, 8)}</span>
          <PrButton
            variant={isWorking ? "outline" : "primary"}
            onClick={() => router.push(`/validator/report/${scanId}`)}
            disabled={isWorking}
            style={{ fontSize: 13, padding: "9px 16px" }}
          >
            View report →
          </PrButton>
        </div>
      </div>
    </PrShell>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "72px 28px", fontFamily: FB }}>
      {children}
    </div>
  );
}

export default function ValidatorProcessingPage() {
  return (
    <Suspense fallback={<PrShell>{null}</PrShell>}>
      <ProcessingInner />
    </Suspense>
  );
}
