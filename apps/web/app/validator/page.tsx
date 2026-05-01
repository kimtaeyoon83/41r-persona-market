"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { C, FM, FS, Frame, Pill } from "./_components/ui";

// Screen 1: Discovery — "Find your product PMF" big banner.
// Maps to ScreenDiscovery in screens-v2.jsx. Headline forced to one
// line via white-space:nowrap (per the user's last design instruction).
export default function ValidatorDiscoveryPage() {
  const router = useRouter();
  const [url, setUrl] = useState("yoursite.com");

  const onRun = () => {
    router.push(`/validator/detail?url=${encodeURIComponent(url)}`);
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
          padding: "80px 32px",
          minHeight: "calc(100vh - 52px)",
        }}
      >
        <Pill tone="accent" style={{ marginBottom: 18 }}>
          Discovery
        </Pill>
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
        <p
          style={{
            fontSize: 16,
            color: C.textDim,
            marginTop: 18,
            lineHeight: 1.55,
            textAlign: "center",
            maxWidth: 560,
          }}
        >
          Start with a single URL. 80–120 AI personas simulate your site&apos;s
          product–market fit in minutes.
        </p>

        <div
          style={{
            marginTop: 36,
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
              if (e.key === "Enter") onRun();
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
        </div>

        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: C.textFaint,
            display: "flex",
            gap: 12,
          }}
        >
          <span>~6 min</span>
          <span>·</span>
          <span>~$1.80</span>
          <span>·</span>
          <span>113 personas</span>
        </div>

        <div
          style={{
            marginTop: 32,
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
      </div>
    </Frame>
  );
}
