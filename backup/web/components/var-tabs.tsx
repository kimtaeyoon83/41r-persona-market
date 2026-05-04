"use client";

/**
 * Small layout-variation switcher inspired by the Hi-Fi bundle. Use to
 * let a page show the same data through 2-3 different lenses without
 * navigating away — e.g., Home = Overview / Activity / Stats.
 */
export function VarTabs({
  variants,
  active,
  onChange,
}: {
  variants: string[];
  active: number;
  onChange: (next: number) => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-[2px] p-[2px] rounded-[var(--r-2)] border border-[var(--line-1)]"
      style={{ background: "var(--bg-1)" }}
    >
      {variants.map((v, i) => (
        <button
          key={v}
          onClick={() => onChange(i)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] transition-colors ${
            active === i
              ? "text-[var(--fg-0)] font-medium"
              : "text-[var(--fg-2)] hover:text-[var(--fg-1)]"
          }`}
          style={active === i ? { background: "var(--bg-4)" } : {}}
        >
          <span className="font-mono text-[10px] text-[var(--fg-3)]">
            {String(i + 1).padStart(2, "0")}
          </span>
          {v}
        </button>
      ))}
    </div>
  );
}
