"use client";

// ConsoleShell — GA-style admin layout for /console/* (2026-06-12).
//
// TopBar (global, orange-rule signature) + a persistent left rail:
// sites list with the active site expanded into its subnav
// (Overview / Reports / Analytics / Settings via ?tab=), an Add-site
// action, and a footer with the credit balance + My Page. Desktop is
// a sticky 232px rail; ≤768px it collapses to a horizontal strip
// (.cs-* in globals.css) so the mobile no-overflow contract holds.
//
// The rail fetches its own sites/credits — pages keep their own data
// fetching; both calls are cheap and cacheable later.

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  consoleApi,
  meApi,
  type ConsoleSiteListItem,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { C, FM, TopBar } from "../../validator/_components/ui";

const TABS = ["overview", "reports", "analytics", "settings"] as const;
export type ConsoleTab = (typeof TABS)[number];

// Crisp 16px line icons (replace the old emoji glyphs in the rail).
function Ico({ name }: { name: "grid" | "lock" | "plus" | "wallet" }) {
  const common = {
    className: "cs-ico",
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (name === "grid")
    return (
      <svg {...common}>
        <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2" />
        <rect x="9" y="2.5" width="4.5" height="4.5" rx="1.2" />
        <rect x="2.5" y="9" width="4.5" height="4.5" rx="1.2" />
        <rect x="9" y="9" width="4.5" height="4.5" rx="1.2" />
      </svg>
    );
  if (name === "lock")
    return (
      <svg {...common}>
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
        <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" />
      </svg>
    );
  if (name === "plus")
    return (
      <svg {...common}>
        <path d="M8 3.2v9.6M3.2 8h9.6" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="2" y="4" width="12" height="8.5" rx="2" />
      <path d="M10.6 8.2h2.2" />
    </svg>
  );
}

export function ConsoleShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { ready, authenticated } = useAuth();
  const { t } = useI18n();
  const [sites, setSites] = useState<ConsoleSiteListItem[] | null>(null);
  const [balanceCents, setBalanceCents] = useState<number | null>(null);

  useEffect(() => {
    if (!ready || !authenticated) return;
    let cancelled = false;
    Promise.all([consoleApi.listSites(), meApi.getCredits()])
      .then(([s, c]) => {
        if (cancelled) return;
        setSites(s.sites);
        setBalanceCents(c.balance_cents);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ready, authenticated, pathname]);

  const activeSiteId = pathname?.match(/\/console\/sites\/([0-9a-f-]{36})/)?.[1] ?? null;
  const activeTab = (searchParams?.get("tab") as ConsoleTab) || "overview";

  const tabLabel = (k: ConsoleTab) =>
    t(
      k === "overview"
        ? "console.overview"
        : k === "reports"
          ? "console.reports"
          : k === "analytics"
            ? "console.analytics"
            : "console.settings",
    );

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: C.bg,
        color: C.text,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <TopBar />
      <div className="cs-layout">
        <aside className="cs-side">
          <Link href="/console" className={`cs-item${pathname === "/console" ? " active" : ""}`}>
            <Ico name="grid" /> Overview
          </Link>

          <div className="cs-label">Sites</div>
          {sites === null ? (
            <div style={{ padding: "6px 10px", fontSize: 11, color: C.textFaint }}>…</div>
          ) : (
            sites.map((s) => {
              const isActive = s.id === activeSiteId;
              return (
                <div key={s.id}>
                  <Link
                    href={`/console/sites/${s.id}`}
                    className={`cs-item${isActive && activeTab === "overview" ? " active" : ""}`}
                    title={s.url_host}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: 2,
                        flexShrink: 0,
                        background: s.tracked ? C.ok : C.borderStrong,
                      }}
                    />
                    {s.name && s.name !== s.url_host ? s.name : s.url_host}
                  </Link>
                  {isActive && (
                    <div className="cs-sub">
                      {TABS.map((k) => (
                        <Link
                          key={k}
                          href={`/console/sites/${s.id}${k === "overview" ? "" : `?tab=${k}`}`}
                          className={`cs-item${activeTab === k ? " active" : ""}`}
                          style={{ fontSize: 11.5, padding: "5px 10px" }}
                        >
                          {tabLabel(k)}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <Link
            href="/console/sites/new"
            className={`cs-item${pathname === "/console/sites/new" ? " active" : ""}`}
            style={{ color: C.accent, fontWeight: 600 }}
          >
            <Ico name="plus" /> {t("console.addSite").replace(/^\+\s*/, "")}
          </Link>

          <div className="cs-label">Labs</div>
          <Link
            href="/console/mutual"
            className={`cs-item${pathname === "/console/mutual" ? " active" : ""}`}
            title="Mutual-sealed exchange — experimental (on-chain mint gated)"
          >
            <Ico name="lock" /> {t("mutual.nav")}
            <span className="cs-tag">BETA</span>
          </Link>

          <div className="cs-foot">
            {balanceCents != null && (
              <Link
                href="/me/points"
                className="cs-item"
                style={{ fontFamily: FM, fontSize: 11.5 }}
              >
                <Ico name="wallet" /> ${(balanceCents / 100).toFixed(2)} ·{" "}
                {t("console.creditsLeft")}
              </Link>
            )}
            <Link href="/me" className="cs-item">
              {t("nav.myPage")} →
            </Link>
          </div>
        </aside>
        <main className="cs-main">
          <div className="cs-inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
