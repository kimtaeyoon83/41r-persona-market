"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { WalletButton } from "./wallet-button";

const navItems = [
  {
    label: "Overview",
    href: "/",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
      </svg>
    ),
  },
  {
    label: "Company",
    href: "/company",
    children: [
      { label: "Dashboard", href: "/company" },
      { label: "Register Test", href: "/company/register" },
    ],
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    label: "Tester",
    href: "/tester",
    children: [
      { label: "All Testers", href: "/tester/list" },
      { label: "Available Tests", href: "/tester/tests" },
      { label: "Profile", href: "/tester/profile" },
    ],
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
  },
  {
    label: "Personas",
    href: "/persona",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    label: "Auto Test",
    href: "/autotest",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    label: "Auto Test (BSC)",
    href: "/autotest-bsc",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l2.39 7.36H22l-6.2 4.5 2.39 7.36L12 16.72l-6.19 4.5 2.39-7.36L2 9.36h7.61L12 2z" />
      </svg>
    ),
  },
  {
    label: "x402 Demo",
    href: "/x402",
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

function isRouteActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

function isExactRoute(pathname: string, href: string): boolean {
  return pathname === href;
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 h-full w-[260px] bg-surface border-r border-border-dim flex flex-col z-40">
      {/* Logo */}
      <div className="px-5 pt-5 pb-4">
        <Link href="/" className="flex items-center gap-3">
          {/* Solana-style logo mark */}
          <div className="relative w-8 h-8 flex items-center justify-center">
            <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-sol-green/20 to-sol-purple/20" />
            <span className="relative font-display font-bold text-sm sol-gradient-text">41</span>
          </div>
          <div className="flex flex-col">
            <span className="font-display font-bold text-sm tracking-tight text-[var(--text-primary)]">
              41R Protocol
            </span>
            <span className="text-[10px] text-[var(--text-tertiary)] tracking-wide uppercase">
              Persona Market
            </span>
          </div>
        </Link>
      </div>

      {/* Devnet cluster badge */}
      <div className="mx-5 mb-5 px-3 py-1.5 rounded-md bg-sol-green/5 border border-sol-green/15 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-sol-green pulse-dot" />
        <span className="text-[11px] font-mono text-sol-green/80 tracking-wide">Devnet</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active = isRouteActive(pathname, item.href);

          return (
            <div key={item.href}>
              <Link
                href={item.href}
                className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${
                  active
                    ? "bg-sol-green/8 text-sol-green"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-surface-elevated"
                }`}
              >
                <span className={`transition-colors ${active ? "text-sol-green" : "text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]"}`}>
                  {item.icon}
                </span>
                {item.label}
                {active && (
                  <span className="ml-auto w-1 h-4 rounded-full bg-sol-green/60" />
                )}
              </Link>
              {item.children && active && (
                <div className="ml-[26px] mt-0.5 space-y-0.5 border-l border-border-dim pl-3">
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={`block px-3 py-1.5 rounded-md text-[12px] transition-colors ${
                        isExactRoute(pathname, child.href)
                          ? "text-sol-green bg-sol-green/5"
                          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                      }`}
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="mt-auto px-5 py-4 border-t border-border-dim space-y-3">
        {/* Wallet */}
        <WalletButton />

        {/* On-chain assets */}
        <a
          href="https://explorer.solana.com/address/GeriorgNHG6o7XGA2xqLyjexqaFxq8nYDvYdJ37qACpS?cluster=devnet"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-elevated border border-border-dim hover:border-border-hover transition-colors group"
        >
          <div className="w-5 h-5 rounded-full bg-sol-purple/15 flex items-center justify-center">
            <span className="text-[9px] font-mono font-bold text-sol-purple">41R</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">41R Token</p>
            <p className="text-[9px] font-mono text-[var(--text-tertiary)] truncate">Geriorg...qACpS</p>
          </div>
          <svg className="w-3 h-3 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>

        {/* Tech stack */}
        <div className="flex items-center justify-center gap-1.5 text-[9px] text-[var(--text-tertiary)] font-mono">
          <span>Stagehand</span>
          <span className="text-border">|</span>
          <span>Claude</span>
          <span className="text-border">|</span>
          <span>x402</span>
        </div>
      </div>
    </aside>
  );
}
