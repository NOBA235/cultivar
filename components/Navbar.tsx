"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Navbar() {
  const pathname = usePathname();

  const navLinks = [
    { href: "/", label: "Upload" },
    { href: "/resolve", label: "Resolve" },
    { href: "/recommendations", label: "Recommendations" },
    { href: "/compare", label: "Compare" },
    { href: "/history", label: "History" },
  ];

  return (
    <header className="border-b border-slate-800/80 px-4 sm:px-6 py-3.5 backdrop-blur-md bg-slate-950/80 sticky top-0 z-40 transition-all">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Brand Logo & Cultivar Name */}
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center font-black text-emerald-400 group-hover:bg-emerald-500/25 transition">
              <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <div>
              <span className="font-bold tracking-tight text-white text-base sm:text-lg group-hover:text-emerald-300 transition">
                Cultivar
              </span>
              <span className="text-[11px] text-slate-500 ml-2 font-mono hidden md:inline">
                Cultural Supply Chain Intelligence
              </span>
            </div>
          </Link>

          {/* Mobile Status Dot */}
          <div className="sm:hidden flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-slate-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Qloo Taste Graph</span>
          </div>
        </div>

        {/* Navigation Links */}
        <div className="flex items-center justify-between sm:justify-end gap-1.5 overflow-x-auto py-0.5 scrollbar-none font-mono text-xs">
          <nav className="flex items-center gap-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-2.5 py-1.5 rounded-lg transition-all font-medium whitespace-nowrap ${
                    isActive
                      ? "bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 shadow-sm"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/80 border border-transparent"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Desktop Status Badge */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono px-2.5 py-1 rounded-full bg-slate-900/90 border border-slate-800 text-slate-300 shrink-0 ml-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px]">Qloo Taste Graph</span>
          </div>
        </div>
      </div>
    </header>
  );
}
