import type { ReactNode } from "react";

interface TopbarProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Optional chip / breadcrumb slot rendered above the title. */
  eyebrow?: ReactNode;
}

/**
 * Page-level header inspired by the Hi-Fi design. Hairline bottom border,
 * gradient bg-1→bg-0, 28px horizontal padding. Drop into the top of any
 * page that needs a consistent title treatment.
 */
export function Topbar({ title, subtitle, actions, eyebrow }: TopbarProps) {
  return (
    <div
      className="-mx-7 -mt-7 mb-6 px-7 py-[18px] border-b border-[var(--line-1)] flex items-end justify-between gap-4"
      style={{ background: "linear-gradient(to bottom, var(--bg-1), var(--bg-0))" }}
    >
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
        <h1 className="t-display-m m-0">{title}</h1>
        {subtitle && <div className="t-caption mt-1">{subtitle}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
