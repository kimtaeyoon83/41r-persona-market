"use client";

// Audience-Fit Validator — shared UI primitives + theme constants.
// Ported from /tmp/41r-design/41r-new-proto/project/screens-v2.jsx
// (the v2.1 prototype). Inline styles match the design 1:1; the warm-
// light palette is scoped to /validator routes via the AppShell
// pathname bypass and does NOT touch globals.css.

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

// ─── Theme constants ──────────────────────────────────────────────
// 2026-06-12 design refresh — "warm editorial research instrument":
// deeper ink for type contrast, slightly warmer paper, richer
// terracotta accent, semantic tones tuned darker so score colors hold
// up at small sizes. The hover/elevation layer lives in globals.css
// (.e-card / .e-cta) since inline styles can't express :hover.
export const C = {
  bg: "#f8f5ef",
  panel: "#fffefb",
  border: "#e8e2d6",
  borderStrong: "#d2c9b8",
  text: "#221f1a",
  textDim: "#6b6457",
  textFaint: "#9c9384",
  accent: "#bc4a26",
  accentSoft: "#f7e7de",
  ok: "#2f7d4f",
  okSoft: "#e4f0e8",
  warn: "#a06b10",
  warnSoft: "#faefd6",
  bad: "#ad3b2c",
  badSoft: "#f8e2dd",
  exp: "#6d4fc4",
  expSoft: "#eee9fb",
} as const;

export const FS =
  'var(--font-sans-loaded), "Inter", "Pretendard", -apple-system, BlinkMacSystemFont, sans-serif';
export const FM =
  'var(--font-mono-loaded), "JetBrains Mono", "SF Mono", Menlo, monospace';

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "exp";

const PILL_TONES: Record<Tone, { bg: string; fg: string; bd: string }> = {
  neutral: { bg: "#f3f0e8", fg: C.textDim, bd: C.border },
  accent: { bg: C.accentSoft, fg: C.accent, bd: "#ecd6ca" },
  ok: { bg: C.okSoft, fg: C.ok, bd: "#cfe3d6" },
  warn: { bg: C.warnSoft, fg: C.warn, bd: "#ecdcb4" },
  bad: { bg: C.badSoft, fg: C.bad, bd: "#eccac4" },
  exp: { bg: C.expSoft, fg: C.exp, bd: "#dcd1f0" },
};

export function Pill({
  children,
  tone = "neutral",
  style,
}: {
  children: ReactNode;
  tone?: Tone;
  style?: CSSProperties;
}) {
  const t = PILL_TONES[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        background: t.bg,
        color: t.fg,
        border: `1px solid ${t.bd}`,
        lineHeight: 1.5,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

export function Bar({
  value,
  max = 100,
  color = C.accent,
  height = 6,
  bg = "#efece4",
}: {
  value: number;
  max?: number;
  color?: string;
  height?: number;
  bg?: string;
}) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div
      style={{
        width: "100%",
        height,
        background: bg,
        borderRadius: 999,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: color,
          borderRadius: 999,
          transition: "width .6s",
        }}
      />
    </div>
  );
}

export function Card({
  children,
  style,
  padding = 20,
}: {
  children: ReactNode;
  style?: CSSProperties;
  padding?: number;
}) {
  return (
    <div
      className="e-card"
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Btn({
  children,
  primary,
  onClick,
  style,
  href,
}: {
  children: ReactNode;
  primary?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  href?: string;
}) {
  const baseStyle: CSSProperties = {
    background: primary ? C.accent : C.panel,
    color: primary ? "#fff" : C.text,
    border: primary ? "none" : `1px solid ${C.border}`,
    borderRadius: 7,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: FS,
    textDecoration: "none",
    display: "inline-block",
    ...style,
  };
  if (href) {
    return (
      <Link href={href} style={baseStyle}>
        {children}
      </Link>
    );
  }
  return (
    <button onClick={onClick} style={baseStyle}>
      {children}
    </button>
  );
}

// Kept for backward-compat with existing `<Frame active="...">` call
// sites. The active prop no longer drives a nav highlight (the nav is
// gone), but Frame still accepts and ignores it so pages compile.
type TopBarActive = "discovery" | "pro" | "report" | "calibration";

/** Tiny EN/KO switch — decision §12-5: English default + Korean. */
function LocaleToggle() {
  const { locale, setLocale } = useI18n();
  return (
    <button
      onClick={() => setLocale(locale === "en" ? "ko" : "en")}
      title="Language"
      style={{
        background: "transparent",
        border: `1px solid ${C.border}`,
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 11,
        fontFamily: FM,
        color: C.textDim,
        cursor: "pointer",
        letterSpacing: "0.04em",
      }}
    >
      {locale === "en" ? "EN" : "KO"}
    </button>
  );
}

export function TopBar() {
  // Console Sprint 1 — logged-in nav is [Console · My Page · Sign out]
  // (console-ia-redesign.md §2.1: both roles always visible, role is
  // emergent; empty states are the onboarding). Stays a hairline
  // header — no dropdowns/mega-menus (Phase 4 minimal contract).
  const { ready, authenticated, login, logout, identityLabel } = useAuth();
  const { t } = useI18n();
  const showAuthControls = ready;
  return (
    <div
      style={{
        height: 54,
        borderBottom: `1px solid ${C.border}`,
        background: "rgba(255, 254, 251, 0.85)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        padding: "0 clamp(14px, 4vw, 24px)",
        gap: 16,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      <Link
        href="/"
        style={{
          display: "flex",
          alignItems: "center",
          textDecoration: "none",
          color: C.text,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo/rpm_black_horizontal.png"
          alt="41R"
          style={{ height: 22, width: "auto", display: "block" }}
        />
      </Link>
      <div style={{ flex: 1 }} />
      {showAuthControls && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 12,
            color: C.textDim,
          }}
        >
          <LocaleToggle />
          {authenticated ? (
            <>
              <Link
                href="/console"
                style={{
                  color: C.textDim,
                  textDecoration: "none",
                  padding: "6px 10px",
                  borderRadius: 6,
                }}
              >
                {t("nav.console")}
              </Link>
              <Link
                href="/me"
                style={{
                  color: C.textDim,
                  textDecoration: "none",
                  padding: "6px 10px",
                  borderRadius: 6,
                }}
              >
                {t("nav.myPage")}
              </Link>
              <button
                onClick={() => logout()}
                title={identityLabel ?? "Sign out"}
                style={{
                  background: "transparent",
                  border: `1px solid ${C.border}`,
                  borderRadius: 999,
                  padding: "5px 12px",
                  fontSize: 12,
                  color: C.textDim,
                  cursor: "pointer",
                  fontFamily: FS,
                }}
              >
                {t("nav.signOut")}
              </button>
            </>
          ) : (
            <button
              onClick={() => login()}
              style={{
                background: C.text,
                border: "none",
                borderRadius: 999,
                padding: "6px 14px",
                fontSize: 12,
                color: C.bg,
                cursor: "pointer",
                fontFamily: FS,
                fontWeight: 500,
              }}
            >
              {t("nav.signIn")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function Frame({
  children,
}: {
  children: ReactNode;
  /** No longer used — the TopBar no longer renders a nav highlight.
   *  Kept in the type so existing call sites (`<Frame active="...">`)
   *  keep compiling.
   */
  active?: TopBarActive;
}) {
  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: C.bg,
        fontFamily: FS,
        color: C.text,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TopBar />
      <div style={{ flex: 1, width: "100%" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto" }}>{children}</div>
      </div>
    </div>
  );
}

export function SectionLabel({
  n,
  label,
  sub,
  help,
}: {
  n: string | number;
  label: string;
  sub?: string;
  /** When set, renders a (?) help button after the section label.
   *  Click opens a popup explaining what the section means + how
   *  the numbers are computed. Wire to the methodology section in
   *  /validator/how-it-works for the long-form treatment. */
  help?: { title: string; body: ReactNode };
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        marginBottom: 10,
        marginTop: 4,
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontFamily: FM,
          color: C.textFaint,
          letterSpacing: "0.1em",
        }}
      >
        {String(n).padStart(2, "0")}
      </span>
      <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em" }}>
        {label}
      </span>
      {sub && <span style={{ fontSize: 12, color: C.textFaint }}>· {sub}</span>}
      {help && <HelpTip title={help.title}>{help.body}</HelpTip>}
    </div>
  );
}

/** Inline (?) icon button. Click toggles a small popup card with the
 *  explanation text + a "see methodology" link. Self-contained — no
 *  dependency on Radix / Headless UI. Keyboard-accessible (Esc closes,
 *  outside click closes). The popup is `position: absolute` relative
 *  to the (?) button so it follows the trigger; the dimming overlay
 *  is `position: fixed` so click-anywhere-else dismisses cleanly. */
export function HelpTip({
  title,
  children,
  size = 14,
}: {
  title: string;
  children: ReactNode;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative", display: "inline-block", marginLeft: 4 }}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        aria-label={`Help: ${title}`}
        title={title}
        style={{
          width: size,
          height: size,
          borderRadius: 999,
          border: `1px solid ${C.border}`,
          background: open ? C.text : "transparent",
          color: open ? C.bg : C.textDim,
          fontSize: 10,
          fontFamily: FM,
          fontWeight: 600,
          lineHeight: 1,
          cursor: "pointer",
          padding: 0,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          verticalAlign: "middle",
        }}
      >
        ?
      </button>
      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              background: "rgba(20, 18, 14, 0.35)",
              backdropFilter: "blur(2px)",
              WebkitBackdropFilter: "blur(2px)",
            }}
          />
          <div
            role="dialog"
            aria-label={title}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 51,
              width: 520,
              maxWidth: "calc(100vw - 32px)",
              maxHeight: "80vh",
              overflowY: "auto",
              padding: "16px 18px",
              background: C.panel,
              border: `1px solid ${C.borderStrong}`,
              borderRadius: 10,
              boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
              fontFamily: FS,
              fontSize: 12.5,
              lineHeight: 1.65,
              color: C.text,
              textAlign: "left",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
                paddingBottom: 10,
                borderBottom: `1px solid ${C.border}`,
              }}
            >
              <div
                style={{
                  fontFamily: FM,
                  fontSize: 11,
                  fontWeight: 600,
                  color: C.textDim,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {title}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  border: "none",
                  background: "transparent",
                  color: C.textDim,
                  fontSize: 16,
                  lineHeight: 1,
                  cursor: "pointer",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ×
              </button>
            </div>
            <div>{children}</div>
          </div>
        </>
      )}
    </span>
  );
}

export function PMFGauge({ value = 45 }: { value?: number }) {
  const W = 300;
  const H = 170;
  const cx = W / 2;
  const cy = H - 18;
  const r = 104;
  const arcPath = (s: number, e: number) => {
    const a1 = Math.PI * (1 - s / 100);
    const a2 = Math.PI * (1 - e / 100);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2);
    const y2 = cy - r * Math.sin(a2);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  };
  const ang = Math.PI * (1 - value / 100);
  const nx = cx + (r - 4) * Math.cos(ang);
  const ny = cy - (r - 4) * Math.sin(ang);
  const tone = value < 40 ? C.bad : value < 60 ? C.warn : C.ok;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
    >
      <path
        d={arcPath(0, 40)}
        stroke={C.bad}
        strokeWidth={16}
        fill="none"
        strokeLinecap="round"
      />
      <path d={arcPath(40, 60)} stroke={C.warn} strokeWidth={16} fill="none" />
      <path
        d={arcPath(60, 100)}
        stroke={C.ok}
        strokeWidth={16}
        fill="none"
        strokeLinecap="round"
      />
      <line
        x1={cx}
        y1={cy}
        x2={nx}
        y2={ny}
        stroke={C.text}
        strokeWidth={3}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={6} fill={C.text} />
      <text
        x={cx}
        y={cy - 46}
        textAnchor="middle"
        fontSize={42}
        fontWeight={600}
        fill={tone}
        fontFamily={FS}
        style={{ letterSpacing: "-0.03em" }}
      >
        {value}
      </text>
      <text
        x={cx}
        y={cy - 26}
        textAnchor="middle"
        fontSize={11}
        fill={C.textFaint}
        fontFamily={FM}
        style={{ letterSpacing: "0.1em" }}
      >
        / 100
      </text>
      <text x={cx - r + 4} y={cy + 14} fontSize={10} fill={C.bad} fontFamily={FM}>
        RED
      </text>
      <text
        x={cx + r - 4}
        y={cy + 14}
        fontSize={10}
        fill={C.ok}
        fontFamily={FM}
        textAnchor="end"
      >
        SAFE
      </text>
    </svg>
  );
}

export function RetentionCurve({
  data = [
    { d: "D-1", v: 80 },
    { d: "D-3", v: 65 },
    { d: "D-7", v: 40 },
    { d: "D-30", v: 18 },
  ],
}: {
  data?: { d: string; v: number }[];
}) {
  const W = 460;
  const H = 190;
  const P = 34;
  const x = (i: number) => P + (i / (data.length - 1)) * (W - P * 2);
  const y = (v: number) => H - P - (v / 100) * (H - P * 2 - 12);
  const pts = data.map((d, i) => [x(i), y(d.v)] as const);
  const path = pts.map((p, i) => `${i ? "L" : "M"} ${p[0]} ${p[1]}`).join(" ");
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  const fill = `${path} L ${last[0]} ${H - P} L ${first[0]} ${H - P} Z`;
  return (
    <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }}>
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line
            x1={P}
            x2={W - P}
            y1={y(g)}
            y2={y(g)}
            stroke="#ebe8e0"
            strokeWidth={1}
          />
          <text x={6} y={y(g) + 3} fontSize={9} fill={C.textFaint} fontFamily={FM}>
            {g}%
          </text>
        </g>
      ))}
      <path d={fill} fill={C.accentSoft} />
      <path
        d={path}
        stroke={C.accent}
        strokeWidth={2.5}
        fill="none"
        strokeLinejoin="round"
      />
      {data.map((d, i) => (
        <g key={d.d}>
          <circle
            cx={pts[i]![0]}
            cy={pts[i]![1]}
            r={5}
            fill="#fff"
            stroke={C.accent}
            strokeWidth={2.5}
          />
          <text
            x={pts[i]![0]}
            y={pts[i]![1] - 12}
            fontSize={11}
            fontWeight={600}
            textAnchor="middle"
            fill={C.text}
            fontFamily={FM}
          >
            {d.v}%
          </text>
          <text
            x={pts[i]![0]}
            y={H - 12}
            fontSize={11}
            textAnchor="middle"
            fill={C.textDim}
            fontFamily={FM}
          >
            {d.d}
          </text>
        </g>
      ))}
    </svg>
  );
}

export type CalibVersion = {
  v: string;
  d: string;
  hap: number;
  eng: number;
  tsk: number;
  ado: number;
  ret: number;
  current?: boolean;
};

export function WeightChart({ versions }: { versions: CalibVersion[] }) {
  const dims: {
    key: keyof Omit<CalibVersion, "v" | "d" | "current">;
    label: string;
    color: string;
  }[] = [
    { key: "eng", label: "Engagement", color: C.ok },
    { key: "tsk", label: "Onboarding", color: "#5b8bd0" },
    { key: "hap", label: "Sentiment", color: C.accent },
    { key: "ado", label: "Discovery", color: C.warn },
    { key: "ret", label: "Retention", color: C.exp },
  ];
  const W = 900;
  const H = 220;
  const P = 28;
  const yMax = 0.5;
  const x = (i: number) => P + (i / (versions.length - 1)) * (W - P * 2);
  const y = (v: number) => H - P - (v / yMax) * (H - P * 2);
  const lastV = versions[versions.length - 1]!;
  return (
    <svg width={W} height={H} style={{ display: "block", maxWidth: "100%" }}>
      {[0, 0.1, 0.2, 0.3, 0.4, 0.5].map((g) => (
        <g key={g}>
          <line
            x1={P}
            x2={W - P}
            y1={y(g)}
            y2={y(g)}
            stroke="#ebe8e0"
            strokeWidth={1}
          />
          <text x={6} y={y(g) + 3} fontSize={10} fill={C.textFaint} fontFamily={FM}>
            {g.toFixed(1)}
          </text>
        </g>
      ))}
      {versions.map((v, i) => (
        <text
          key={v.v}
          x={x(i)}
          y={H - 6}
          fontSize={11}
          fill={C.textDim}
          textAnchor="middle"
          fontFamily={FM}
        >
          {v.v} · {v.d}
        </text>
      ))}
      {dims.map((d) => {
        const path = versions
          .map((v, i) => `${i ? "L" : "M"} ${x(i)} ${y(v[d.key])}`)
          .join(" ");
        return (
          <g key={d.key}>
            <path
              d={path}
              stroke={d.color}
              strokeWidth={2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {versions.map((v, i) => (
              <circle
                key={i}
                cx={x(i)}
                cy={y(v[d.key])}
                r={3.5}
                fill="#fff"
                stroke={d.color}
                strokeWidth={2}
              />
            ))}
            <text
              x={x(versions.length - 1) + 8}
              y={y(lastV[d.key]) + 4}
              fontSize={11}
              fill={d.color}
              fontWeight={600}
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export type PersonaCardData = {
  id: string;
  name: string;
  age: number;
  role: string;
  score: number | null;
  quote: string;
  tags: string[];
  is_synthetic: boolean;
};

export function PersonaBoard({
  tone,
  label,
  personas,
  scanId,
}: {
  tone: "ok" | "bad";
  label: string;
  personas: PersonaCardData[];
  scanId?: string;
}) {
  const cfg =
    tone === "ok"
      ? { fg: C.ok, bg: C.okSoft, bd: "#cfe3d6" }
      : { fg: C.bad, bg: C.badSoft, bd: "#eccac4" };
  return (
    <div
      style={{
        padding: 14,
        background: cfg.bg,
        border: `1px solid ${cfg.bd}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: cfg.fg,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontWeight: 600,
          }}
        >
          {label}
        </div>
        <span style={{ fontSize: 11, color: C.textFaint, fontFamily: FM }}>
          top 3 · click for detail
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {personas.map((p) => (
          <Link
            key={p.id}
            href={
              scanId
                ? `/validator/persona/${p.id}?scan=${scanId}`
                : `/validator/persona/${p.id}`
            }
            style={{
              padding: 12,
              background: "#fff",
              borderRadius: 8,
              border: `1px solid ${cfg.bd}`,
              cursor: "pointer",
              textDecoration: "none",
              color: "inherit",
              display: "block",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  background: cfg.bg,
                  color: cfg.fg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                  fontSize: 12,
                  fontFamily: FS,
                }}
              >
                {p.name.split(" ")[0]![0]}
              </div>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                  }}
                >
                  <span>
                    {/* Strip the role prefix from the displayed name so
                        seed personas read "#9, 25 / Crypto Native" rather
                        than "Crypto Native #9, 25 / Crypto Native". Real
                        names ("Alice Chen") are kept intact. */}
                    {p.name
                      .toLowerCase()
                      .startsWith(p.role.toLowerCase() + " ")
                      ? p.name.slice(p.role.length + 1)
                      : p.name}
                    , {p.age}
                  </span>
                  {p.is_synthetic && (
                    <span
                      title="Synthetic AI persona — not a real user"
                      style={{
                        fontSize: 9,
                        fontFamily: FM,
                        fontWeight: 500,
                        color: C.textFaint,
                        background: "#f3f0e8",
                        padding: "1px 5px",
                        borderRadius: 3,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      synth
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.textDim }}>{p.role}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    color: cfg.fg,
                    lineHeight: 1,
                    fontFamily: FM,
                  }}
                >
                  {p.score ?? "—"}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: C.textFaint,
                    fontFamily: FM,
                    marginTop: 2,
                  }}
                >
                  FIT
                </div>
              </div>
            </div>
            <div
              style={{
                padding: "6px 8px",
                background: "#f7f4ec",
                borderRadius: 5,
                fontSize: 11,
                fontStyle: "italic",
                color: C.text,
                lineHeight: 1.5,
                marginBottom: 6,
              }}
            >
              &ldquo;{p.quote}&rdquo;
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {p.tags.map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 10,
                    padding: "1px 6px",
                    background: "#f3f0e8",
                    color: C.textDim,
                    borderRadius: 3,
                    fontFamily: FM,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
