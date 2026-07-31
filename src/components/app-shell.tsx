"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileUp,
  Gauge,
  LayoutDashboard,
  Library,
  Menu,
  Search,
  Settings,
  Users,
  Wrench,
  LogOut,
} from "lucide-react";
import { useDemoStore } from "@/lib/demo-store";
import {
  createSupabaseBrowserClient,
  isBrowserSupabaseConfigured,
} from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { state, resetDemoData, ready } = useDemoStore();
  if (pathname.startsWith("/book/")) {
    return <div className="min-h-screen bg-zinc-50 text-zinc-950">{children}</div>;
  }

  const showDemoReset = process.env.NEXT_PUBLIC_MAINTIVA_ENABLE_DEMO_RESET === "true";
  const authConfigured = isBrowserSupabaseConfigured();
  const canResetLocalDemo = state.shop.isDemo && !authConfigured && showDemoReset;
  const currentUser = state.users.find((user) => user.id === state.currentUserId) ?? state.users[0];
  const firstVehicleHref = state.vehicles[0] ? `/vehicles/${state.vehicles[0].id}` : "/customers";
  const navItems = [
    { href: "/", activeHref: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/automation", activeHref: "/automation", label: "Revenue Queue", icon: ClipboardList },
    { href: "/customers", activeHref: "/customers", label: "Customers", icon: Users },
    { href: firstVehicleHref, activeHref: "/vehicles", label: "Maintenance", icon: Wrench },
    { href: "/import", activeHref: "/import", label: "Import Data", icon: FileUp },
    { href: "/capacity", activeHref: "/capacity", label: "Capacity", icon: Gauge },
    { href: "/appointments", activeHref: "/appointments", label: "Appointments", icon: CalendarDays },
    { href: "/services", activeHref: "/services", label: "Services Library", icon: Library },
    { href: "/analytics", activeHref: "/analytics", label: "ROI Report", icon: BarChart3 },
    { href: "/settings", activeHref: "/settings", label: "Settings", icon: Settings },
  ];

  async function signOut() {
    if (!authConfigured) return;
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-950">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-zinc-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-20 items-center gap-3 border-b border-zinc-100 px-6">
          <div className="grid h-11 w-11 place-items-center rounded-lg bg-violet-950 text-white">
            <Gauge className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <p className="text-lg font-semibold tracking-tight">Maintiva</p>
            <p className="text-xs font-medium text-violet-700">
              Recover Maintenance Revenue.
            </p>
          </div>
        </div>
        <div className="border-b border-zinc-100 px-6 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Current shop
          </p>
          <p className="mt-1 font-semibold">{ready ? state.shop.name : "Loading shop"}</p>
          {state.shop.isDemo && (
            <span className="mt-2 inline-flex rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
              Demo tenant
            </span>
          )}
        </div>
        <nav className="flex-1 space-y-1 px-4 py-5">
          {navItems.map((item) => {
            const active =
              item.activeHref === "/"
                ? pathname === item.activeHref
                : pathname.startsWith(item.activeHref);
            const Icon = item.icon;

            return (
              <Link
                key={item.label}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-zinc-600 transition hover:bg-violet-50 hover:text-violet-900",
                  active && "bg-violet-950 text-white hover:bg-violet-950 hover:text-white",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-zinc-100 p-4">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-sm font-semibold">{currentUser?.name ?? (ready ? "Team member" : "Loading user")}</p>
            <p className="text-xs text-zinc-500">{currentUser?.role ?? ""}</p>
          </div>
        </div>
      </aside>

      <div className="lg:pl-72">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur lg:px-8">
          <button
            className="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200 text-zinc-600 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex h-10 flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-zinc-500">
            <Search className="h-4 w-4" aria-hidden="true" />
            <span className="text-sm">Search customers, vehicles, VINs, services</span>
          </div>
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
              className="inline-flex items-center gap-2 rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-violet-950 px-4 py-2 text-sm font-semibold text-white"
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
