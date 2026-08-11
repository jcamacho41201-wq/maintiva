"use client";

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ClipboardList, Loader2, Search, User, X, Car } from "lucide-react";
import { useDemoStore } from "@/lib/demo-store";
import { isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import {
  type GlobalSearchResult,
  type GlobalSearchResultType,
  type GlobalSearchResponse,
  searchDemoGlobal,
} from "@/lib/global-search";
import { cn } from "@/lib/utils";

const labels: Record<GlobalSearchResultType, string> = {
  customer: "Customers",
  vehicle: "Vehicles",
  appointment: "Appointments",
  opportunity: "Revenue Opportunities",
};

const icons = {
  customer: User,
  vehicle: Car,
  appointment: CalendarDays,
  opportunity: ClipboardList,
} satisfies Record<GlobalSearchResultType, typeof User>;

export function GlobalSearch() {
  const router = useRouter();
  const { state, ready } = useDemoStore();
  const authConfigured = isBrowserSupabaseConfigured();
  const useLocalSearch = state.shop.isDemo && !authConfigured;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const groupedResults = useMemo(() => {
    return (Object.keys(labels) as GlobalSearchResultType[])
      .map((type) => ({ type, results: results.filter((result) => result.type === type) }))
      .filter((group) => group.results.length > 0);
  }, [results]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || !ready) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        if (useLocalSearch) {
          setResults(searchDemoGlobal(state, trimmed).results);
          setLoading(false);
          return;
        }

        const response = await fetch(`/api/pilot/search?q=${encodeURIComponent(trimmed)}`, {
          credentials: "include",
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => ({}))) as Partial<GlobalSearchResponse> & { message?: string };
        if (!response.ok) {
          throw new Error(data.message ?? "Search is unavailable right now.");
        }
        setResults(data.results ?? []);
        setLoading(false);
      } catch (fetchError) {
        if (controller.signal.aborted) return;
        setResults([]);
        setError(fetchError instanceof Error ? fetchError.message : "Search is unavailable right now.");
        setLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, ready, state, useLocalSearch]);

  function closeSearch() {
    setOpen(false);
    setActiveIndex(0);
  }

  function navigate(result: GlobalSearchResult) {
    closeSearch();
    setQuery("");
    router.push(result.href);
  }

  function onInputKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSearch();
      inputRef.current?.blur();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      navigate(results[activeIndex]);
    }
  }

  let resultOffset = 0;

  return (
    <div ref={containerRef} className="relative flex-1">
      <label className="flex h-10 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-zinc-500 focus-within:border-violet-300 focus-within:bg-white">
        <Search className="h-4 w-4" aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            const nextQuery = event.target.value;
            setQuery(nextQuery);
            setOpen(true);
            setActiveIndex(0);
            if (nextQuery.trim().length < 2) {
              setResults([]);
              setError("");
              setLoading(false);
            } else {
              setError("");
              setLoading(true);
            }
          }}
          onKeyDown={onInputKeyDown}
          placeholder="Search customers, vehicles, VINs, appointments"
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-500"
        />
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-violet-800" aria-label="Searching" />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
              inputRef.current?.focus();
            }}
            className="grid h-6 w-6 place-items-center rounded text-zinc-500 hover:bg-zinc-100"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <span className="hidden rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-500 sm:inline">
            Ctrl K
          </span>
        )}
      </label>

      {open && query.trim().length >= 2 && (
        <div className="absolute left-0 right-0 top-12 z-50 max-h-[70vh] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-xl">
          {error ? (
            <p className="px-3 py-4 text-sm font-medium text-red-700">{error}</p>
          ) : !loading && results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-zinc-500">No matching customers, vehicles, appointments, or opportunities.</p>
          ) : (
            groupedResults.map((group) => {
              const startIndex = resultOffset;
              resultOffset += group.results.length;
              return (
                <div key={group.type} className="py-1">
                  <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {labels[group.type]}
                  </p>
                  {group.results.map((result, index) => {
                    const absoluteIndex = startIndex + index;
                    const Icon = icons[result.type];
                    return (
                      <button
                        key={`${result.type}-${result.id}`}
                        type="button"
                        onMouseEnter={() => setActiveIndex(absoluteIndex)}
                        onClick={() => navigate(result)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm",
                          absoluteIndex === activeIndex ? "bg-violet-50 text-violet-950" : "hover:bg-zinc-50",
                        )}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-zinc-100 text-violet-950">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{result.title}</span>
                          <span className="block truncate text-xs text-zinc-500">{result.subtitle}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
