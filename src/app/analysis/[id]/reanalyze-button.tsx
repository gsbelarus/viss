"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { dispatchActiveProcessesRefresh } from "@/lib/active-process-events";
import type { ActiveProcessesResponse } from "@/lib/processes-shared";
import type {
  StartVideoAnalysisConflictResponse,
  StartVideoAnalysisResponse,
  VideoAnalysisStatus,
} from "@/lib/video-analysis-shared";

function getRequestError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

type ReanalyzeButtonProps = Readonly<{
  downloadId: string | null;
  videoLabel: string;
  status: VideoAnalysisStatus;
}>;

function statusTone(status: VideoAnalysisStatus) {
  if (status === "completed") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "partial") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-rose-100 text-rose-800";
}

function isDocumentVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

export default function ReanalyzeButton({
  downloadId,
  videoLabel,
  status,
}: ReanalyzeButtonProps) {
  const router = useRouter();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "error";
    message: string;
  } | null>(null);
  const [isActiveAnalysis, setIsActiveAnalysis] = useState(false);
  const [isSubmitting, startSubmitting] = useTransition();
  const hasSeenActiveAnalysisRef = useRef(false);

  const disabled = !downloadId || isSubmitting;

  const refreshState = useCallback(async () => {
    if (!downloadId) {
      return;
    }

    try {
      const response = await fetch("/api/downloads/active", {
        cache: "no-store",
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as ActiveProcessesResponse;
      const isCurrentAnalysisActive = payload.jobs.some(
        (job) => job.kind === "analysis" && job.id === downloadId
      );

      if (isCurrentAnalysisActive) {
        hasSeenActiveAnalysisRef.current = true;
      } else if (hasSeenActiveAnalysisRef.current) {
        hasSeenActiveAnalysisRef.current = false;
        setIsActiveAnalysis(false);
        router.refresh();
        return;
      }

      setIsActiveAnalysis(isCurrentAnalysisActive);
    } catch {
      // Keep the header quiet if polling fails.
    }
  }, [downloadId, router]);

  useEffect(() => {
    if (!downloadId) {
      setIsActiveAnalysis(false);
      hasSeenActiveAnalysisRef.current = false;
      return;
    }

    const refreshWhenVisible = () => {
      if (!isDocumentVisible()) {
        return;
      }

      void refreshState();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshState();
      }
    };

    void refreshState();

    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [downloadId, refreshState]);

  useEffect(() => {
    if (!downloadId || !isActiveAnalysis) {
      return;
    }

    const timer = window.setInterval(() => {
      if (!isDocumentVisible()) {
        return;
      }

      void refreshState();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [downloadId, isActiveAnalysis, refreshState]);

  function openConfirm() {
    if (disabled) {
      return;
    }

    setFeedback(null);
    setIsConfirmOpen(true);
  }

  function closeConfirm() {
    if (isSubmitting) {
      return;
    }

    setIsConfirmOpen(false);
  }

  function handleConfirm() {
    if (!downloadId) {
      return;
    }

    startSubmitting(async () => {
      try {
        const response = await fetch("/api/analyses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            id: downloadId,
            overwrite: true,
          }),
        });
        const payload = (await response.json()) as
          | StartVideoAnalysisResponse
          | (StartVideoAnalysisConflictResponse & {
            requiresOverwrite?: true;
          });

        if (!response.ok) {
          throw new Error(
            "error" in payload ? payload.error : "Failed to start video analysis."
          );
        }

        setIsConfirmOpen(false);
        hasSeenActiveAnalysisRef.current = true;
        setIsActiveAnalysis(true);
        dispatchActiveProcessesRefresh();
      } catch (error) {
        setFeedback({
          kind: "error",
          message: getRequestError(error, "Failed to start video analysis."),
        });
      }
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {isActiveAnalysis ? null : (
          <>
            <span
              className={`inline-flex px-3 py-1.5 text-[0.72rem] font-medium uppercase tracking-[0.16em] ${statusTone(status)}`}
            >
              {status}
            </span>
            <button
              type="button"
              onClick={openConfirm}
              disabled={disabled}
              className="inline-flex items-center border border-stone-900/12 bg-white px-3 py-1.5 text-[0.78rem] font-medium text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Starting..." : "Reanalyze"}
            </button>
          </>
        )}

        <Link
          href="/analysis"
          className="inline-flex items-center border border-stone-900/12 bg-white px-3 py-1.5 text-[0.78rem] font-medium text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50"
        >
          Back to Analysis
        </Link>
      </div>

      {feedback ? (
        <div
          className="border border-rose-200 bg-rose-50 px-3 py-2 text-[0.78rem] text-rose-900"
        >
          {feedback.message}
        </div>
      ) : null}

      {isConfirmOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/75 p-4">
          <div className="w-full max-w-md border border-stone-900/10 bg-[rgba(255,252,247,0.98)] shadow-[0_24px_60px_rgba(28,25,23,0.24)]">
            <div className="border-b border-stone-900/8 px-5 py-4">
              <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-amber-800">
                Confirm reanalysis
              </p>
              <h2 className="mt-2 text-lg font-semibold text-stone-950">
                Overwrite existing analysis?
              </h2>
            </div>

            <div className="px-5 py-5 text-sm leading-6 text-stone-700">
              <p>
                {videoLabel || "This video"} already has saved analysis results. Reanalysis
                will overwrite the current output when processing completes.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-stone-900/8 px-5 py-4">
              <button
                type="button"
                onClick={closeConfirm}
                disabled={isSubmitting}
                className="border border-stone-900/10 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting}
                className="border border-stone-900/10 bg-stone-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Starting..." : "Reanalyze"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
