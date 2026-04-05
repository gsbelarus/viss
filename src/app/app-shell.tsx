"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import { ACTIVE_PROCESSES_REFRESH_EVENT } from "@/lib/active-process-events";
import type {
  ActiveProcessRecord,
  ActiveProcessesResponse,
} from "@/lib/processes-shared";

const navigationItems = [
  {
    href: "/",
    label: "Trend Feed",
    description: "Live workspace overview",
  },
  {
    href: "/downloads",
    label: "Downloads",
    description: "Queued capture and storage",
  },
  {
    href: "/analysis",
    label: "Analysis",
    description: "Reviewed videos and findings",
  },
  {
    href: "/scripts",
    label: "Scripts",
    description: "Transcript and playbook output",
  },
  {
    href: "/diagnostics",
    label: "Diagnostics",
    description: "Pipeline and model health",
  },
  {
    href: "/logs",
    label: "Logs",
    description: "Download activity and events",
  },
];

function formatSegment(segment: string) {
  return segment
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getPageTitle(pathname: string) {
  if (pathname === "/") {
    return "Home";
  }

  if (pathname.startsWith("/analysis/")) {
    return "Analysis Details";
  }

  const segments = pathname.split("/").filter(Boolean);
  const lastSegment = segments.at(-1);

  if (!lastSegment) {
    return "Home";
  }

  return formatSegment(lastSegment);
}

type AppShellProps = Readonly<{
  children: React.ReactNode;
}>;

function ChevronLeftIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="m14.5 5.5-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="m9.5 5.5 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [activeJobs, setActiveJobs] = useState<ActiveProcessRecord[]>([]);
  const [activeJobIndex, setActiveJobIndex] = useState(0);
  const activeItem = navigationItems.find((item) => item.href === pathname);
  const pageTitle = activeItem?.label ?? getPageTitle(pathname);
  const activeJob = activeJobs[activeJobIndex] ?? activeJobs[0] ?? null;

  const refreshActiveJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/downloads/active", {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as ActiveProcessesResponse;
      setActiveJobs(payload.jobs);
      setActiveJobIndex((currentIndex) => {
        if (payload.jobs.length === 0) {
          return 0;
        }

        return Math.min(currentIndex, payload.jobs.length - 1);
      });
    } catch {
      // Keep the shell quiet when polling fails.
    }
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (!isDocumentVisible()) {
        return;
      }

      void refreshActiveJobs();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshActiveJobs();
      }
    };
    const initialTimer = window.setTimeout(() => {
      void refreshActiveJobs();
    }, 0);

    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    window.addEventListener(ACTIVE_PROCESSES_REFRESH_EVENT, refreshWhenVisible);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearTimeout(initialTimer);
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
      window.removeEventListener(ACTIVE_PROCESSES_REFRESH_EVENT, refreshWhenVisible);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshActiveJobs]);

  useEffect(() => {
    if (activeJobs.length === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      if (!isDocumentVisible()) {
        return;
      }

      void refreshActiveJobs();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeJobs.length, refreshActiveJobs]);

  function showPreviousJob() {
    setActiveJobIndex((currentIndex) => {
      if (activeJobs.length === 0) {
        return 0;
      }

      return currentIndex === 0 ? activeJobs.length - 1 : currentIndex - 1;
    });
  }

  function showNextJob() {
    setActiveJobIndex((currentIndex) => {
      if (activeJobs.length === 0) {
        return 0;
      }

      return currentIndex === activeJobs.length - 1 ? 0 : currentIndex + 1;
    });
  }

  return (
    <div className="h-dvh overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(184,92,56,0.16),transparent_28%),radial-gradient(circle_at_left_center,rgba(14,98,81,0.14),transparent_32%),#ece5d7] text-stone-900">
      <div className="flex h-full min-h-0">
        <aside className="flex h-full w-24 shrink-0 flex-col overflow-y-auto border-r border-stone-900/8 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(247,239,223,0.9))] px-3 py-5 text-stone-900 sm:w-60 sm:px-4">
          <div className="border-b border-stone-900/8 pb-4">
            <p className="text-center font-mono text-[0.625rem] font-medium uppercase tracking-[0.28em] text-emerald-800 sm:text-left">
              Control Center
            </p>
            <h2 className="mt-2 hidden text-base font-semibold tracking-tight text-stone-950 sm:block">
              Viss Workspace
            </h2>
            <p className="mt-1 hidden text-[0.78rem] leading-5 text-stone-600 sm:block">
              Shared navigation remains fixed while each screen renders inside the working area.
            </p>
          </div>

          <nav aria-label="Primary" className="mt-5 flex flex-1 flex-col gap-2">
            {navigationItems.map((item) => {
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={[
                    "rounded-none border-l-2 border-transparent px-0 py-2.5 transition sm:px-0",
                    isActive
                      ? "border-l-stone-900 text-stone-950"
                      : "text-stone-500 hover:text-stone-800",
                  ].join(" ")}
                >
                  <div className="text-center text-[0.9rem] font-medium sm:text-left">
                    {item.label}
                  </div>
                  <div className="mt-0.5 hidden text-[0.72rem] leading-4 text-stone-500 sm:block">
                    {item.description}
                  </div>
                </Link>
              );
            })}
          </nav>

          <div className="hidden border-t border-stone-900/8 pt-4 sm:block">
            <p className="text-[0.8rem] font-semibold text-stone-900">Current Target</p>
            <p className="mt-1 text-[0.74rem] leading-5 text-stone-600">
              {activeItem
                ? `${activeItem.label} keeps ${activeItem.description.toLowerCase()} in view.`
                : "Use the left navigation to move between tools. The header reflects the current route."}
            </p>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 min-h-0 flex-col overflow-hidden px-2 py-2 sm:px-4 sm:py-4">
          <header className="shrink-0 border border-stone-900/8 bg-[rgba(255,252,247,0.92)] px-4 py-4 shadow-[0_12px_30px_rgba(28,25,23,0.05)] backdrop-blur sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-mono text-[0.68rem] font-medium uppercase tracking-[0.24em] text-emerald-800">
                  Current Page
                </p>
                <h1 className="mt-1.5 text-[1.65rem] font-semibold tracking-tight text-stone-950 sm:text-[1.8rem]">
                  {pageTitle}
                </h1>
              </div>

              {activeJob ? (
                <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto sm:max-w-xl">
                  {activeJobs.length > 1 ? (
                    <button
                      type="button"
                      onClick={showPreviousJob}
                      aria-label="Show previous active task"
                      className="inline-flex size-9 shrink-0 items-center justify-center border border-stone-900/10 bg-white/70 text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50"
                    >
                      <ChevronLeftIcon className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}

                  <div className="min-w-0 flex-1 border border-stone-900/8 bg-white/70 px-3 py-3 sm:w-[27rem] sm:flex-none">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 text-[0.78rem] font-medium text-stone-900">
                        <span className="block truncate">
                          {activeJob.name ||
                            (activeJob.kind === "analysis"
                              ? "Video analysis"
                              : "YouTube download")}
                        </span>
                      </p>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                          {activeJob.detailText || activeJob.statusLabel}
                        </p>
                        <p className="mt-1 font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                          {activeJob.progressPercent !== null
                            ? `${activeJob.progressPercent}%`
                            : activeJob.status === "queued"
                              ? "Queued"
                              : "Working"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 h-1.5 overflow-hidden bg-stone-900/10">
                      <div
                        className={`h-full transition-[width] duration-300 ${activeJob.kind === "analysis" ? "bg-amber-700" : "bg-emerald-800"}`}
                        style={{
                          width: `${activeJob.progressPercent ?? (activeJob.status === "queued" ? 8 : 12)}%`,
                        }}
                      />
                    </div>
                  </div>

                  {activeJobs.length > 1 ? (
                    <button
                      type="button"
                      onClick={showNextJob}
                      aria-label="Show next active task"
                      className="inline-flex size-9 shrink-0 items-center justify-center border border-stone-900/10 bg-white/70 text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50"
                    >
                      <ChevronRightIcon className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </header>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3 sm:pt-4">
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </section>
        </main>
      </div>
    </div>
  );
}