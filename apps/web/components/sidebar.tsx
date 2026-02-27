"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { label: "Home", href: "/", icon: "H" },
  {
    label: "Company",
    href: "/company",
    icon: "C",
    color: "purple",
    children: [
      { label: "Dashboard", href: "/company" },
      { label: "Register Test", href: "/company/register" },
    ],
  },
  {
    label: "Tester",
    href: "/tester",
    icon: "T",
    color: "cyan",
    children: [
      { label: "Available Tests", href: "/tester/tests" },
      { label: "Profile", href: "/tester/profile" },
    ],
  },
  { label: "Personas", href: "/persona", icon: "P", color: "green" },
  { label: "Auto Test", href: "/autotest", icon: "A", color: "orange" },
];

const colorMap: Record<string, { active: string; activeText: string; childActive: string }> = {
  purple: {
    active: "bg-purple-500/20",
    activeText: "text-purple-300",
    childActive: "text-purple-300",
  },
  cyan: {
    active: "bg-cyan-500/20",
    activeText: "text-cyan-300",
    childActive: "text-cyan-300",
  },
  green: {
    active: "bg-green-500/20",
    activeText: "text-green-300",
    childActive: "text-green-300",
  },
  orange: {
    active: "bg-orange-500/20",
    activeText: "text-orange-300",
    childActive: "text-orange-300",
  },
};

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
    <aside className="fixed left-0 top-0 h-full w-64 bg-gray-900 border-r border-gray-800 p-4 flex flex-col z-40">
      <div className="mb-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
            41R
          </span>
          <span className="text-sm text-gray-400">Persona Market</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const active = isRouteActive(pathname, item.href);
          const colors = colorMap[item.color || "purple"];

          return (
            <div key={item.href}>
              <Link
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? `${colors.active} ${colors.activeText}`
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
                }`}
              >
                <span
                  className={`w-6 h-6 rounded flex items-center justify-center text-xs font-mono transition-colors ${
                    active ? "bg-gray-700" : "bg-gray-800"
                  }`}
                >
                  {item.icon}
                </span>
                {item.label}
              </Link>
              {item.children && active && (
                <div className="ml-9 mt-1 space-y-1">
                  {item.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={`block px-3 py-1.5 rounded text-xs transition-colors ${
                        isExactRoute(pathname, child.href)
                          ? colors.childActive
                          : "text-gray-500 hover:text-gray-300"
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

      <div className="mt-auto pt-4 border-t border-gray-800 space-y-2">
        <a
          href="https://explorer.solana.com/address/GeriorgNHG6o7XGA2xqLyjexqaFxq8nYDvYdJ37qACpS?cluster=devnet"
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-gray-500 hover:text-orange-400 text-center transition-colors"
        >
          41R Token on Devnet
        </a>
        <div className="flex items-center justify-center gap-2 text-[10px] text-gray-600">
          <span>Stagehand</span>
          <span>+</span>
          <span>Claude Sonnet</span>
        </div>
      </div>
    </aside>
  );
}
