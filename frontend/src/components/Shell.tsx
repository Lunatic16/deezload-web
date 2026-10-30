"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, Library, ListChecks, Settings as SettingsIcon, Search } from "lucide-react";
import { useApp } from "./Providers";

const NAV = [
  { href: "/", label: "Search", icon: Search },
  { href: "/queue", label: "Queue", icon: ListChecks },
  { href: "/library", label: "Library", icon: Library },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { status, activeCount } = useApp();
  const needsSetup = status !== null && (!status.configured || !status.authenticated);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line/60 bg-panel md:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/favicon.svg" alt="" className="h-9 w-9 rounded-xl" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-fg">Deezload</div>
            <div className="text-[11px] text-mute">Web UI</div>
          </div>
        </div>

        <nav className="flex flex-col gap-1 px-3">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive(href) ? "bg-raised text-fg" : "text-dim hover:bg-card hover:text-fg"
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive(href) ? "text-accent" : ""}`} />
              <span className="flex-1">{label}</span>
              {href === "/queue" && activeCount > 0 && (
                <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{activeCount}</span>
              )}
            </Link>
          ))}
        </nav>

        <div className="mt-auto p-4 text-xs text-mute">
          {status?.authenticated ? (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-ok" />
              <span className="truncate">{status.user || "Connected"}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-bad" />
              <span>Not connected</span>
            </div>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        {needsSetup && pathname !== "/settings" && (
          <Link
            href="/settings"
            className="flex items-center gap-2 border-b border-warn/30 bg-warn/10 px-4 py-2.5 text-sm text-warn hover:bg-warn/15"
          >
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              {status?.configured
                ? status.error || "Deezer authentication failed."
                : "Add your Deezer ARL token to start downloading."}{" "}
              <span className="underline">Open settings →</span>
            </span>
          </Link>
        )}
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line/60 bg-panel/95 backdrop-blur md:hidden">
        {NAV.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] ${
              isActive(href) ? "text-accent" : "text-mute"
            }`}
          >
            <Icon className="h-5 w-5" />
            {label}
            {href === "/queue" && activeCount > 0 && (
              <span className="absolute right-[28%] top-1.5 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">
                {activeCount}
              </span>
            )}
          </Link>
        ))}
      </nav>
    </div>
  );
}
