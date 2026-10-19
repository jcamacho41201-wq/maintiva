"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileUp,
  Gauge,
  LayoutDashboard,
  Library,
  Menu,
  Settings,
  Users,
  Wrench,
  LogOut,
  MessageSquare,
  Megaphone,
  X,
  Car,
} from "lucide-react";
import { GlobalSearch } from "@/components/global-search";
import { useDemoStore } from "@/lib/demo-store";
import {
  createSupabaseBrowserClient,
  isBrowserSupabaseConfigured,
} from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!navigationOpen) return;
    const menuButton = menuRef.current;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    navigationRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavigationOpen(false);
      if (event.key !== "Tab") return;
      const elements = Array.from(navigationRef.current?.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)") ?? []).filter((element) => element.getClientRects().length);
      const first = elements[0];
      const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = originalOverflow; document.removeEventListener("keydown", onKey); menuButton?.focus(); };
  }, [navigationOpen]);
  const { state, resetDemoData, ready, loadError } = useDemoStore();
  if (pathname === "/about" || pathname === "/login" || pathname === "/password-reset" || pathname.startsWith("/book/") || pathname.startsWith("/request/")) {
    return <div className="min-h-screen bg-zinc-50 text-zinc-950">{children}</div>;
  }

  const showDemoReset = process.env.NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET === "true";
  const authConfigured = isBrowserSupabaseConfigured();
  const canResetLocalDemo = state.shop.isDemo && !authConfigured && showDemoReset;
  const currentUser = state.users.find((user) => user.id === state.currentUserId) ?? state.users[0];
  const navItems = [
    { href: "/", activeHref: "/", label: "Dashboard", icon: LayoutDashboard, section: "Overview" },
    { href: "/automation", activeHref: "/automation", label: "Opportunities", icon: ClipboardList, section: "Overview" },
    { href: "/outreach", activeHref: "/outreach", label: "Ready for Outreach", icon: MessageSquare, section: "Overview" },
    { href: "/appointments", activeHref: "/appointments", label: "Appointments", icon: CalendarDays, section: "Overview" },
    { href: "/customers", activeHref: "/customers", label: "Customers", icon: Users, section: "Customers" },
    { href: "/vehicles", activeHref: "/vehicles", label: "Vehicles", icon: Car, section: "Customers" },
    { href: "/visits/new", activeHref: "/visits", label: "Add Service Visit", icon: Wrench, section: "Customers" },
    { href: "/campaigns", activeHref: "/campaigns", label: "Campaigns", icon: Megaphone, section: "Retention" },
    { href: "/messages", activeHref: "/messages", label: "Messages", icon: MessageSquare, section: "Retention" },
    { href: "/settings/smart-maintenance-blocks", activeHref: "/settings/smart-maintenance-blocks", label: "Maintenance Blocks", icon: Gauge, section: "Retention" },
    { href: "/analytics", activeHref: "/analytics", label: "Recovered Revenue", icon: BarChart3, section: "Performance" },
    { href: "/services", activeHref: "/services", label: "Services & Intervals", icon: Library, section: "Settings" },
    { href: "/integrations", activeHref: "/integrations", label: "Data & Integrations", icon: FileUp, section: "Settings" },
    { href: "/settings", activeHref: "/settings", label: "Shop Settings", icon: Settings, section: "Settings" },
  ];

  async function signOut() {
    if (!authConfigured) return;
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      {navigationOpen && <button className="fixed inset-0 z-30 bg-black/40 lg:hidden" aria-label="Close navigation" onClick={() => setNavigationOpen(false)} />}
      <aside ref={navigationRef} aria-label="Main navigation" className={`fixed inset-y-0 left-0 z-40 w-72 max-w-[90vw] flex-col border-r border-zinc-200 bg-white ${navigationOpen ? "flex" : "hidden"} lg:flex`}>
        <button aria-label="Close menu" title="Close menu" onClick={() => setNavigationOpen(false)} className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-lg bg-white lg:hidden"><X className="h-4 w-4" /></button>
        <div className="flex h-20 items-center gap-3 border-b border-zinc-100 px-6">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-violet-950 text-white">
            <Gauge className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-lg font-semibold tracking-tight">Maintiva</p>
            <p className="text-xs font-medium text-violet-700">
              Customer retention. Repeat revenue.
            </p>
          </div>
        </div>
        <div className="border-b border-zinc-100 px-6 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Current shop
          </p>
          <p className="mt-1 font-semibold">
            {loadError ? "Shop load error" : ready ? state.shop.name : "Loading shop"}
          </p>
          {state.shop.isDemo && (
            <span className="mt-2 inline-flex rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
              Demo tenant
            </span>
          )}
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-4 py-3">
          {navItems.map((item, index) => {
            const active =
              item.activeHref === "/"
                ? pathname === item.activeHref
                : item.href === "/settings" ? pathname === "/settings" : pathname.startsWith(item.activeHref);
            const Icon = item.icon;

            return (
              <div key={item.label}>
              {navItems[index - 1]?.section !== item.section && <p className="px-3 pb-1 pt-4 text-xs font-semibold uppercase text-zinc-400">{item.section}</p>}
              <Link
                href={item.href}
                onClick={() => setNavigationOpen(false)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-violet-50 hover:text-violet-900",
                  active && "bg-violet-950 text-white hover:bg-violet-950 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-zinc-100 p-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-sm font-semibold">{currentUser?.name ?? (loadError ? "Sign in again" : ready ? "Team member" : "Loading user")}</p>
            <p className="text-xs text-zinc-500">{currentUser?.role ?? ""}</p>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur lg:px-8">
          <button
            ref={menuRef}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-zinc-200 text-zinc-600 lg:hidden"
            aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={navigationOpen}
            onClick={() => setNavigationOpen((open) => !open)}
          >
            {navigationOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <GlobalSearch />
          {canResetLocalDemo ? (
            <button
              onClick={resetDemoData}
              className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"
            >
              Reset Demo
            </button>
          ) : authConfigured ? (
            <button
              onClick={signOut}
              className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          ) : (
            <Link
              href="/login"
              className="shrink-0 whitespace-nowrap rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"
            >
              Demo login
            </Link>
          )}
        </header>
        <main className="px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
