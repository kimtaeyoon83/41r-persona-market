"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { WalletButton } from "./wallet-button";
import { TweaksPanel } from "./tweaks-panel";

type NavChild = { label: string; href: string };
type NavItem = { label: string; href: string; icon: ReactNode; children?: NavChild[] };
type NavSection = { title: string | null; items: NavItem[]; collapsible?: boolean; id?: string };

const icons = {
  overview: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  company: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  tester: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  personas: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
  autotest: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  experiment: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v6l-5 9a2 2 0 001.7 3h12.6a2 2 0 001.7-3l-5-9V3M9 3h6M9 12h6" />
    </svg>
  ),
  bsc: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l2.39 7.36H22l-6.2 4.5 2.39 7.36L12 16.72l-6.19 4.5 2.39-7.36L2 9.36h7.61L12 2z" />
    </svg>
  ),
  x402: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

export type AppRole = "company" | "tester";

const commonTopSection: NavSection = {
  title: null,
  items: [{ label: "Overview", href: "/", icon: icons.overview }],
};

const sectionsByRole: Record<AppRole, NavSection[]> = {
  company: [
    {
      title: "Tests",
      items: [
        {
          label: "My Tests",
          href: "/company",
          icon: icons.company,
          children: [
            { label: "Dashboard", href: "/company" },
            { label: "Register Test", href: "/company/register" },
          ],
        },
        { label: "Auto Test", href: "/autotest", icon: icons.autotest },
      ],
    },
    {
      title: "Research",
      items: [
        { label: "Persona Market", href: "/persona", icon: icons.personas },
        { label: "Experiments", href: "/experiment", icon: icons.experiment },
      ],
    },
  ],
  tester: [
    {
      title: "Earn",
      items: [
        {
          label: "Tests",
          href: "/tester",
          icon: icons.tester,
          children: [
            { label: "Available Tests", href: "/tester/tests" },
            { label: "Profile", href: "/tester/profile" },
            { label: "All Testers", href: "/tester/list" },
          ],
        },
      ],
    },
    {
      title: "Your Persona",
      items: [{ label: "Personas", href: "/persona", icon: icons.personas }],
    },
  ],
};

const devDemoSection: NavSection = {
  id: "dev-demo",
  title: "Dev & Demo",
  collapsible: true,
  items: [
    { label: "Auto Test (BSC)", href: "/autotest-bsc", icon: icons.bsc },
    { label: "x402 Demo", href: "/x402", icon: icons.x402 },
  ],
};

function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function isExactRoute(pathname: string, href: string): boolean {
  return pathname === href;
}

function NavEntry({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isRouteActive(pathname, item.href);
  return (
    <div>
      <Link
        href={item.href}
        className={`group flex items-center gap-2.5 px-2.5 py-1.5 rounded-[var(--r-2)] text-[13px] transition-colors ${
          active
            ? "bg-[var(--bg-2)] text-[var(--fg-0)] font-medium"
            : "text-[var(--fg-1)] hover:text-[var(--fg-0)] hover:bg-[var(--bg-1)]"
        }`}
      >
        <span className={`${active ? "text-[var(--fg-0)]" : "text-[var(--fg-2)] group-hover:text-[var(--fg-1)]"}`}>
          {item.icon}
        </span>
        <span className="flex-1">{item.label}</span>
      </Link>
      {item.children && active && (
        <div className="ml-[22px] mt-0.5 space-y-px border-l border-[var(--line-1)] pl-2.5">
          {item.children.map((child) => (
            <Link
              key={child.href}
              href={child.href}
              className={`block px-2.5 py-1 rounded text-[12px] transition-colors ${
                isExactRoute(pathname, child.href)
                  ? "text-[var(--fg-0)]"
                  : "text-[var(--fg-2)] hover:text-[var(--fg-1)]"
              }`}
            >
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionBlock({ section, pathname }: { section: NavSection; pathname: string }) {
  const hasActive = section.items.some((it) => isRouteActive(pathname, it.href));
  const storageKey = section.id ? `sidebar:${section.id}:open` : null;
  const [open, setOpen] = useState<boolean>(() => (section.collapsible ? hasActive : true));

  useEffect(() => {
    if (!section.collapsible || !storageKey) return;
    const saved = window.localStorage.getItem(storageKey);
    if (saved !== null) setOpen(saved === "1");
  }, [section.collapsible, storageKey]);

  useEffect(() => {
    if (hasActive && !open) setOpen(true);
  }, [hasActive, open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey) window.localStorage.setItem(storageKey, next ? "1" : "0");
  };

  return (
    <div className="mb-2">
      {section.title && (
        section.collapsible ? (
          <button
            type="button"
            onClick={toggle}
            className="w-full flex items-center justify-between px-2.5 pt-3 pb-1 t-label hover:text-[var(--fg-1)] transition-colors"
          >
            <span>{section.title}</span>
            <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        ) : (
          <div className="px-2.5 pt-3 pb-1 t-label">
            {section.title}
          </div>
        )
      )}
      {open && (
        <div className="space-y-0.5">
          {section.items.map((item) => (
            <NavEntry key={item.href} item={item} pathname={pathname} />
          ))}
        </div>
      )}
    </div>
  );
}

const ROLE_STORAGE_KEY = "sidebar:role";

export function useAppRole() {
  const [role, setRoleState] = useState<AppRole>("company");
  useEffect(() => {
    const saved = window.localStorage.getItem(ROLE_STORAGE_KEY) as AppRole | null;
    if (saved === "company" || saved === "tester") setRoleState(saved);
  }, []);
  const setRole = (next: AppRole) => {
    setRoleState(next);
    window.localStorage.setItem(ROLE_STORAGE_KEY, next);
    window.dispatchEvent(new CustomEvent("41r:role", { detail: next }));
  };
  useEffect(() => {
    function onRole(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (detail === "company" || detail === "tester") setRoleState(detail);
    }
    window.addEventListener("41r:role", onRole);
    return () => window.removeEventListener("41r:role", onRole);
  }, []);
  return { role, setRole };
}

export function Sidebar() {
  const pathname = usePathname();
  const { role, setRole } = useAppRole();
  const sections = [commonTopSection, ...sectionsByRole[role], devDemoSection];

  return (
    <aside className="fixed left-0 top-0 h-full w-[232px] bg-[var(--bg-0)] border-r border-[var(--line-1)] flex flex-col z-40">
      {/* Logo — Hi-Fi block + wordmark */}
      <div className="px-4 pt-4 pb-3">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-sol-green to-sol-purple grid place-items-center text-[var(--bg-0)] font-display font-bold text-sm">
            4
          </div>
          <span className="font-display font-semibold tracking-tight text-[15px]">41rpm</span>
        </Link>
      </div>

      {/* Role switcher */}
      <div className="mx-4 mb-2">
        <div
          className="grid grid-cols-2 gap-[2px] p-[2px] border border-[var(--line-1)] rounded-[var(--r-2)]"
          style={{ background: "var(--bg-2)" }}
        >
          {(["company", "tester"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRole(r)}
              className={`py-1.5 text-[12px] font-medium rounded capitalize transition-colors ${
                role === r ? "text-[var(--fg-0)]" : "text-[var(--fg-2)] hover:text-[var(--fg-1)]"
              }`}
              style={role === r ? { background: "var(--bg-4)" } : {}}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Devnet beta chip */}
      <div className="mx-4 mb-3">
        <span className="chip accent">
          <span className="chip-dot pulse-dot" />
          Devnet · Beta
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 overflow-y-auto">
        {sections.map((section, idx) => (
          <SectionBlock key={section.id ?? idx} section={section} pathname={pathname} />
        ))}
      </nav>

      {/* Footer: 41R token card + wallet */}
      <div className="mt-auto px-3 py-3 border-t border-[var(--line-1)] space-y-2">
        <a
          href="https://explorer.solana.com/address/GeriorgNHG6o7XGA2xqLyjexqaFxq8nYDvYdJ37qACpS?cluster=devnet"
          target="_blank"
          rel="noopener noreferrer"
          className="hf-card block px-3 py-2.5 hover:border-[var(--line-2)] transition-colors group"
          style={{ background: "var(--bg-1)" }}
        >
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-full bg-sol-purple/15 grid place-items-center">
              <span className="text-[9px] font-mono font-bold text-sol-purple">41R</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="t-body-s font-medium text-[var(--fg-1)] group-hover:text-[var(--fg-0)] transition-colors">41R Token</p>
              <p className="addr truncate">Geriorg…qACpS</p>
            </div>
            <svg className="w-3 h-3 text-[var(--fg-3)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </div>
        </a>

        <WalletButton />
        <TweaksPanel />
      </div>
    </aside>
  );
}
