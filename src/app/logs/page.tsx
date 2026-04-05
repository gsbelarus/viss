"use client";

import { useCallback, useEffect, useState } from "react";

import { formatLocalizedDateTime, getPreferredLocale } from "@/lib/date-time";
import type { LogRecord, LogsListResponse } from "@/lib/logs-shared";

function formatDateTime(value: string) {
  return formatLocalizedDateTime(
    value,
    typeof navigator === "undefined"
      ? undefined
      : getPreferredLocale(navigator.languages) ?? navigator.language
  );
}

function summarizeDetails(details: Record<string, unknown> | null) {
  if (!details) {
    return "-";
  }

  const parts = [details.provider, details.fileName, details.url, details.error]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());

  if (parts.length > 0) {
    return parts.join(" | ");
  }

  return JSON.stringify(details);
}

function levelTone(level: LogRecord["level"]) {
  if (level === "success") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (level === "error") {
    return "bg-rose-100 text-rose-800";
  }

  return "bg-stone-200 text-stone-700";
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadLogs = useCallback(async (showLoader: boolean) => {
    if (showLoader) {
      setIsLoading(true);
      setLoadError(null);
    }

    try {
      const response = await fetch("/api/logs", {
        cache: "no-store",
      });
      const payload = (await response.json()) as LogsListResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load logs.");
      }

      setLogs(payload.logs);
    } catch (error) {
      if (showLoader) {
        setLoadError(
          error instanceof Error && error.message
            ? error.message
            : "Failed to load logs."
        );
      }
    } finally {
      if (showLoader) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadLogs(true);

    const timer = window.setInterval(() => {
      void loadLogs(false);
    }, 4000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadLogs]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <section className="shrink-0 border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
        <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
          Logs
        </p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
          Download activity is recorded here, including queueing, progress outcomes,
          completion, and failure details.
        </p>
      </section>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-stone-900/8 bg-[rgba(255,252,247,0.92)] shadow-[0_12px_30px_rgba(28,25,23,0.05)]">
        {isLoading ? (
          <div className="flex flex-1 items-center px-5 py-8 text-sm text-stone-500">
            Loading logs...
          </div>
        ) : loadError ? (
          <div className="flex flex-1 items-center px-5 py-8 text-sm text-rose-700">
            {loadError}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-1 items-center px-5 py-8 text-sm text-stone-500">
            No log entries yet.
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-stone-900/8 bg-stone-950/[0.02]">
                  <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Time
                  </th>
                  <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Level
                  </th>
                  <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Scope
                  </th>
                  <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Message
                  </th>
                  <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id} className="border-b border-stone-900/8 last:border-b-0">
                    <td className="px-4 py-3 align-top text-sm text-stone-600">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span
                        className={`inline-flex px-2 py-1 text-[0.72rem] font-medium uppercase tracking-[0.16em] ${levelTone(log.level)}`}
                      >
                        {log.level}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-sm text-stone-600">{log.scope}</td>
                    <td className="px-4 py-3 align-top text-sm font-medium text-stone-950">
                      {log.message}
                    </td>
                    <td className="px-4 py-3 align-top text-sm text-stone-600">
                      <div className="max-w-xl break-words">{summarizeDetails(log.details)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}