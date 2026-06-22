"use client";

// /me/responses — Phase 5.1.
//
// Auth-gated list of the current user's human-survey submissions. Each
// card links to /me/responses/[scanId] (the AI-vs-Me detail view) and
// to /validator/compare/[scanId] (the full AI vs Human aggregate
// comparison). Privy bearer token is auto-attached via providers.tsx
// AuthBridge, so listMySurveyResponses() resolves as soon as ready.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { meApi, type MySurveyResponseSummary } from "@/lib/api";
import { C, FM, FS, Frame } from "../../validator/_components/ui";

export default function MyResponsesPage() {
  const { ready, authenticated, login } = useAuth();
  const [items, setItems] = useState<MySurveyResponseSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setItems([]);
      return;
    }
    let cancelled = false;
    meApi
      .listMySurveyResponses()
      .then((r) => {
        if (cancelled) return;
        setItems(r.responses);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      });
    return () => { cancelled = true; };
  }, [ready, authenticated]);

  if (!ready) {
    return (
      <Frame active="discovery">
        <Center>Loading…</Center>
      </Frame>
    );
  }

  if (!authenticated) {
    return (
      <Frame active="discovery">
        <Center>
          <h1 style={{ fontSize: 26, fontWeight: 600, fontFamily: FS, marginBottom: 14 }}>
            Sign in to see your survey responses
          </h1>
          <button
            onClick={login}
            style={{
              padding: "12px 24px",
              fontSize: 13,
              fontWeight: 600,
              background: C.text,
              color: C.bg,
              border: "none",
              borderRadius: 999,
              cursor: "pointer",
              fontFamily: FS,
            }}
          >
            Sign in
          </button>
        </Center>
      </Frame>
    );
  }

  return (
    <Frame active="discovery">
      <div className="v-page-pad" style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ marginBottom: 22 }}>
          <Link
            href="/"
            style={{ fontSize: 12, color: C.textFaint, fontFamily: FM, textDecoration: "none" }}
          >
            ← Home
          </Link>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 600, fontFamily: FS, lineHeight: 1.2, marginBottom: 6 }}>
          My survey responses
        </h1>
        <div style={{ fontSize: 13, color: C.textDim, marginBottom: 24 }}>
          Surveys you&rsquo;ve submitted as a human respondent. Click a row to see your
          answers compared to the AI persona panel for that site.
        </div>

        {error && (
          <div style={{ color: C.bad, fontSize: 13, marginBottom: 14 }}>{error}</div>
        )}

        {items === null ? (
          <div style={{ color: C.textDim, fontSize: 13, fontFamily: FM }}>Loading…</div>
        ) : items.length === 0 ? (
          <div
            style={{
              padding: 24,
              background: C.panel,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              fontSize: 13,
              color: C.textDim,
              textAlign: "center",
            }}
          >
            You haven&rsquo;t submitted any surveys yet. When someone shares a survey
            link with you (e.g. <code style={{ fontFamily: FM, color: C.text }}>/validator/survey/&lt;id&gt;</code>),
            your submission will appear here.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((r) => (
              <Link
                key={r.scan_id}
                href={`/me/responses/${r.scan_id}`}
                style={{
                  display: "block",
                  padding: 16,
                  background: C.panel,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  textDecoration: "none",
                  color: C.text,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.target_url}
                  </div>
                  <div style={{ fontSize: 11, color: C.textFaint, fontFamily: FM, whiteSpace: "nowrap" }}>
                    {new Date(r.submitted_at).toLocaleString()}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: C.textDim, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {r.category && (
                    <span style={{ fontFamily: FM }}>
                      {r.category}
                    </span>
                  )}
                  {r.ai_audience_fit_score != null && (
                    <span style={{ fontFamily: FM }}>
                      AI score · <span style={{ color: C.text }}>{r.ai_audience_fit_score.toFixed(1)}</span>
                    </span>
                  )}
                  <span style={{ fontFamily: FM, color: C.textFaint }}>
                    scan {r.scan_id.slice(0, 8)}…
                  </span>
                </div>
                {r.one_line_pitch && (
                  <div style={{ fontSize: 12, color: C.textDim, marginTop: 6, fontStyle: "italic" }}>
                    &ldquo;{r.one_line_pitch}&rdquo;
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </Frame>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="v-page-pad"
      style={{
        maxWidth: 540,
        margin: "0 auto",
        textAlign: "center",
        paddingTop: 80,
      }}
    >
      {children}
    </div>
  );
}
