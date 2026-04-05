"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type SVGProps, useCallback, useEffect, useState, useTransition } from "react";

import { formatLocalizedDateTime, getPreferredLocale } from "@/lib/date-time";
import type {
  VideoAnalysisDeleteResponse,
  VideoAnalysisListRecord,
  VideoAnalysesListResponse,
} from "@/lib/video-analysis-shared";

type ToastKind = "success" | "error";

interface ToastMessage {
  id: string;
  kind: ToastKind;
  message: string;
}

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

function getRequestError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

function summarizeCategory(analysis: VideoAnalysisListRecord) {
  if (analysis.contentCategory?.trim()) {
    return analysis.contentCategory.trim();
  }

  if (analysis.summary?.trim()) {
    return analysis.summary.trim();
  }

  return "-";
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
          <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
            Analysis Library
          </p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
            Reviewed videos are listed here with their category, duration, and direct
            access to inspection or playback.
          </p>
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
              No analyzed videos yet. Start an analysis from the Downloads page.
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-stone-900/8 bg-stone-950/[0.02]">
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Video
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Provider
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Category / Summary
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Duration
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Published
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Status
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Analyzed
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analyses.map((analysis) => {
                    const deleteDisabled = isDeleting && deletingId === analysis.id;

                    return (
                      <tr key={analysis.id} className="border-b border-stone-900/8 last:border-b-0">
                        <td className="px-4 py-3 align-middle">
                          <div className="text-sm font-medium text-stone-950">
                            {analysis.name || analysis.fileName || analysis.videoId}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          {analysis.platform || "-"}
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          <div className="max-w-md break-words">{summarizeCategory(analysis)}</div>
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          {formatDuration(analysis.durationSec)}
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          {formatDateTime(analysis.published)}
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          {renderReviewStatus(analysis)}
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          {formatDateTime(analysis.analyzedAt)}
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
              className={`border px-4 py-3 text-sm shadow-[0_12px_30px_rgba(28,25,23,0.12)] ${toast.kind === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900"}`}
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