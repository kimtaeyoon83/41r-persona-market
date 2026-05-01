"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { scanApi } from "@/lib/api";
import { C, FM, FS, Frame, Pill } from "./_components/ui";

// Screen 1: Discovery — "Find your product PMF" big banner.
// Maps to ScreenDiscovery in screens-v2.jsx.
//
// Phase 2-B adds the Mode A / Mode B toggle:
//   Mode A (Discovery)    → URL only → /validator/detail (sharpening)
//   Mode B (Verification) → URL + target audience text → POST /api/scan
//                           directly → /validator/processing/<scanId>
export default function ValidatorDiscoveryPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"A" | "B">("A");
  const [url, setUrl] = useState("yoursite.com");
  const [audience, setAudience] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRun = async () => {
    if (submitting) return;
    setError(null);
    if (mode === "A") {
      router.push(`/validator/detail?url=${encodeURIComponent(url)}`);
      return;
    }
    if (!audience.trim()) {
      setError("Audience is required for Mode B");
      return;
    }
    setSubmitting(true);
    try {
      const { scanId } = await scanApi.createScan({
        target_url: url,
        mode: "B",
        target_audience_text: audience.trim(),
      });
      router.push(
        `/validator/processing/${scanId}?url=${encodeURIComponent(url)}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start verify");
      setSubmitting(false);
    }
  };

  return (
    <Frame active="discovery">
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "60px 32px",
          minHeight: "calc(100vh - 52px)",
        }}
      >
        {/* Mode toggle */}
        <div
          style={{
            display: "flex",
            gap: 4,
            marginBottom: 22,
            padding: 4,
            background: "#f3f0e8",
            borderRadius: 999,
            border: `1px solid ${C.border}`,
          }}
        >
          {(
            [
              { id: "A", label: "Discovery", sub: "Find your audience" },
              { id: "B", label: "Verify", sub: "Check a specific audience" },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              style={{
                padding: "8px 16px",
                fontSize: 12,
                borderRadius: 999,
                background: mode === m.id ? C.panel : "transparent",
                color: mode === m.id ? C.text : C.textDim,
                border:
                  mode === m.id
                    ? `1px solid ${C.borderStrong}`
                    : "1px solid transparent",
                cursor: "pointer",
                fontFamily: FS,
                fontWeight: mode === m.id ? 600 : 400,
                boxShadow:
                  mode === m.id ? "0 1px 3px rgba(60,40,20,0.04)" : "none",
              }}
            >
              {m.label}{" "}
              <span
                style={{
                  fontSize: 10,
                  color: C.textFaint,
                  marginLeft: 4,
                  fontWeight: 400,
                }}
              >
                {m.sub}
              </span>
            </button>
          ))}
        </div>

        <Pill tone="accent" style={{ marginBottom: 14 }}>
          {mode === "A" ? "Discovery" : "Verification"}
        </Pill>

        {mode === "A" ? (
          <h1
            style={{
              fontSize: 64,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              margin: 0,
              lineHeight: 1,
              textAlign: "center",
              whiteSpace: "nowrap",
            }}
          >
            Find your product <span style={{ color: C.accent }}>PMF</span>
          </h1>
        ) : (
          <h1
            style={{
              fontSize: 56,
              fontWeight: 600,
              letterSpacing: "-0.03em",
              margin: 0,
              lineHeight: 1.05,
              textAlign: "center",
            }}
          >
            Verify <span style={{ color: C.accent }}>audience fit</span>
          </h1>
        )}

        <p
          style={{
            fontSize: 16,
            color: C.textDim,
            marginTop: 16,
            lineHeight: 1.55,
            textAlign: "center",
            maxWidth: 600,
          }}
        >
          {mode === "A"
            ? "Start with a single URL. 80–120 AI personas simulate your site’s product–market fit in minutes."
            : "Provide your URL + a target audience. ~50 personas matching that audience will run a pass/fail verification."}
        </p>

        {/* URL input */}
        <div
          style={{
            marginTop: 32,
            width: 620,
            background: C.panel,
            border: `1px solid ${C.borderStrong}`,
            borderRadius: 14,
            padding: 8,
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 4px 24px rgba(60,40,20,0.06)",
          }}
        >
          <div
            style={{
              padding: "0 14px",
              fontFamily: FM,
              fontSize: 13,
              color: C.textFaint,
              borderRight: `1px solid ${C.border}`,
              height: 32,
              display: "flex",
              alignItems: "center",
            }}
          >
            https://
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && mode === "A") onRun();
            }}
            style={{
              flex: 1,
              border: "none",
              outline: "none",
              fontSize: 16,
              fontFamily: FS,
              color: C.text,
              background: "transparent",
              padding: "12px 4px",
            }}
          />
          {mode === "A" && (
            <button
              onClick={onRun}
              style={{
                background: C.accent,
                color: "#fff",
                border: "none",
                borderRadius: 10,
                padding: "12px 22px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: FS,
              }}
            >
              Run analysis →
            </button>
          )}
        </div>

        {/* Mode B audience input */}
        {mode === "B" && (
          <>
            <div
              style={{
                marginTop: 12,
                width: 620,
                background: C.panel,
                border: `1px solid ${C.borderStrong}`,
                borderRadius: 14,
                padding: 8,
                display: "flex",
                alignItems: "center",
                gap: 8,
                boxShadow: "0 4px 24px rgba(60,40,20,0.06)",
              }}
            >
              <div
                style={{
                  padding: "0 14px",
                  fontFamily: FM,
                  fontSize: 13,
                  color: C.textFaint,
                  borderRight: `1px solid ${C.border}`,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                audience
              </div>
              <input
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onRun();
                }}
                placeholder='e.g. "30s DeFi expert mobile-first"'
                style={{
                  flex: 1,
                  border: "none",
                  outline: "none",
                  fontSize: 15,
                  fontFamily: FS,
                  color: C.text,
                  background: "transparent",
                  padding: "12px 4px",
                }}
              />
              <button
                onClick={onRun}
                disabled={submitting}
                style={{
                  background: submitting ? "#d4cfc1" : C.accent,
                  color: "#fff",
                  border: "none",
                  borderRadius: 10,
                  padding: "12px 22px",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: submitting ? "not-allowed" : "pointer",
                  fontFamily: FS,
                }}
              >
                {submitting ? "Starting…" : "Verify →"}
              </button>
            </div>

            {error && (
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: C.bad,
                  fontFamily: FS,
                }}
              >
                {error}
              </div>
            )}

            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: C.textFaint,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <span>Try:</span>
              {[
                "Teen students new to crypto",
                "Designer (20s) mobile-first",
                "Senior 50+ low tech literacy",
                "Web3 power user multi-chain",
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setAudience(s)}
                  style={{
                    color: C.accent,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textDecoration: "underline",
                    textDecorationStyle: "dotted",
                    fontFamily: FS,
                    fontSize: 12,
                    padding: 0,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </>
        )}

        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: C.textFaint,
            display: "flex",
            gap: 12,
          }}
        >
          {mode === "A" ? (
            <>
              <span>~6 min</span>
              <span>·</span>
              <span>~$0.43–$2.13</span>
              <span>·</span>
              <span>113 personas across 8 cohorts</span>
            </>
          ) : (
            <>
              <span>~2 min</span>
              <span>·</span>
              <span>~$0.20–$1.00</span>
              <span>·</span>
              <span>up to 50 personas matching audience</span>
            </>
          )}
        </div>

        {mode === "A" && (
          <div
            style={{
              marginTop: 28,
              display: "flex",
              gap: 8,
              fontSize: 12,
              color: C.textFaint,
              alignItems: "center",
            }}
          >
            <span>Try:</span>
            {["uniswap.org", "linear.app", "playcamp.io"].map((s) => (
              <Link
                key={s}
                href={`/validator/detail?url=${encodeURIComponent(s)}`}
                style={{
                  color: C.accent,
                  textDecoration: "underline",
                  textDecorationStyle: "dotted",
                }}
              >
                {s}
              </Link>
            ))}
          </div>
        )}
      </div>
    </Frame>
  );
}
