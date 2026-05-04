"use client";

import { useEffect, useState } from "react";

const ACCENT_PRESETS = [
  { name: "Solana", h: 155, color: "#14F195" },
  { name: "Violet", h: 280, color: "oklch(0.70 0.18 280)" },
  { name: "Azure",  h: 230, color: "oklch(0.70 0.18 230)" },
  { name: "Lime",   h: 130, color: "oklch(0.70 0.18 130)" },
  { name: "Amber",  h: 60,  color: "oklch(0.70 0.18 60)" },
  { name: "Rose",   h: 10,  color: "oklch(0.70 0.18 10)" },
];

const FONT_OPTIONS = ["Inter Tight", "Geist", "Manrope", "Space Grotesk", "Inter"];

interface Tweaks {
  accentHue: number;
  headlineFont: string;
  density: "compact" | "default" | "comfortable";
  radius: "sharp" | "default" | "round";
}

const DEFAULT_TWEAKS: Tweaks = {
  accentHue: 155, // Solana green
  headlineFont: "Inter Tight",
  density: "default",
  radius: "default",
};

const STORAGE_KEY = "41r:tweaks";

function applyTweaks(t: Tweaks) {
  const root = document.documentElement;
  // Hue 155 is the Solana-green hue — keep the exact brand color in that slot,
  // otherwise swap to OKLCH at the requested hue.
  const isSolana = t.accentHue === 155;
  const accent = isSolana ? "#14F195" : `oklch(0.70 0.18 ${t.accentHue})`;
  const accentSoft = isSolana ? "rgba(20, 241, 149, 0.14)" : `oklch(0.70 0.18 ${t.accentHue} / 0.14)`;
  const accentLine = isSolana ? "rgba(20, 241, 149, 0.32)" : `oklch(0.70 0.18 ${t.accentHue} / 0.32)`;
  root.style.setProperty("--accent", accent);
  root.style.setProperty("--accent-soft", accentSoft);
  root.style.setProperty("--accent-line", accentLine);

  root.style.setProperty(
    "--font-display",
    `'${t.headlineFont}', var(--font-display-loaded), ui-sans-serif, system-ui, sans-serif`,
  );

  document.body.dataset.density = t.density;
  document.body.dataset.radius = t.radius;
}

export function TweaksPanel() {
  const [open, setOpen] = useState(false);
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = { ...DEFAULT_TWEAKS, ...JSON.parse(raw) } as Tweaks;
        setTweaks(parsed);
        applyTweaks(parsed);
        return;
      }
    } catch { /* fall through */ }
    applyTweaks(DEFAULT_TWEAKS);
  }, []);

  function update<K extends keyof Tweaks>(key: K, value: Tweaks[K]) {
    const next = { ...tweaks, [key]: value };
    setTweaks(next);
    applyTweaks(next);
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="hf-btn ghost sm"
        style={{ width: "100%" }}
        aria-label="Open tweaks panel"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9 1.65 1.65 0 0 0 4.27 7.18l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Tweaks
      </button>

      {open && (
        <div
          className="fixed bottom-5 right-5 z-50 hf-card overflow-hidden"
          style={{ width: 320, boxShadow: "0 20px 60px oklch(0 0 0 / 0.6)" }}
        >
          <div
            className="flex items-center justify-between px-3.5 py-3 border-b border-[var(--line-1)]"
            style={{ background: "var(--bg-2)" }}
          >
            <div className="flex items-center gap-2">
              <span className="chip-dot" style={{ color: "var(--accent)" }} />
              <span className="t-body-s font-medium">Tweaks</span>
            </div>
            <button
              className="hf-btn ghost sm"
              style={{ padding: 4, minWidth: 0, height: 24 }}
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="p-3.5 flex flex-col gap-3.5">
            <div>
              <div className="t-label mb-1.5">Accent color</div>
              <div className="grid grid-cols-6 gap-1.5">
                {ACCENT_PRESETS.map((p) => (
                  <button
                    key={p.h}
                    onClick={() => update("accentHue", p.h)}
                    title={p.name}
                    style={{
                      height: 30,
                      borderRadius: "var(--r-2)",
                      background: p.color,
                      border: tweaks.accentHue === p.h ? "2px solid var(--fg-0)" : "2px solid transparent",
                      cursor: "pointer",
                    }}
                  />
                ))}
              </div>
              <input
                type="range"
                min="0"
                max="360"
                value={tweaks.accentHue}
                onChange={(e) => update("accentHue", +e.target.value)}
                style={{ width: "100%", marginTop: 8, accentColor: "var(--accent)" }}
              />
              <div className="flex items-center justify-between mt-0.5">
                <span className="t-caption">Hue</span>
                <span className="addr">{tweaks.accentHue}°</span>
              </div>
            </div>

            <div>
              <div className="t-label mb-1.5">Headline font</div>
              <div className="flex flex-col gap-[3px]">
                {FONT_OPTIONS.map((f) => (
                  <button
                    key={f}
                    onClick={() => update("headlineFont", f)}
                    style={{
                      padding: "7px 10px",
                      borderRadius: "var(--r-2)",
                      textAlign: "left",
                      background: tweaks.headlineFont === f ? "var(--accent-soft)" : "var(--bg-2)",
                      color: tweaks.headlineFont === f ? "var(--accent)" : "var(--fg-0)",
                      fontFamily: `'${f}', sans-serif`,
                      fontSize: 13,
                      fontWeight: 600,
                      letterSpacing: "-0.02em",
                      border: tweaks.headlineFont === f ? "1px solid var(--accent-line)" : "1px solid var(--line-1)",
                      cursor: "pointer",
                    }}
                  >
                    {f}
                    <span
                      style={{
                        float: "right",
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        fontWeight: 400,
                        color: "var(--fg-3)",
                      }}
                    >
                      Aa 123
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="t-label mb-1.5">Density</div>
              <div
                className="grid grid-cols-3 gap-[3px] p-[2px] rounded-[var(--r-2)] border border-[var(--line-1)]"
                style={{ background: "var(--bg-2)" }}
              >
                {(["compact", "default", "comfortable"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => update("density", d)}
                    className="capitalize text-[11px] font-medium"
                    style={{
                      padding: "6px 0",
                      borderRadius: 4,
                      background: tweaks.density === d ? "var(--bg-4)" : "transparent",
                      color: tweaks.density === d ? "var(--fg-0)" : "var(--fg-2)",
                      cursor: "pointer",
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="t-label mb-1.5">Shape</div>
              <div
                className="grid grid-cols-3 gap-[3px] p-[2px] rounded-[var(--r-2)] border border-[var(--line-1)]"
                style={{ background: "var(--bg-2)" }}
              >
                {([
                  { k: "sharp", l: "Sharp", r: 2 },
                  { k: "default", l: "Default", r: 8 },
                  { k: "round", l: "Round", r: 14 },
                ] as const).map((d) => (
                  <button
                    key={d.k}
                    onClick={() => update("radius", d.k)}
                    style={{
                      padding: "6px 0",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 500,
                      background: tweaks.radius === d.k ? "var(--bg-4)" : "transparent",
                      color: tweaks.radius === d.k ? "var(--fg-0)" : "var(--fg-2)",
                      cursor: "pointer",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 10,
                        height: 10,
                        borderRadius: d.r,
                        background: "var(--accent)",
                        marginRight: 6,
                        verticalAlign: "middle",
                      }}
                    />
                    {d.l}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
