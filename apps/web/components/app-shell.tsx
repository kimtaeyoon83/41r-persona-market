// Phase 1 simplification — Sidebar (autotest-era nav) moved to
// backup/web/components/sidebar.tsx. Validator pages render their own
// Frame from app/validator/_components/ui.tsx; non-validator routes
// either redirect to /validator (homepage) or are gone entirely.
// Phase 4 will replace this shell with the Privy-aware version.

import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return <div className="min-h-screen">{children}</div>;
}
