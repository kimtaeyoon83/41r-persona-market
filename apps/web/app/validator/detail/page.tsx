"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import {
  useSignTransaction,
  useWallets as useSolanaWallets,
} from "@privy-io/react-auth/solana";
import { scanApi } from "@/lib/api";
import { checkTargetUrl } from "@/lib/url";
import { performSponsoredPayment } from "@/lib/sponsored-payment";
import { Btn, C, Card, FM, Frame } from "../_components/ui";

// Screen 2: Discovery detail — sharpening questions.
// Maps to ScreenDiscoveryDetail in screens-v2.jsx.

function DetailInner() {
  const params = useSearchParams();
  const router = useRouter();
  const url = params.get("url") || "yoursite.com";

  // Each entry maps to a STANDARD_COHORTS id so the selection can
  // restrict the analysis to a real subset (not just hint to the LLM).
  // ghost rows have no cohort id — they're decorative ("+ Custom"
  // belongs to the Mode B audience flow).
  const TARGET_USERS: Array<{
    t: string;
    sel: boolean;
    cohort?: string;
    ghost?: boolean;
  }> = [
    { t: "DeFi power users (30s)", sel: true, cohort: "web3_pro" },
    { t: "DeFi beginners", sel: true, cohort: "defi_beginner" },
    { t: "Teen students", sel: false, cohort: "teen_newcomer" },
    { t: "Seniors (50+)", sel: false, cohort: "senior" },
    { t: "Designers", sel: false, cohort: "designer_20s" },
    { t: "Mobile-first", sel: false, cohort: "mobile_power" },
    { t: "Crypto Native", sel: false, cohort: "crypto_native" },
    { t: "Non-technical 30s", sel: false, cohort: "non_tech_30s" },
    { t: "+ Custom", sel: false, ghost: true },
  ];

  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(TARGET_USERS.map((o) => [o.t, !!o.sel]))
  );
  const [hypothesis, setHypothesis] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState<
    null | "creating" | "signing" | "broadcasting" | "redirecting"
  >(null);
  const [error, setError] = useState<string | null>(null);

  // Phase 4 D6 — Privy embedded wallet + sign-transaction hook.
  // wallets[0] is the user's Solana embedded wallet (auto-created on
  // email login). Phantom users connect their external wallet which
  // also surfaces here.
  const { authenticated } = usePrivy();
  const { signTransaction } = useSignTransaction();
  const { wallets: solanaWallets } = useSolanaWallets();

  const toggle = (t: string) =>
    setSelected((prev) => ({ ...prev, [t]: !prev[t] }));

  // Free-text hypothesis sent verbatim to the LLM persona prompt.
  // (Cohort selection is sent separately as target_cohorts so the
  // pipeline actually filters which 8 cohorts run, not just hints.)
  const buildHypothesisText = (): string | undefined => {
    const trimmed = hypothesis.trim();
    return trimmed ? trimmed : undefined;
  };

  // List of selected cohort ids — empty array (or skip) means
  // "run all 8 STANDARD_COHORTS".
  const buildTargetCohorts = (): string[] => {
    return Object.entries(selected)
      .filter(([, on]) => on)
      .map(([t]) => TARGET_USERS.find((o) => o.t === t)?.cohort)
      .filter((c): c is string => typeof c === "string");
  };

  const startAnalysis = async (skipInputs = false) => {
    if (submitting) return;
    // Security gate (2026-06-15) — `url` arrives from the query string;
    // validate before spending a scan. Server re-validates authoritatively.
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
      // 1. Create the scan row (anonymous if not logged in; ownership
      //    claimed lazily by /payment-tx if/when authenticated).
      const cohorts = skipInputs ? [] : buildTargetCohorts();
      const { scanId } = await scanApi.createScan({
        target_url: check.normalized,
        mode: 'A',
        hypothesis: skipInputs ? undefined : buildHypothesisText(),
        target_cohorts: cohorts.length > 0 ? cohorts : undefined,
      });

      // 2. Sponsored 0 USDC tx — Phase 4 D6, via the shared helper at
      //    lib/sponsored-payment.ts. Returns ok / skipped / error so
      //    we surface a friendly message but never abort the scan
      //    (server-side worker is decoupled from payment).
      const result = await performSponsoredPayment({
        scanId,
        authenticated,
        wallet: solanaWallets[0],
        signTransaction,
        // Map helper stages to the local submitStage union. Helper's
        // "done" is the terminal success — we transition straight to
        // "redirecting" below, so no setSubmitStage is needed for it.
        onStage: (stage) => {
          if (stage === "signing" || stage === "broadcasting") {
            setSubmitStage(stage);
          }
        },
      });
      if (result.kind === "error") {
        setError(`Payment skipped: ${result.message}`);
      }

      setSubmitStage("redirecting");
      router.push(
        `/validator/processing/${scanId}?url=${encodeURIComponent(url)}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start analysis');
      setSubmitting(false);
      setSubmitStage(null);
    }
  };

  return (
    <Frame active="discovery">
      <div style={{ padding: "clamp(20px, 5vw, 32px) clamp(16px, 4vw, 48px)", maxWidth: 780, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <Link
            href="/validator"
            style={{
              fontSize: 12,
              color: C.textFaint,
              textDecoration: "none",
            }}
          >
            ← Back
          </Link>
          <span style={{ fontSize: 12, color: C.textFaint }}>·</span>
          <span style={{ fontSize: 12, color: C.textDim, fontFamily: FM }}>
            https://{url}
          </span>
        </div>
        <h1
          style={{
            fontSize: 30,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: "8px 0 6px",
          }}
        >
          A few questions to sharpen the analysis
        </h1>
        <p
          style={{
            fontSize: 13,
            color: C.textDim,
            marginBottom: 24,
            lineHeight: 1.55,
          }}
        >
          Optional — we&apos;ll fall back to auto-inferred values if you skip.
        </p>

        <Card style={{ marginBottom: 14 }} padding={20}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: C.text,
                color: C.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: FM,
                flexShrink: 0,
              }}
            >
              1
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Who are your target users?
              </div>
              <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
                Multi-select — free text also welcome
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 10,
            }}
          >
            {TARGET_USERS.map((o) => {
              const sel = selected[o.t];
              return (
                <button
                  key={o.t}
                  onClick={() => toggle(o.t)}
                  style={{
                    fontSize: 12,
                    padding: "5px 12px",
                    borderRadius: 999,
                    background: sel
                      ? C.accent
                      : o.ghost
                      ? "transparent"
                      : "#f3f0e8",
                    color: sel ? "#fff" : o.ghost ? C.textFaint : C.textDim,
                    border: `1px ${o.ghost ? "dashed" : "solid"} ${
                      sel ? C.accent : C.border
                    }`,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {o.t}
                </button>
              );
            })}
          </div>
        </Card>

        <Card style={{ marginBottom: 14 }} padding={20}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: C.text,
                color: C.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: FM,
                flexShrink: 0,
              }}
            >
              2
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Category / one-line pitch
              </div>
              <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
                Auto-detected during scan from the captured page content
              </div>
            </div>
          </div>
          <div
            style={{
              padding: 12,
              background: "#f7f4ec",
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              fontSize: 12,
              color: C.textFaint,
              lineHeight: 1.55,
              fontStyle: "italic",
            }}
          >
            We&apos;ll capture {url} on scan start and extract the category +
            one-line pitch automatically. You&apos;ll see the result on the
            report screen.
          </div>
        </Card>

        <Card style={{ marginBottom: 20 }} padding={20}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                background: C.text,
                color: C.bg,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: FM,
                flexShrink: 0,
              }}
            >
              3
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Any specific hypothesis you want to validate?
              </div>
              <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>
                Optional — used as a priority probe in persona responses
              </div>
            </div>
          </div>
          <textarea
            value={hypothesis}
            onChange={(e) => setHypothesis(e.target.value)}
            placeholder='e.g. "Suspect drop-off at checkout" · "Verify usability for teen students" · "Is wallet onboarding friendly enough?"'
            rows={3}
            maxLength={1000}
            style={{
              width: "100%",
              padding: 12,
              background: "#f7f4ec",
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              fontSize: 13,
              color: C.text,
              lineHeight: 1.55,
              fontFamily: "inherit",
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box",
            }}
          />
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: C.textFaint,
              fontFamily: FM,
              textAlign: "right",
            }}
          >
            {hypothesis.length} / 1000
          </div>
        </Card>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 12, color: C.textFaint, fontFamily: FM }}>
            {error ? (
              <span style={{ color: C.bad }}>{error}</span>
            ) : submitting ? (
              "Creating scan…"
            ) : (
              "~$1.80 · ~6 min · 113 personas across 8 cohorts"
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={() => startAnalysis(true)}>
              {submitting ? "Skip…" : "Skip"}
            </Btn>
            <Btn primary onClick={() => startAnalysis(false)}>
              {submitting ? stageLabel(submitStage) : "Start analysis →"}
            </Btn>
          </div>
        </div>
      </div>
    </Frame>
  );
}

function stageLabel(stage: string | null): string {
  switch (stage) {
    case "creating":
      return "Creating scan…";
    case "signing":
      return "Sign in your wallet…";
    case "broadcasting":
      return "Broadcasting tx…";
    case "redirecting":
      return "Loading processing…";
    default:
      return "Starting…";
  }
}

export default function ValidatorDiscoveryDetailPage() {
  return (
    <Suspense fallback={<Frame active="discovery">{null}</Frame>}>
      <DetailInner />
    </Suspense>
  );
}

