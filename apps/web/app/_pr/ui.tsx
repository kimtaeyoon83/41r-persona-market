"use client";

// Project RPM site redesign — shared tokens + shell for the new funnel pages
// (landing / detail / processing / report). Stripe-style visual language from
// the Claude Design handoff: indigo accent on a cool blue-grey field, Space
// Grotesk display + Hanken Grotesk body + JetBrains Mono numerals.
//
// Scoped to the redesigned funnel only — the existing validator/console/me
// pages keep their own theme (app/validator/_components/ui.tsx). Fonts come
// from layout.tsx (--font-pr-display / --font-pr-body / --font-mono-loaded).

import type { ReactNode } from "react";
import { TopBar } from "@/app/validator/_components/ui";

export const PR = {
  ink: "#0a2540",
  text: "#3c4a5e",
  dim: "#48566a",
  faint: "#8693a6",
  accent: "#635bff",
  accentSoft: "#ecebff",
  bg: "#f6f9fc",
  panel: "#ffffff",
  panelAlt: "#f0f4f9",
  border: "#e7ecf3",
  borderStrong: "#dbe3ee",
  // semantic
  green: "#1a9d54",
  greenSoft: "#e3f4ea",
  amber: "#bb7714",
  amberInk: "#8a5a12",
  amberSoft: "#f6ead0",
  red: "#d4604a",
  redInk: "#c0432a",
  // dark surfaces (processing card)
  navy: "#0a2540",
  navy2: "#15324f",
  navyText: "#eaf0f6",
  navyDim: "#9db2c8",
  navyFaint: "#7d93a8",
} as const;

export const FD = 'var(--font-pr-display), "Space Grotesk", system-ui, sans-serif';
export const FB = 'var(--font-pr-body), "Hanken Grotesk", system-ui, sans-serif';
export const FM = 'var(--font-mono-loaded), "JetBrains Mono", monospace';

/** Tone → score color (shared by report bars + cards). */
export function scoreTone(score: number | null | undefined): string {
  if (score == null) return PR.faint;
  if (score >= 60) return PR.green;
  if (score >= 40) return PR.amber;
  return PR.redInk;
}

/** Cool-blue page field under the unified TopBar. Funnel pages share the
 *  same persistent nav (Analyze · Dashboard · How it works · EN · auth) as
 *  every other screen — the redesign's "one navigation" rule — via the
 *  shared <TopBar>. `step` passes the funnel-step label ("2 / 4 · Sharpen")
 *  through to the bar. `right` is accepted for backward-compat with existing
 *  call sites but is no longer rendered (auth now lives in the shared bar). */
export function PrShell({
  children,
  step,
}: {
  children: ReactNode;
  /** @deprecated auth/nav now come from the shared TopBar; ignored. */
  right?: ReactNode;
  step?: string;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: PR.bg,
        color: PR.ink,
        fontFamily: FB,
      }}
    >
      <style>{`
        .pr-btn-primary:hover:not(:disabled){ filter:brightness(1.07); }
        .pr-chip{ cursor:pointer; transition:all .12s; }
        .pr-fade{ animation:prFade .3s ease both; }
        @keyframes prFade{ from{opacity:.5;transform:translateY(4px);} to{opacity:1;transform:none;} }
        .pr-link:hover{ text-decoration:underline; }
      `}</style>
      <TopBar step={step} />
      {children}
    </div>
  );
}

/** Primary indigo button matching the prototype's .btn-primary. */
export function PrButton({
  children,
  onClick,
  disabled,
  variant = "primary",
  style,
  type,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "outline";
  style?: React.CSSProperties;
  type?: "button" | "submit";
}) {
  const base: React.CSSProperties = {
    fontFamily: FB,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    border: "none",
    transition: "filter .15s, background .15s",
    borderRadius: 12,
    fontSize: 15,
    padding: "13px 22px",
  };
  const tone: React.CSSProperties =
    variant === "primary"
      ? { background: disabled ? PR.faint : PR.accent, color: "#fff" }
      : variant === "outline"
        ? {
            background: PR.panel,
            color: PR.ink,
            border: `1px solid ${PR.borderStrong}`,
            fontWeight: 600,
          }
        : { background: "none", color: PR.dim, fontWeight: 600 };
  return (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      className={variant === "primary" ? "pr-btn-primary" : undefined}
      style={{ ...base, ...tone, ...style }}
    >
      {children}
    </button>
  );
}

/** White rounded card matching the prototype's panel style. */
export function PrCard({
  children,
  style,
  pad = 22,
  shadow,
}: {
  children: ReactNode;
  style?: React.CSSProperties;
  pad?: number;
  shadow?: boolean;
}) {
  return (
    <div
      style={{
        background: PR.panel,
        border: `1px solid ${PR.border}`,
        borderRadius: 16,
        padding: pad,
        boxShadow: shadow ? "0 12px 30px -22px rgba(10,37,64,.28)" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
