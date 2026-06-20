"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { scanApi } from "@/lib/api";
import { checkTargetUrl } from "@/lib/url";
import { PR, FD, FB, FM, PrShell, PrButton } from "../../_pr/ui";
import { PayWithUsdcButton } from "../_components/pay-with-usdc";
import { USDC_PAY_ENABLED } from "@/lib/sui-pay";

// Screen 2: Discovery detail — "Sharpen" (Prototype.dc.html). Audience chips +
// hypothesis. Logic (cohort ids, hypothesis, startAnalysis) is unchanged from
// the prior version; only the visual layer moved to the _pr theme.

function DetailInner() {
  const params = useSearchParams();
  const router = useRouter();
  const url = params.get("url") || "yoursite.com";

  const TARGET_USERS: Array<{ t: string; sel: boolean; cohort: string }> = [
    { t: "DeFi power users", sel: true, cohort: "web3_pro" },
    { t: "DeFi beginners", sel: true, cohort: "defi_beginner" },
    { t: "Crypto natives", sel: false, cohort: "crypto_native" },
    { t: "Mobile-first", sel: false, cohort: "mobile_power" },
    { t: "Designers", sel: false, cohort: "designer_20s" },
    { t: "Non-technical 30s", sel: false, cohort: "non_tech_30s" },
    { t: "Seniors (50+)", sel: false, cohort: "senior" },
    { t: "Teen students", sel: false, cohort: "teen_newcomer" },
  ];

  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(TARGET_USERS.map((o) => [o.t, !!o.sel])),
  );
  const [hypothesis, setHypothesis] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<
    null | "creating" | "signing" | "broadcasting" | "redirecting"
  >(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (t: string) => setSelected((prev) => ({ ...prev, [t]: !prev[t] }));

  const buildHypothesisText = (): string | undefined => {
    const trimmed = hypothesis.trim();
    return trimmed ? trimmed : undefined;
  };

  const buildTargetCohorts = (): string[] =>
    Object.entries(selected)
      .filter(([, on]) => on)
      .map(([t]) => TARGET_USERS.find((o) => o.t === t)?.cohort)
      .filter((c): c is string => typeof c === "string");

  const startAnalysis = async (skipInputs = false) => {
    if (submitting) return;
    const check = checkTargetUrl(url);
    if (!check.ok) {
      setError(
        check.reason === "private_host"
          ? "That looks like an internal or private address — enter a public website."
          : "Enter a valid website URL (http or https).",
      );
      return;
    }
    setSubmitting(true);
    setSubmitStage("creating");
    setError(null);
    try {
      const cohorts = skipInputs ? [] : buildTargetCohorts();
      const { scanId } = await scanApi.createScan({
        target_url: check.normalized,
        mode: "A",
        hypothesis: skipInputs ? undefined : buildHypothesisText(),
        target_cohorts: cohorts.length > 0 ? cohorts : undefined,
      });
      setSubmitStage("redirecting");
      router.push(`/validator/processing/${scanId}?url=${encodeURIComponent(url)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start analysis");
      setSubmitting(false);
      setSubmitStage(null);
    }
  };

  const urlShown = url.replace(/^https?:\/\//, "");

  return (
    <PrShell step="2 / 4 · Sharpen">
      <div className="pr-fade" style={{ maxWidth: 640, margin: "0 auto", padding: "48px 28px" }}>
        <div
          onClick={() => router.push("/")}
          style={{ fontSize: 13, color: PR.faint, cursor: "pointer", marginBottom: 18 }}
        >
          ← Back
        </div>
        <div style={{ fontFamily: FM, fontSize: 11, color: PR.accent, marginBottom: 8 }}>
          ANALYZING {urlShown}
        </div>
        <h1 style={{ fontFamily: FD, fontSize: 28, margin: "0 0 6px", color: PR.ink }}>
          Two quick questions{" "}
          <span style={{ color: PR.faint, fontSize: 16, fontWeight: 400 }}>(optional)</span>
        </h1>
        <p style={{ fontSize: 14, color: PR.dim, margin: "0 0 26px" }}>
          Focus the panel — or skip and we&apos;ll check all 8 audiences.
        </p>

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 11, color: PR.ink }}>
          Who do you think it&apos;s for?
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 26 }}>
          {TARGET_USERS.map((o) => {
            const sel = selected[o.t];
            return (
              <span
                key={o.t}
                className="pr-chip"
                onClick={() => toggle(o.t)}
                style={{
                  fontSize: 12.5,
                  padding: "8px 14px",
                  borderRadius: 999,
                  border: `1px solid ${sel ? PR.accent : PR.border}`,
                  background: sel ? PR.accent : PR.panel,
                  color: sel ? "#fff" : PR.dim,
                  fontWeight: sel ? 600 : 400,
                }}
              >
                {o.t}
              </span>
            );
          })}
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 11, color: PR.ink }}>
          What are you hoping to learn?
        </div>
        <textarea
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
          maxLength={1000}
          placeholder="e.g. Will first-timers understand how to make their first swap?"
          style={{
            width: "100%",
            minHeight: 70,
            background: PR.panel,
            border: `1px solid ${PR.borderStrong}`,
            borderRadius: 12,
            padding: "13px 15px",
            fontSize: 14,
            fontFamily: FB,
            color: PR.ink,
            resize: "vertical",
            outline: "none",
            marginBottom: 26,
            boxSizing: "border-box",
          }}
        />

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <PrButton
            onClick={() => startAnalysis(false)}
            disabled={submitting}
            style={{ flex: 1, minWidth: 200, padding: 14 }}
          >
            {submitting ? stageLabel(submitStage) : "Start the scan →"}
          </PrButton>
          <PrButton variant="ghost" onClick={() => startAnalysis(true)} disabled={submitting}>
            Skip — check all 8
          </PrButton>
          {USDC_PAY_ENABLED && (
            <PayWithUsdcButton
              scanBody={{
                target_url: url,
                mode: "A",
                hypothesis: buildHypothesisText(),
                target_cohorts: buildTargetCohorts().length ? buildTargetCohorts() : undefined,
              }}
              onPaid={(scanId) =>
                router.push(`/validator/processing/${scanId}?url=${encodeURIComponent(url)}`)
              }
              disabled={submitting || !url}
            />
          )}
        </div>
        <div
          style={{
            fontFamily: FM,
            fontSize: 11,
            color: error ? PR.redInk : PR.faint,
            marginTop: 14,
            textAlign: "center",
          }}
        >
          {error ? error : "~6 MIN · USES 1 CREDIT ($2)"}
        </div>
      </div>
    </PrShell>
  );
}

function stageLabel(stage: string | null): string {
  switch (stage) {
    case "creating":
      return "Creating scan…";
    case "redirecting":
      return "Loading…";
    default:
      return "Starting…";
  }
}

export default function ValidatorDiscoveryDetailPage() {
  return (
    <Suspense fallback={<PrShell>{null}</PrShell>}>
      <DetailInner />
    </Suspense>
  );
}
