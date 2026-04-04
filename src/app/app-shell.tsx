"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

import type {
  ActiveDownloadRecord,
  ActiveDownloadsResponse,
} from "@/lib/downloads-shared";

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

function formatBytes(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Calculating";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

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

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const [activeJobs, setActiveJobs] = useState<ActiveDownloadRecord[]>([]);
  const activeItem = navigationItems.find((item) => item.href === pathname);
  const pageTitle = activeItem?.label ?? getPageTitle(pathname);
  const activeJob = activeJobs[0] ?? null;

  const refreshActiveJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/downloads/active", {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as ActiveDownloadsResponse;
      setActiveJobs(payload.jobs);
    } catch {
      // Keep the shell quiet when polling fails.
    }
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void refreshActiveJobs();
    }, 0);

    const timer = window.setInterval(() => {
      void refreshActiveJobs();
    }, 2000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [refreshActiveJobs]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,rgba(184,92,56,0.16),transparent_28%),radial-gradient(circle_at_left_center,rgba(14,98,81,0.14),transparent_32%),#ece5d7] text-stone-900">
      <div className="flex min-h-screen">
        <aside className="flex w-24 shrink-0 flex-col border-r border-stone-900/8 bg-[linear-gradient(180deg,rgba(255,250,242,0.96),rgba(247,239,223,0.9))] px-3 py-5 text-stone-900 sm:w-60 sm:px-4">
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

        <main className="flex min-w-0 flex-1 flex-col px-4 py-4 sm:px-6 sm:py-6">
          <header className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] px-4 py-4 shadow-[0_12px_30px_rgba(28,25,23,0.05)] backdrop-blur sm:px-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[0.68rem] font-medium uppercase tracking-[0.24em] text-emerald-800">
                  Current Page
                </p>
                <h1 className="mt-1.5 text-[1.65rem] font-semibold tracking-tight text-stone-950 sm:text-[1.8rem]">
                  {pageTitle}
                </h1>
              </div>

              {activeJob ? (
                <div className="w-full max-w-sm border border-stone-900/8 bg-white/70 px-3 py-3 sm:ml-auto">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[0.78rem] font-medium text-stone-900">
                      {activeJob.name || "YouTube download"}
                    </p>
                    <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                      {activeJob.progressPercent !== null
                        ? `${activeJob.progressPercent}%`
                        : activeJob.status === "queued"
                          ? "Queued"
                          : "Preparing"}
                    </p>
                  </div>

                  <div className="mt-2 h-1.5 overflow-hidden bg-stone-900/10">
                    <div
                      className="h-full bg-emerald-800 transition-[width] duration-300"
                      style={{
                        width: `${activeJob.progressPercent ?? 12}%`,
                      }}
                    />
                  </div>

                  <div className="mt-2 flex items-center justify-between gap-3 text-[0.72rem] text-stone-500">
                    <span>
                      {formatBytes(activeJob.bytesReceived)}
                      {activeJob.expectedSize !== null
                        ? ` / ${formatBytes(activeJob.expectedSize)}`
                        : ""}
                    </span>
                    {activeJobs.length > 1 ? (
                      <span>{`+${activeJobs.length - 1} more`}</span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </header>

          <section className="flex flex-1 flex-col py-5 sm:py-6">{children}</section>
        </main>
      </div>
    </div>
  );
}