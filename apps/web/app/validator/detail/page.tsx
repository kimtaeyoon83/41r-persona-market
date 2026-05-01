"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { scanApi } from "@/lib/api";
import { Btn, C, Card, FM, Frame, Pill } from "../_components/ui";

// Screen 2: Discovery detail — sharpening questions.
// Maps to ScreenDiscoveryDetail in screens-v2.jsx.

function DetailInner() {
  const params = useSearchParams();
  const router = useRouter();
  const url = params.get("url") || "yoursite.com";

  const TARGET_USERS = [
    { t: "DeFi power users (30s)", sel: true },
    { t: "DeFi beginners", sel: true },
    { t: "Teen students", sel: false },
    { t: "Seniors (50+)", sel: false },
    { t: "Designers", sel: false },
    { t: "Mobile-first", sel: false },
    { t: "+ Custom", sel: false, ghost: true },
  ];

  const [selected, setSelected] = useState<Record<string, boolean>>(
    Object.fromEntries(TARGET_USERS.map((o) => [o.t, !!o.sel]))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (t: string) =>
    setSelected((prev) => ({ ...prev, [t]: !prev[t] }));

  const startAnalysis = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { scanId } = await scanApi.createScan({
        target_url: url,
        mode: 'A',
      });
      router.push(
        `/validator/processing/${scanId}?url=${encodeURIComponent(url)}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start analysis');
      setSubmitting(false);
    }
  };

  return (
    <Frame active="discovery">
      <div style={{ padding: "32px 48px", maxWidth: 780, margin: "0 auto" }}>
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
                auto-detected: <Pill tone="accent">DeFi</Pill>{" "}
                <span
                  style={{
                    fontSize: 11,
                    color: C.textFaint,
                    fontFamily: FM,
                    marginLeft: 4,
                  }}
                >
                  confidence 0.91
                </span>
              </div>
            </div>
          </div>
          <div
            style={{
              padding: 12,
              background: "#f7f4ec",
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              fontSize: 13,
              color: C.text,
              lineHeight: 1.55,
            }}
          >
            DeFi swap aggregator on Solana — minimal slippage + MEV protection.
            Mobile-wallet first.
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
          <div
            style={{
              padding: 12,
              background: "#f7f4ec",
              borderRadius: 6,
              border: `1px solid ${C.border}`,
              fontSize: 13,
              color: C.textDim,
              lineHeight: 1.55,
              fontStyle: "italic",
            }}
          >
            e.g. &ldquo;Suspect drop-off at checkout&rdquo;, &ldquo;Verify
            usability for teen students&rdquo;, &ldquo;Is wallet onboarding
            friendly enough?&rdquo;
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
            <Btn onClick={startAnalysis}>{submitting ? "Skip…" : "Skip"}</Btn>
            <Btn primary onClick={startAnalysis}>
              {submitting ? "Starting…" : "Start analysis →"}
            </Btn>
          </div>
        </div>
      </div>
    </Frame>
  );
}

export default function ValidatorDiscoveryDetailPage() {
  return (
    <Suspense fallback={<Frame active="discovery">{null}</Frame>}>
      <DetailInner />
    </Suspense>
  );
}
