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
            <span style={{ fontFamily: FM, fontSize: 11 }}>▦</span> {t("console.title")}
          </Link>
          <Link
            href="/console/mutual"
            className={`cs-item${pathname === "/console/mutual" ? " active" : ""}`}
          >
            <span style={{ fontFamily: FM, fontSize: 11 }}>⇄</span> {t("mutual.nav")}
          </Link>

          <div className="cs-label">{t("console.title")}</div>
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
            {t("console.addSite")}
          </Link>

          <div className="cs-foot">
            {balanceCents != null && (
              <Link
                href="/me/points"
                className="cs-item"
                style={{ fontFamily: FM, fontSize: 11.5 }}
              >
                ${(balanceCents / 100).toFixed(2)} · {t("console.creditsLeft")}
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
