"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Sidebar } from "./sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isValidator = pathname?.startsWith("/validator");

  if (isValidator) {
    return <div className="min-h-screen">{children}</div>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-[232px] min-h-screen">
        <div className="max-w-[1240px] mx-auto px-7 py-7">{children}</div>
      </main>
    </div>
  );
}
