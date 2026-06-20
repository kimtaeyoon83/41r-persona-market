"use client";

// /console/sites/new — 1-step site registration (Console S2, §7.2).
//
// Deliberately ONE step: URL in → workspace + keys out. The snippet /
// secret onboarding moved out of the critical path because competitor
// /watch registrations would only be slowed by it; the success state
// shows the secret ONCE (server keeps a hash) with the snippet copy
// box, then hands off to the site detail.

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { consoleApi, API_BASE, type ConsoleSite } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { checkTargetUrl } from "@/lib/url";
import { C, FM, FS } from "../../../validator/_components/ui";
import { ConsoleShell } from "../../_components/shell";

export default function NewSitePage() {
  return (
    <Suspense fallback={null}>
      <NewSiteInner />
    </Suspense>
  );
}

function NewSiteInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, authenticated, login } = useAuth();
  const { t } = useI18n();

  const [url, setUrl] = useState(params.get("url") ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ workspace: ConsoleSite; secret: string } | null>(
    null,
  );
  const [copied, setCopied] = useState<"secret" | "snippet" | null>(null);

  const onSubmit = async () => {
    if (submitting || !url.trim()) return;
    if (!authenticated) {
      if (ready) login();
      return;
    }
    // Security gate (2026-06-15) — reject hostile / non-public hosts
    // before registration; server re-validates authoritatively.
    const check = checkTargetUrl(url);
    if (!check.ok) {
      setError(t(check.reason === "private_host" ? "url.private" : "url.invalid"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await consoleApi.createSite({ url: check.normalized });
      setCreated(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const copy = (text: string, which: "secret" | "snippet") => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1600);
    });
  };

  const snippet = created
    ? `<script src="${API_BASE}/api/partner/t.js" data-site="${created.workspace.site_key}" async></script>`
    : "";

  return (
    <ConsoleShell>
      <div style={{ maxWidth: 640 }}>

        {!created ? (
          <>
            <h1 style={{ fontSize: 26, fontWeight: 600, fontFamily: FS, marginBottom: 8 }}>
              {t("console.newSiteTitle")}
            </h1>
            <div style={{ fontSize: 13, color: C.textDim, marginBottom: 24, lineHeight: 1.6 }}>
              {t("console.newSiteSub")}
            </div>

            <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
              {t("console.urlLabel")}
            </label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSubmit()}
              placeholder="example.com"
              autoFocus
              style={{
                width: "100%",
                padding: "11px 14px",
                fontSize: 14,
                fontFamily: FM,
                border: `1px solid ${C.border}`,
                borderRadius: 8,
                background: C.panel,
                color: C.text,
                outline: "none",
                marginBottom: 14,
                boxSizing: "border-box",
              }}
            />
            {error && (
              <div style={{ color: C.bad, fontSize: 13, marginBottom: 12 }}>{error}</div>
            )}
            <button
              onClick={onSubmit}
              disabled={submitting || !url.trim()}
              style={{
                background: C.accent,
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "11px 22px",
                fontSize: 13,
                fontWeight: 600,
                cursor: submitting ? "default" : "pointer",
                opacity: submitting || !url.trim() ? 0.6 : 1,
                fontFamily: FS,
              }}
            >
              {submitting ? t("console.creating") : t("console.create")}
            </button>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 24, fontWeight: 600, fontFamily: FS, marginBottom: 6 }}>
              ✓ {created.workspace.url_host}
            </h1>

            {/* Secret — shown once */}
            <div
              style={{
                padding: 16,
                background: C.warnSoft,
                border: "1px solid #dbe3ee",
                borderRadius: 14,
                marginTop: 16,
                marginBottom: 14,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: C.warn, marginBottom: 8 }}>
                {t("console.secretOnce")}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <code
                  style={{
                    fontFamily: FM,
                    fontSize: 12,
                    background: "#fff",
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    padding: "8px 10px",
                    wordBreak: "break-all",
                    flex: 1,
                    minWidth: 240,
                  }}
                >
                  {created.secret}
                </code>
                <button onClick={() => copy(created.secret, "secret")} style={btnGhost}>
                  {copied === "secret" ? t("console.copiedSecret") : t("console.copy")}
                </button>
              </div>
            </div>

            {/* Snippet */}
            <div
              style={{
                padding: 16,
                background: C.panel,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                marginBottom: 18,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                {t("console.snippetLabel")}
              </div>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 10 }}>
                {t("console.snippetHelp")}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <code
                  style={{
                    fontFamily: FM,
                    fontSize: 11,
                    background: "#f4f5f6",
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    padding: "8px 10px",
                    wordBreak: "break-all",
                    flex: 1,
                    minWidth: 240,
                  }}
                >
                  {snippet}
                </code>
                <button onClick={() => copy(snippet, "snippet")} style={btnGhost}>
                  {copied === "snippet" ? t("console.copied") : t("console.copy")}
                </button>
              </div>
            </div>

            <button
              onClick={() => router.push(`/console/sites/${created.workspace.id}`)}
              style={{
                background: C.text,
                color: C.bg,
                border: "none",
                borderRadius: 8,
                padding: "11px 22px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: FS,
              }}
            >
              {t("console.goToSite")}
            </button>
          </>
        )}
      </div>
    </ConsoleShell>
  );
}

const btnGhost: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${C.border}`,
  borderRadius: 7,
  padding: "7px 13px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: FS,
  color: C.text,
};
