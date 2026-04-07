"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type SVGProps,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import DownloadLauncher from "./download-launcher";
import { formatLocalizedDateTime, getPreferredLocale } from "@/lib/date-time";
import type {
  VideoAnalysisDeleteResponse,
  VideoAnalysisListRecord,
  VideoAnalysesListResponse,
} from "@/lib/video-analysis-shared";

type ToastKind = "info" | "success" | "error";
type AnalysisSortField = "video" | "duration" | "published" | "status";
type SortDirection = "asc" | "desc";

interface SortState {
  field: AnalysisSortField;
  direction: SortDirection;
}

interface ToastMessage {
  id: string;
  kind: ToastKind;
  message: string;
}

const textCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function formatDateTime(value: string | null) {
  return formatLocalizedDateTime(
    value,
    typeof navigator === "undefined"
      ? undefined
      : getPreferredLocale(navigator.languages) ?? navigator.language
  );
}

function formatDuration(durationSec: number) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return "-";
  }

  const totalSeconds = Math.round(durationSec);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "-";
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

function getRequestError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

function getCategoryText(analysis: VideoAnalysisListRecord) {
  return analysis.contentCategory?.trim() || null;
}

function getTagText(analysis: VideoAnalysisListRecord) {
  return analysis.tagNames.length > 0 ? analysis.tagNames.join(", ") : null;
}

function getVideoLabel(analysis: VideoAnalysisListRecord) {
  return analysis.name || analysis.fileName || analysis.videoId;
}

function getPublishedTimestamp(analysis: VideoAnalysisListRecord) {
  return analysis.published ? Date.parse(analysis.published) : Number.NEGATIVE_INFINITY;
}

function getReviewStatusLabel(analysis: VideoAnalysisListRecord) {
  return analysis.verified ? "Verified" : "Needs review";
}

function getNextSortState(current: SortState | null, field: AnalysisSortField): SortState {
  if (current?.field === field) {
    return {
      field,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }

  return {
    field,
    direction: "asc",
  };
}

function getAriaSortValue(sortState: SortState | null, field: AnalysisSortField) {
  if (sortState?.field !== field) {
    return "none" as const;
  }

  return sortState.direction === "asc" ? "ascending" as const : "descending" as const;
}

function SortTriangleIcon({
  direction,
}: {
  direction: SortDirection | null;
}) {
  if (!direction) {
    return <span className="inline-block size-2 opacity-0" aria-hidden="true" />;
  }

  return direction === "asc" ? (
    <svg
      viewBox="0 0 10 10"
      className="size-2 fill-current text-stone-600"
      aria-hidden="true"
    >
      <path d="M5 2 8.2 7.5H1.8Z" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 10 10"
      className="size-2 fill-current text-stone-600"
      aria-hidden="true"
    >
      <path d="M1.8 2.5h6.4L5 8Z" />
    </svg>
  );
}

function SortHeaderButton({
  label,
  field,
  sortState,
  onSort,
}: {
  label: string;
  field: AnalysisSortField;
  sortState: SortState | null;
  onSort: (field: AnalysisSortField) => void;
}) {
  const sortDirection = sortState?.field === field ? sortState.direction : null;

  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className="flex w-full items-center gap-1.5 text-left"
    >
      <span>{label}</span>
      <SortTriangleIcon direction={sortDirection} />
    </button>
  );
}

function renderReviewStatus(analysis: VideoAnalysisListRecord) {
  if (analysis.verified) {
    return (
      <span className="inline-flex items-center justify-center px-2 py-1 text-[0.72rem] font-medium uppercase tracking-[0.16em] bg-emerald-100 text-emerald-800">
        Verified
      </span>
    );
  }

  return <span className="text-[0.78rem] text-stone-500">Needs review</span>;
}

function InspectIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M7 4.5h7.5L19 9v10.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.5 4.5V9H19" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12h6" strokeLinecap="round" />
      <path d="M9 15.5h6" strokeLinecap="round" />
    </svg>
  );
}

function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8.5 6.2c0-1 1.1-1.62 1.97-1.1l7.78 4.8a1.28 1.28 0 0 1 0 2.2l-7.78 4.8c-.87.53-1.97-.1-1.97-1.1V6.2Z" />
    </svg>
  );
}

function DeleteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M4 7h16" strokeLinecap="round" />
      <path d="M9.5 10.5v6" strokeLinecap="round" />
      <path d="M14.5 10.5v6" strokeLinecap="round" />
      <path d="M6.5 7 7.4 18a2 2 0 0 0 2 1.84h5.2a2 2 0 0 0 2-1.84L17.5 7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 7V5.6A1.6 1.6 0 0 1 10.6 4h2.8A1.6 1.6 0 0 1 15 5.6V7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function AnalysisPage() {
  const pathname = usePathname();
  const [analyses, setAnalyses] = useState<VideoAnalysisListRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewAnalysis, setPreviewAnalysis] = useState<VideoAnalysisListRecord | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [sortState, setSortState] = useState<SortState | null>(null);
  const [isDeleting, startDeleting] = useTransition();

  const pushToast = useCallback((kind: ToastKind, message: string) => {
    const id = crypto.randomUUID();

    setToasts((current) => [...current, { id, kind, message }]);

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const loadAnalyses = useCallback(async (showLoader: boolean) => {
    if (showLoader) {
      setIsLoading(true);
      setLoadError(null);
    }

    try {
      const response = await fetch("/api/analyses", {
        cache: "no-store",
      });
      const payload = (await response.json()) as VideoAnalysesListResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load analyzed videos.");
      }

      setAnalyses(payload.analyses.filter((analysis) => analysis.status === "completed"));
    } catch (error) {
      if (showLoader) {
        setLoadError(getRequestError(error, "Failed to load analyzed videos."));
      }
    } finally {
      if (showLoader) {
        setIsLoading(false);
      }
    }
  }, []);

  const sortedAnalyses = useMemo(() => {
    if (!sortState) {
      return analyses;
    }

    const directionMultiplier = sortState.direction === "asc" ? 1 : -1;
    const sortedItems = [...analyses];

    sortedItems.sort((left, right) => {
      let result = 0;

      switch (sortState.field) {
        case "video":
          result = textCollator.compare(getVideoLabel(left), getVideoLabel(right));
          break;
        case "duration":
          result = left.durationSec - right.durationSec;
          break;
        case "published":
          result = getPublishedTimestamp(left) - getPublishedTimestamp(right);
          break;
        case "status":
          result = textCollator.compare(
            getReviewStatusLabel(left),
            getReviewStatusLabel(right)
          );
          break;
        default:
          result = 0;
      }

      if (result === 0) {
        result = textCollator.compare(getVideoLabel(left), getVideoLabel(right));
      }

      return result * directionMultiplier;
    });

    return sortedItems;
  }, [analyses, sortState]);

  const handleSort = useCallback((field: AnalysisSortField) => {
    setSortState((current) => getNextSortState(current, field));
  }, []);

  useEffect(() => {
    if (pathname === "/analysis") {
      void loadAnalyses(false);
    }
  }, [loadAnalyses, pathname]);

  useEffect(() => {
    const refreshAnalyses = () => {
      void loadAnalyses(false);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshAnalyses();
      }
    };

    void loadAnalyses(true);

    const timer = window.setInterval(() => {
      refreshAnalyses();
    }, 4000);

    window.addEventListener("focus", refreshAnalyses);
    window.addEventListener("pageshow", refreshAnalyses);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshAnalyses);
      window.removeEventListener("pageshow", refreshAnalyses);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadAnalyses]);

  function openPreview(analysis: VideoAnalysisListRecord) {
    if (!analysis.downloadId) {
      return;
    }

    setPreviewAnalysis(analysis);
  }

  function closePreview() {
    setPreviewAnalysis(null);
  }

  function handleDelete(analysis: VideoAnalysisListRecord) {
    const label = analysis.name || "this video";

    if (!window.confirm(`Delete ${label}? This removes the video and its saved analysis.`)) {
      return;
    }

    setDeletingId(analysis.id);

    startDeleting(async () => {
      try {
        const response = await fetch(`/api/analyses/${analysis.id}`, {
          method: "DELETE",
        });
        const payload = (await response.json()) as VideoAnalysisDeleteResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to delete the video.");
        }

        setAnalyses((current) =>
          current.filter((currentAnalysis) => currentAnalysis.id !== analysis.id)
        );
        pushToast("success", payload.message || "Video deleted.");
      } catch (error) {
        pushToast("error", getRequestError(error, "Failed to delete the video."));
      } finally {
        setDeletingId(null);
      }
    });
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <section className="shrink-0 border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
                Analysis Library
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
                Queue YouTube downloads here, then review completed analyses with direct
                access to inspection or playback.
              </p>
            </div>

            <DownloadLauncher onToast={pushToast} />
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-stone-900/8 bg-[rgba(255,252,247,0.92)] shadow-[0_12px_30px_rgba(28,25,23,0.05)]">
          {isLoading ? (
            <div className="flex flex-1 items-center px-5 py-8 text-sm text-stone-500">
              Loading analyzed videos...
            </div>
          ) : loadError ? (
            <div className="flex flex-1 items-center px-5 py-8 text-sm text-rose-700">
              {loadError}
            </div>
          ) : analyses.length === 0 ? (
            <div className="flex flex-1 items-center px-5 py-8 text-sm text-stone-500">
              No analyzed videos yet. Queue a YouTube download above and analysis will start automatically.
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-stone-900/8">
                    <th
                      aria-sort={getAriaSortValue(sortState, "video")}
                      className="sticky top-0 z-10 bg-[rgba(255,252,247,0.98)] px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500"
                    >
                      <SortHeaderButton
                        label="Video"
                        field="video"
                        sortState={sortState}
                        onSort={handleSort}
                      />
                    </th>
                    <th className="sticky top-0 z-10 bg-[rgba(255,252,247,0.98)] px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Category / Tags
                    </th>
                    <th
                      aria-sort={getAriaSortValue(sortState, "duration")}
                      className="sticky top-0 z-10 bg-[rgba(255,252,247,0.98)] px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500"
                    >
                      <SortHeaderButton
                        label="Duration"
                        field="duration"
                        sortState={sortState}
                        onSort={handleSort}
                      />
                    </th>
                    <th
                      aria-sort={getAriaSortValue(sortState, "published")}
                      className="sticky top-0 z-10 bg-[rgba(255,252,247,0.98)] px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500"
                    >
                      <SortHeaderButton
                        label="Published / Analyzed"
                        field="published"
                        sortState={sortState}
                        onSort={handleSort}
                      />
                    </th>
                    <th
                      aria-sort={getAriaSortValue(sortState, "status")}
                      className="sticky top-0 z-10 bg-[rgba(255,252,247,0.98)] px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500"
                    >
                      <SortHeaderButton
                        label="Status"
                        field="status"
                        sortState={sortState}
                        onSort={handleSort}
                      />
                    </th>
                    <th className="sticky top-0 z-10 bg-[rgba(255,252,247,0.98)] px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAnalyses.map((analysis) => {
                    const deleteDisabled = isDeleting && deletingId === analysis.id;
                    const categoryText = getCategoryText(analysis);
                    const tagText = getTagText(analysis);
                    const primaryCategoryText = categoryText || "-";

                    return (
                      <tr key={analysis.id} className="border-b border-stone-900/8 last:border-b-0">
                        <td className="px-4 py-3 align-middle">
                          <div className="max-w-md space-y-1.5">
                            <div className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-stone-500">
                              {analysis.platform || "-"}
                            </div>
                            <div className="text-sm font-medium text-stone-950">
                              {analysis.name || analysis.fileName || analysis.videoId}
                            </div>
                            {analysis.sourceUrl ? (
                              <a
                                href={analysis.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate text-sm text-emerald-900 underline decoration-stone-300 underline-offset-2 transition hover:text-emerald-700"
                                title={analysis.sourceUrl}
                              >
                                {analysis.sourceUrl}
                              </a>
                            ) : (
                              <div className="text-sm text-stone-400">-</div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          <div className="max-w-md space-y-1.5 break-words">
                            <div className="font-medium text-stone-800">{primaryCategoryText}</div>
                            {tagText ? (
                              <div className="text-[0.82rem] text-stone-500">
                                Tags: {tagText}
                              </div>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          <div className="space-y-1">
                            <div>{formatDuration(analysis.durationSec)}</div>
                            <div className="text-[0.82rem] text-stone-500">
                              {formatBytes(analysis.sizeBytes)}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          <div className="space-y-1.5">
                            <div>
                              <div className="text-[0.72rem] uppercase tracking-[0.16em] text-stone-400">
                                Published
                              </div>
                              <div>{formatDateTime(analysis.published)}</div>
                            </div>
                            <div>
                              <div className="text-[0.72rem] uppercase tracking-[0.16em] text-stone-400">
                                Analyzed
                              </div>
                              <div>{formatDateTime(analysis.analyzedAt)}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          {renderReviewStatus(analysis)}
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => openPreview(analysis)}
                              disabled={!analysis.downloadId}
                              aria-label={`Play ${analysis.name || "video"}`}
                              title={analysis.downloadId ? "Play" : "Video file unavailable"}
                              className="inline-flex size-8 items-center justify-center border border-stone-900/10 bg-white text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <PlayIcon className="size-4" aria-hidden="true" />
                            </button>
                            <Link
                              href={`/analysis/${analysis.id}`}
                              aria-label={`Inspect ${analysis.name || "video"}`}
                              title="Inspect"
                              className="inline-flex size-8 items-center justify-center border border-stone-900/10 bg-white text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50"
                            >
                              <InspectIcon className="size-4" aria-hidden="true" />
                            </Link>
                            <button
                              type="button"
                              onClick={() => handleDelete(analysis)}
                              disabled={deleteDisabled}
                              aria-label={`Delete ${analysis.name || "video"}`}
                              title={deleteDisabled ? "Deleting..." : "Delete"}
                              className="inline-flex size-8 items-center justify-center border border-rose-200 bg-rose-50 text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <DeleteIcon className="size-4" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {toasts.length > 0 ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`border px-4 py-3 text-sm shadow-[0_12px_30px_rgba(28,25,23,0.12)] ${toast.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : toast.kind === "info" ? "border-sky-200 bg-sky-50 text-sky-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}
            >
              {toast.message}
            </div>
          ))}
        </div>
      ) : null}

      {previewAnalysis ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/65 p-4">
          <div className="w-full max-w-5xl border border-stone-900/10 bg-[rgba(255,252,247,0.98)] shadow-[0_24px_60px_rgba(28,25,23,0.24)]">
            <div className="flex items-start justify-between gap-4 border-b border-stone-900/8 px-5 py-4">
              <div>
                <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
                  Playback
                </p>
                <h2 className="mt-2 text-lg font-semibold text-stone-950">
                  {previewAnalysis.name || previewAnalysis.fileName || "Analyzed video"}
                </h2>
              </div>
              <button
                type="button"
                onClick={closePreview}
                className="border border-stone-900/10 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
              >
                Close
              </button>
            </div>

            <div className="bg-stone-950 p-3 sm:p-4">
              {previewAnalysis.downloadId ? (
                <video
                  key={previewAnalysis.id}
                  controls
                  autoPlay
                  playsInline
                  preload="metadata"
                  className="max-h-[72vh] w-full bg-black"
                  src={`/api/downloads/${previewAnalysis.downloadId}/file`}
                />
              ) : (
                <div className="flex min-h-[18rem] items-center justify-center text-sm text-stone-300">
                  Video file is unavailable for playback.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}