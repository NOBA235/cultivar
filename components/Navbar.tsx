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
    <header className="sticky top-0 z-40 border-b border-[#e9ede8] bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex min-h-[68px] max-w-7xl flex-col justify-between gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
          <Link href="/" className="group flex items-center gap-3 rounded-lg" aria-label="Cultivar home">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1e513a] text-white shadow-[0_3px_8px_rgba(30,81,58,.18)] transition-transform group-hover:-rotate-3">
              <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 21c-4.5-2.6-7-6.1-7-10.4C5 6.7 8.1 4 12 4s7 2.7 7 6.6c0 4.3-2.5 7.8-7 10.4Zm0 0V9m0 4c-1.8-1.6-3.3-2.2-5.3-2.4m5.3-.1c1.6-1.5 3.2-2.1 5.2-2.3" />
              </svg>
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold tracking-[-0.04em] text-[#17211b]">Cultivar</span>
              <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.14em] text-stone-500">Product intelligence</span>
            </span>
          </Link>
          <span className="flex items-center gap-2 rounded-full border border-[#e8eee8] bg-[#f7faf7] px-2.5 py-1.5 text-[10px] font-medium text-stone-600 sm:hidden">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-30" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" /></span>
            Qloo connected
          </span>
        </div>

        <div className="flex items-center justify-between gap-4 sm:justify-end">
          <nav aria-label="Primary workspace navigation" className="flex w-full items-center gap-1 overflow-x-auto sm:w-auto">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`relative whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors sm:text-[13px] ${
                    isActive
                      ? "bg-[#eef5ef] text-[#23573d]"
                      : "text-stone-500 hover:bg-stone-50 hover:text-stone-900"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
          <div className="hidden items-center gap-2 border-l border-stone-200 pl-4 text-[11px] text-stone-500 md:flex">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#edf4ee] text-[10px] font-semibold text-[#23573d]">CQ</span>
            <span className="whitespace-nowrap">Taste Graph <span className="ml-1 text-emerald-700">●</span></span>
          </div>
        </div>
      </div>
    </header>
  );
}
