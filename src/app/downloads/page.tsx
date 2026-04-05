"use client";

import Link from "next/link";
import {
  type SVGProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { dispatchActiveProcessesRefresh } from "@/lib/active-process-events";
import { formatLocalizedDateTime, getPreferredLocale } from "@/lib/date-time";
import type {
  DownloadDeleteResponse,
  DownloadMetadataResponse,
  DownloadMutationResponse,
  DownloadRecord,
  DownloadStatus,
  DownloadUpdateResponse,
  DownloadsListResponse,
} from "@/lib/downloads-shared";
import type {
  DownloadAnalysisStatus,
  StartVideoAnalysisConflictResponse,
  StartVideoAnalysisResponse,
} from "@/lib/video-analysis-shared";

type ToastKind = "info" | "success" | "error";

interface ToastMessage {
  id: string;
  kind: ToastKind;
  message: string;
}

interface DeleteConfirmationState {
  ids: string[];
  title: string;
  message: string;
}

const EMPTY_FORM = {
  url: "",
  name: "",
  tags: "",
};

const EMPTY_DETAIL_FORM = {
  tags: "",
  published: "",
};

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

function formatDateTime(value: string | null) {
  return formatLocalizedDateTime(
    value,
    typeof navigator === "undefined"
      ? undefined
      : getPreferredLocale(navigator.languages) ?? navigator.language
  );
}

function formatDateTimeInput(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const pad = (part: number) => String(part).padStart(2, "0");

  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join("T");
}

function buildDetailForm(download: DownloadRecord) {
  return {
    tags: download.tags.map((tag) => tag.name).join(", "),
    published: formatDateTimeInput(download.published),
  };
}

function parseTagInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function getRequestError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

function getStatusBadge(status: DownloadStatus) {
  switch (status) {
    case "queued":
      return "bg-amber-100 text-amber-800";
    case "downloading":
      return "bg-sky-100 text-sky-800";
    case "completed":
      return "bg-emerald-100 text-emerald-800";
    case "failed":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-stone-200 text-stone-700";
  }
}

function getAnalysisStatusBadge(status: DownloadAnalysisStatus) {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-800";
    case "partial":
      return "bg-amber-100 text-amber-800";
    case "failed":
      return "bg-rose-100 text-rose-800";
    case "queued":
      return "bg-amber-100 text-amber-800";
    case "analyzing":
      return "bg-sky-100 text-sky-800";
    default:
      return "bg-stone-200 text-stone-700";
  }
}

function hasSavedAnalysis(download: DownloadRecord) {
  return download.analysisStatus === "completed" || download.analysisStatus === "partial";
}

function hasAnalysisPage(download: DownloadRecord) {
  return ["completed", "partial", "failed"].includes(download.analysisStatus);
}

function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M12 3v11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" strokeLinecap="round" />
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

function AnalyzeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M10.5 4h3" strokeLinecap="round" />
      <path d="M12 2.5v3" strokeLinecap="round" />
      <path d="m17.8 15.8 2.7 2.7" strokeLinecap="round" />
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="M10.5 8.1v2.7l1.8 1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ViewIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12Z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

function AnalysisLinkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M7 4.5h7.5L19 9v10.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14.5 4.5V9H19" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12h6" strokeLinecap="round" />
      <path d="M9 15.5h6" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M6 6 18 18" strokeLinecap="round" />
      <path d="M18 6 6 18" strokeLinecap="round" />
    </svg>
  );
}

interface DownloadStateSnapshot {
  downloadStatus: DownloadStatus;
  analysisStatus: DownloadAnalysisStatus;
}

function getAnalyzeButtonTone(download: DownloadRecord) {
  switch (download.analysisStatus) {
    case "completed":
      return "border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100";
    case "partial":
      return "border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100";
    case "failed":
      return "border border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100";
    case "queued":
    case "analyzing":
      return "border border-amber-200 bg-amber-50 text-amber-800";
    default:
      return "border border-stone-900/10 bg-white text-stone-700 hover:border-stone-900/20 hover:bg-stone-50";
  }
}

function hasPendingDownloadWork(downloads: DownloadRecord[]) {
  return downloads.some(
    (download) =>
      download.status === "queued" ||
      download.status === "downloading" ||
      download.analysisStatus === "queued" ||
      download.analysisStatus === "analyzing"
  );
}

export default function DownloadsPage() {
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [previewDownload, setPreviewDownload] = useState<DownloadRecord | null>(null);
  const [detailDownloadId, setDetailDownloadId] = useState<string | null>(null);
  const [detailForm, setDetailForm] = useState(EMPTY_DETAIL_FORM);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmationState | null>(null);
  const [analysisOverwriteId, setAnalysisOverwriteId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [isMetadataLoading, setIsMetadataLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [hasActiveWork, setHasActiveWork] = useState(false);
  const [isSubmitting, startSubmitting] = useTransition();
  const [isSavingDetail, startSavingDetail] = useTransition();
  const [isDeleting, startDeleting] = useTransition();
  const [isAnalyzing, startAnalyzing] = useTransition();
  const previousStatusesRef = useRef<Record<string, DownloadStateSnapshot>>({});
  const hasLoadedOnceRef = useRef(false);
  const fieldEditsRef = useRef({
    name: false,
    tags: false,
  });

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected =
    downloads.length > 0 && downloads.every((download) => selectedIdSet.has(download.id));
  const detailDownload = useMemo(
    () => downloads.find((download) => download.id === detailDownloadId) ?? null,
    [detailDownloadId, downloads]
  );
  const analysisOverwriteDownload = useMemo(
    () => downloads.find((download) => download.id === analysisOverwriteId) ?? null,
    [analysisOverwriteId, downloads]
  );

  const isPlayable = useCallback(
    (download: DownloadRecord) =>
      download.status === "completed" && Boolean(download.fileName),
    []
  );

  const isAnalysisActive = useCallback(
    (download: DownloadRecord) =>
      download.analysisStatus === "queued" || download.analysisStatus === "analyzing",
    []
  );

  const isAnalyzable = useCallback(
    (download: DownloadRecord) =>
      download.status === "completed" && Boolean(download.fileName) && !isAnalysisActive(download),
    [isAnalysisActive]
  );

  const pushToast = useCallback((kind: ToastKind, message: string) => {
    const id = crypto.randomUUID();

    setToasts((current) => [...current, { id, kind, message }]);

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const syncDownload = useCallback((nextDownload: DownloadRecord) => {
    setDownloads((current) =>
      current.map((download) =>
        download.id === nextDownload.id ? nextDownload : download
      )
    );
    setPreviewDownload((current) =>
      current?.id === nextDownload.id ? nextDownload : current
    );
  }, []);

  const updateStatusTransitions = useCallback((nextDownloads: DownloadRecord[]) => {
    if (!hasLoadedOnceRef.current) {
      previousStatusesRef.current = Object.fromEntries(
        nextDownloads.map((download) => [
          download.id,
          {
            downloadStatus: download.status,
            analysisStatus: download.analysisStatus,
          },
        ])
      );
      hasLoadedOnceRef.current = true;
      return;
    }

    for (const download of nextDownloads) {
      const previousState = previousStatusesRef.current[download.id];

      if (previousState && previousState.downloadStatus !== download.status) {
        if (download.status === "completed") {
          pushToast(
            "success",
            `${download.name || "Video"} downloaded successfully.`
          );
        }

        if (download.status === "failed") {
          pushToast(
            "error",
            download.errorMessage || `${download.name || "Video"} failed to download.`
          );
        }
      }

      if (previousState && previousState.analysisStatus !== download.analysisStatus) {
        if (download.analysisStatus === "completed") {
          pushToast(
            "success",
            `${download.name || "Video"} analyzed successfully.`
          );
        }

        if (download.analysisStatus === "partial") {
          pushToast(
            "success",
            `${download.name || "Video"} analysis completed with warnings.`
          );
        }

        if (download.analysisStatus === "failed") {
          pushToast(
            "error",
            download.analysisErrorMessage || `${download.name || "Video"} analysis failed.`
          );
        }
      }
    }

    previousStatusesRef.current = Object.fromEntries(
      nextDownloads.map((download) => [
        download.id,
        {
          downloadStatus: download.status,
          analysisStatus: download.analysisStatus,
        },
      ])
    );
  }, [pushToast]);

  const loadDownloads = useCallback(async (showLoader: boolean) => {
    if (showLoader) {
      setIsLoading(true);
      setLoadError(null);
    }

    try {
      const response = await fetch("/api/downloads", {
        cache: "no-store",
      });
      const payload = (await response.json()) as DownloadsListResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to load downloads.");
      }

      setHasActiveWork(hasPendingDownloadWork(payload.downloads));

      const completedDownloads = payload.downloads.filter(
        (download) => download.status === "completed"
      );

      setDownloads(completedDownloads);
      setSelectedIds((current) =>
        current.filter((id) => completedDownloads.some((download) => download.id === id))
      );
      updateStatusTransitions(payload.downloads);
    } catch (error) {
      if (showLoader) {
        setLoadError(getRequestError(error, "Failed to load downloads."));
      }
    } finally {
      if (showLoader) {
        setIsLoading(false);
      }
    }
  }, [updateStatusTransitions]);

  const fetchMetadata = useCallback(async (url: string) => {
    const trimmedUrl = url.trim();

    if (!trimmedUrl) {
      return;
    }

    setMetadataError(null);
    setIsMetadataLoading(true);

    try {
      const response = await fetch("/api/downloads/metadata", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: trimmedUrl }),
      });
      const payload = (await response.json()) as DownloadMetadataResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to fetch metadata.");
      }

      setForm((current) => ({
        ...current,
        name:
          fieldEditsRef.current.name || current.name.trim()
            ? current.name
            : payload.name || "",
        tags:
          fieldEditsRef.current.tags || current.tags.trim()
            ? current.tags
            : payload.tags.join(", "),
      }));
    } catch (error) {
      setMetadataError(
        getRequestError(error, "Metadata could not be resolved for this URL.")
      );
    } finally {
      setIsMetadataLoading(false);
    }
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void loadDownloads(false);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadDownloads(false);
      }
    };

    void loadDownloads(true);

    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenVisible);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenVisible);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadDownloads]);

  useEffect(() => {
    if (!hasActiveWork) {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void loadDownloads(false);
    }, 2500);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasActiveWork, loadDownloads]);

  function resetModalState() {
    setForm(EMPTY_FORM);
    setFormError(null);
    setMetadataError(null);
    fieldEditsRef.current = {
      name: false,
      tags: false,
    };
  }

  function openModal() {
    resetModalState();
    setIsModalOpen(true);
  }

  function closeModal() {
    if (isSubmitting) {
      return;
    }

    setIsModalOpen(false);
    resetModalState();
  }

  function closePreview() {
    setPreviewDownload(null);
  }

  function openDetails(download: DownloadRecord) {
    setDetailDownloadId(download.id);
    setDetailForm(buildDetailForm(download));
    setDetailError(null);
  }

  function closeDetails() {
    if (isSavingDetail) {
      return;
    }

    setDetailDownloadId(null);
    setDetailForm(EMPTY_DETAIL_FORM);
    setDetailError(null);
  }

  function closeDeleteConfirmation() {
    if (isDeleting) {
      return;
    }

    setDeleteConfirmation(null);
  }

  function openPreview(download: DownloadRecord) {
    if (!isPlayable(download)) {
      return;
    }

    setPreviewDownload(download);
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id]
    );
  }

  function toggleAllSelection() {
    if (allSelected) {
      setSelectedIds([]);
      return;
    }

    setSelectedIds(downloads.map((download) => download.id));
  }

  function handleSubmit() {
    setFormError(null);

    startSubmitting(async () => {
      try {
        const response = await fetch("/api/downloads", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            url: form.url,
            name: form.name,
            tags: parseTagInput(form.tags),
          }),
        });
        const payload = (await response.json()) as DownloadMutationResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to queue the download.");
        }

        setIsModalOpen(false);
        resetModalState();
        pushToast("info", payload.message || "Download started.");
        setHasActiveWork(true);
        dispatchActiveProcessesRefresh();
        await loadDownloads(false);
      } catch (error) {
        setFormError(getRequestError(error, "Failed to queue the download."));
      }
    });
  }

  function handleDelete() {
    if (selectedIds.length === 0) {
      return;
    }

    setDeleteConfirmation({
      ids: [...selectedIds],
      title:
        selectedIds.length === 1
          ? "Delete selected download?"
          : `Delete ${selectedIds.length} selected downloads?`,
      message:
        selectedIds.length === 1
          ? "This removes the download record, local file, and any related analysis artifacts."
          : `This removes ${selectedIds.length} download records, local files, and any related analysis artifacts.`,
    });
  }

  async function deleteDownloadsByIds(ids: string[]) {
    try {
      const response = await fetch("/api/downloads", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ ids }),
      });
      const payload = (await response.json()) as DownloadDeleteResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to delete the selected downloads.");
      }

      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));

      if (previewDownload && ids.includes(previewDownload.id)) {
        setPreviewDownload(null);
      }

      if (detailDownloadId && ids.includes(detailDownloadId)) {
        setDetailDownloadId(null);
        setDetailForm(EMPTY_DETAIL_FORM);
        setDetailError(null);
      }

      if (analysisOverwriteId && ids.includes(analysisOverwriteId)) {
        setAnalysisOverwriteId(null);
      }

      setDeleteConfirmation(null);

      pushToast("success", payload.message);
      await loadDownloads(false);
    } catch (error) {
      pushToast(
        "error",
        getRequestError(error, "Failed to delete the selected downloads.")
      );
    }
  }

  function handleRowDelete(download: DownloadRecord) {
    setDeleteConfirmation({
      ids: [download.id],
      title: `Delete ${download.name || "this download"}?`,
      message:
        "This removes the download record, local file, and any related analysis artifacts.",
    });
  }

  function handleConfirmDelete() {
    if (!deleteConfirmation) {
      return;
    }

    startDeleting(async () => {
      await deleteDownloadsByIds(deleteConfirmation.ids);
    });
  }

  function handleAnalyze(download: DownloadRecord, overwrite = false) {
    if (!isAnalyzable(download)) {
      return;
    }

    if (!overwrite && hasSavedAnalysis(download)) {
      setAnalysisOverwriteId(download.id);
      return;
    }

    startAnalyzing(async () => {
      try {
        const response = await fetch("/api/analyses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            id: download.id,
            overwrite,
          }),
        });
        const payload = (await response.json()) as
          | StartVideoAnalysisResponse
          | (StartVideoAnalysisConflictResponse & {
            requiresOverwrite?: true;
          });

        if (!response.ok) {
          if ("requiresOverwrite" in payload && payload.requiresOverwrite) {
            setAnalysisOverwriteId(download.id);
            return;
          }

          throw new Error(
            "error" in payload ? payload.error : "Failed to start video analysis."
          );
        }

        setAnalysisOverwriteId(null);
        pushToast(
          "info",
          "message" in payload ? payload.message : "Video analysis started."
        );
        setHasActiveWork(true);
        dispatchActiveProcessesRefresh();
        await loadDownloads(false);
      } catch (error) {
        pushToast(
          "error",
          getRequestError(error, "Failed to start video analysis.")
        );
      }
    });
  }

  function handleConfirmOverwriteAnalysis() {
    if (!analysisOverwriteDownload) {
      return;
    }

    setAnalysisOverwriteId(null);
    handleAnalyze(analysisOverwriteDownload, true);
  }

  function handleDetailSave() {
    if (!detailDownload) {
      return;
    }

    setDetailError(null);

    startSavingDetail(async () => {
      try {
        const published = detailForm.published.trim()
          ? new Date(detailForm.published)
          : null;

        if (published && Number.isNaN(published.getTime())) {
          throw new Error("Published timestamp is invalid.");
        }

        const response = await fetch(`/api/downloads/${detailDownload.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            tags: parseTagInput(detailForm.tags),
            published: published ? published.toISOString() : null,
          }),
        });
        const payload = (await response.json()) as DownloadUpdateResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to update the download.");
        }

        syncDownload(payload.download);
        setDetailForm(buildDetailForm(payload.download));
        pushToast("success", payload.message || "Download updated.");
        await loadDownloads(false);
      } catch (error) {
        setDetailError(getRequestError(error, "Failed to update the download."));
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
                Downloads
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-600">
                Register every YouTube download in the database, store the local
                file on the backend, and track progress from the shared title bar.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={openModal}
                className="inline-flex items-center gap-2 border border-stone-900/10 bg-stone-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-800"
              >
                <DownloadIcon className="size-4" aria-hidden="true" />
                Download
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={selectedIds.length === 0 || isDeleting}
                className="inline-flex items-center gap-2 border border-stone-900/10 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <DeleteIcon className="size-4" aria-hidden="true" />
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-900/8 pt-4 text-[0.78rem] text-stone-500">
            <span>{downloads.length} downloaded videos</span>
            <span>YouTube is the only supported provider at the moment.</span>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-stone-900/8 bg-[rgba(255,252,247,0.92)] shadow-[0_12px_30px_rgba(28,25,23,0.05)]">
          {isLoading ? (
            <div className="flex flex-1 items-center px-5 py-8 text-sm text-stone-500">
              Loading downloads...
            </div>
          ) : loadError ? (
            <div className="flex flex-1 items-center px-5 py-8 text-sm text-rose-700">
              {loadError}
            </div>
          ) : downloads.length === 0 ? (
            <div className="flex flex-1 items-center px-5 py-8 text-sm text-stone-500">
              No downloaded videos yet.
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="min-w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-stone-900/8 bg-stone-950/[0.02]">
                    <th className="w-12 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAllSelection}
                        aria-label="Select all downloads"
                      />
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Provider
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Name
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      URL
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Tags
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Size
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Published
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Downloaded
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {downloads.map((download) => (
                    <tr key={download.id} className="border-b border-stone-900/8 last:border-b-0">
                      <td className="px-4 py-3 align-middle">
                        <input
                          type="checkbox"
                          checked={selectedIdSet.has(download.id)}
                          onChange={() => toggleSelection(download.id)}
                          aria-label={`Select ${download.name || download.url}`}
                        />
                      </td>
                      <td className="px-4 py-3 align-middle text-sm text-stone-600">
                        {download.provider}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="text-sm font-medium text-stone-950">
                          {download.name || "Untitled video"}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle text-sm text-stone-600">
                        <a
                          href={download.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block max-w-sm truncate text-emerald-900 underline decoration-stone-300 underline-offset-2 transition hover:text-emerald-700"
                        >
                          {download.url}
                        </a>
                        {download.errorMessage ? (
                          <div className="mt-1 text-[0.76rem] text-rose-700">
                            {download.errorMessage}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex max-w-xs flex-wrap gap-1.5">
                          {download.tags.length > 0 ? (
                            download.tags.map((tag) => (
                              <span
                                key={tag.id}
                                className="border border-stone-900/8 bg-white px-2 py-0.5 text-[0.72rem] text-stone-600"
                              >
                                {tag.name}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-stone-400">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle text-sm text-stone-600">
                        {download.status === "downloading" || download.status === "queued"
                          ? `${formatBytes(download.bytesReceived)}${download.expectedSize ? ` / ${formatBytes(download.expectedSize)}` : ""}`
                          : formatBytes(download.size)}
                      </td>
                      <td className="px-4 py-3 align-middle text-sm text-stone-600">
                        {formatDateTime(download.published)}
                      </td>
                      <td className="px-4 py-3 align-middle text-sm text-stone-600">
                        {formatDateTime(download.downloaded)}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openDetails(download)}
                            aria-label={`View details for ${download.name || "download"}`}
                            title="View details"
                            className="inline-flex size-8 items-center justify-center border border-stone-900/10 bg-white text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50"
                          >
                            <ViewIcon className="size-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAnalyze(download)}
                            disabled={!isAnalyzable(download) || isAnalyzing}
                            aria-label={`${download.analysisStatus === "completed" || download.analysisStatus === "partial" ? "Re-run analysis for" : "Analyze"} ${download.name || "download"}`}
                            title={
                              download.analysisStatus === "completed" || download.analysisStatus === "partial"
                                ? "Re-run analysis"
                                : download.analysisStatus === "queued" || download.analysisStatus === "analyzing"
                                  ? "Analysis running"
                                  : "Analyze"
                            }
                            className={`inline-flex size-8 items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-50 ${getAnalyzeButtonTone(download)}`}
                          >
                            <AnalyzeIcon className="size-4" aria-hidden="true" />
                          </button>
                          {hasAnalysisPage(download) ? (
                            <Link
                              href={`/analysis/${download.id}`}
                              aria-label={`Go to analysis for ${download.name || "download"}`}
                              title="Go to analysis"
                              className="inline-flex size-8 items-center justify-center border border-stone-900/10 bg-white text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50"
                            >
                              <AnalysisLinkIcon className="size-4" aria-hidden="true" />
                            </Link>
                          ) : (
                            <button
                              type="button"
                              disabled
                              aria-label={`No analysis available for ${download.name || "download"}`}
                              title="No analysis available"
                              className="inline-flex size-8 items-center justify-center border border-stone-900/10 bg-white text-stone-400 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <AnalysisLinkIcon className="size-4" aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openPreview(download)}
                            disabled={!isPlayable(download)}
                            aria-label={`Play ${download.name || "downloaded video"}`}
                            title="Play"
                            className="inline-flex size-8 items-center justify-center border border-stone-900/10 bg-white text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <PlayIcon className="size-4" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRowDelete(download)}
                            disabled={isDeleting || isAnalysisActive(download)}
                            aria-label={`Delete ${download.name || "download"}`}
                            title="Delete"
                            className="inline-flex size-8 items-center justify-center border border-rose-200 bg-rose-50 text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <DeleteIcon className="size-4" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/45 p-4">
          <div className="w-full max-w-xl border border-stone-900/10 bg-[rgba(255,252,247,0.98)] shadow-[0_24px_60px_rgba(28,25,23,0.2)]">
            <div className="border-b border-stone-900/8 px-5 py-4">
              <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
                Download
              </p>
              <h2 className="mt-2 text-lg font-semibold text-stone-950">
                Queue a YouTube video download
              </h2>
            </div>

            <div className="space-y-4 px-5 py-5">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-stone-800">URL</span>
                <input
                  type="url"
                  value={form.url}
                  onChange={(event) => {
                    setForm((current) => ({ ...current, url: event.target.value }));
                    setMetadataError(null);
                    setFormError(null);
                  }}
                  onBlur={() => {
                    void fetchMetadata(form.url);
                  }}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full border border-stone-900/10 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-emerald-800"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-stone-800">Name</span>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(event) => {
                      fieldEditsRef.current.name = true;
                      setForm((current) => ({ ...current, name: event.target.value }));
                    }}
                    placeholder="Optional title override"
                    className="w-full border border-stone-900/10 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-emerald-800"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-stone-800">Tags</span>
                  <input
                    type="text"
                    value={form.tags}
                    onChange={(event) => {
                      fieldEditsRef.current.tags = true;
                      setForm((current) => ({ ...current, tags: event.target.value }));
                    }}
                    placeholder="tag-one, tag-two"
                    className="w-full border border-stone-900/10 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-emerald-800"
                  />
                </label>
              </div>

              <div className="space-y-2 text-[0.78rem] text-stone-500">
                <p>
                  Leave Name or Tags empty and the system will try to fill them from
                  YouTube metadata. Any values you type stay as entered.
                </p>
                {isMetadataLoading ? (
                  <p className="text-emerald-800">Resolving metadata...</p>
                ) : null}
                {metadataError ? <p className="text-rose-700">{metadataError}</p> : null}
                {formError ? <p className="text-rose-700">{formError}</p> : null}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-stone-900/8 px-5 py-4">
              <button
                type="button"
                onClick={closeModal}
                className="border border-stone-900/10 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!form.url.trim() || isSubmitting}
                className="border border-stone-900/10 bg-stone-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Starting..." : "Download"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewDownload ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/65 p-4">
          <div className="w-full max-w-5xl border border-stone-900/10 bg-[rgba(255,252,247,0.98)] shadow-[0_24px_60px_rgba(28,25,23,0.24)]">
            <div className="flex items-start justify-between gap-4 border-b border-stone-900/8 px-5 py-4">
              <div>
                <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
                  Playback
                </p>
                <h2 className="mt-2 text-lg font-semibold text-stone-950">
                  {previewDownload.name || "Downloaded video"}
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
              <video
                key={previewDownload.id}
                controls
                autoPlay
                playsInline
                preload="metadata"
                className="max-h-[72vh] w-full bg-black"
                src={`/api/downloads/${previewDownload.id}/file`}
              />
            </div>
          </div>
        </div>
      ) : null}

      {detailDownload ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/65 p-4">
          <div className="w-full max-w-5xl border border-stone-900/10 bg-[rgba(255,252,247,0.98)] shadow-[0_24px_60px_rgba(28,25,23,0.24)]">
            <div className="flex items-start justify-between gap-4 border-b border-stone-900/8 px-5 py-4">
              <div>
                <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
                  Video details
                </p>
                <h2 className="mt-2 text-lg font-semibold text-stone-950">
                  {detailDownload.name || "Untitled video"}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeDetails}
                aria-label="Close details"
                title="Close"
                className="inline-flex size-9 items-center justify-center border border-stone-900/10 bg-white text-stone-700 transition hover:bg-stone-50"
              >
                <CloseIcon className="size-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
              <section>
                <dl className="grid gap-y-3 text-sm text-stone-700 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-x-4">
                  <dt className="font-medium text-stone-500">Provider</dt>
                  <dd>{detailDownload.provider}</dd>

                  <dt className="font-medium text-stone-500">Source URL</dt>
                  <dd>
                    <a
                      href={detailDownload.url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-emerald-900 underline decoration-stone-300 underline-offset-2 transition hover:text-emerald-700"
                    >
                      {detailDownload.url}
                    </a>
                  </dd>

                  <dt className="font-medium text-stone-500">File</dt>
                  <dd>{detailDownload.fileName || "-"}</dd>

                  <dt className="font-medium text-stone-500">Size</dt>
                  <dd>{formatBytes(detailDownload.size)}</dd>

                  <dt className="font-medium text-stone-500">Download status</dt>
                  <dd>
                    <span
                      className={`inline-flex items-center justify-center px-2 py-1 text-[0.72rem] font-medium uppercase tracking-[0.16em] ${getStatusBadge(detailDownload.status)}`}
                    >
                      {detailDownload.status}
                    </span>
                  </dd>

                  <dt className="font-medium text-stone-500">Analysis</dt>
                  <dd className="space-y-1">
                    <span
                      className={`inline-flex items-center justify-center px-2 py-1 text-[0.72rem] font-medium uppercase tracking-[0.16em] ${getAnalysisStatusBadge(detailDownload.analysisStatus)}`}
                    >
                      {detailDownload.analysisStatus}
                    </span>
                    <div className="text-stone-500">
                      {detailDownload.analysisStage || "No analysis stage available."}
                    </div>
                  </dd>

                  <dt className="font-medium text-stone-500">Published</dt>
                  <dd>{formatDateTime(detailDownload.published)}</dd>

                  <dt className="font-medium text-stone-500">Downloaded</dt>
                  <dd>{formatDateTime(detailDownload.downloaded)}</dd>

                  <dt className="font-medium text-stone-500">Analyzed</dt>
                  <dd>{formatDateTime(detailDownload.analyzed)}</dd>

                  <dt className="font-medium text-stone-500">Created</dt>
                  <dd>{formatDateTime(detailDownload.createdAt)}</dd>

                  <dt className="font-medium text-stone-500">Updated</dt>
                  <dd>{formatDateTime(detailDownload.updatedAt)}</dd>
                </dl>

                {detailDownload.errorMessage ? (
                  <div className="mt-4 border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {detailDownload.errorMessage}
                  </div>
                ) : null}

                {detailDownload.analysisErrorMessage ? (
                  <div className="mt-4 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {detailDownload.analysisErrorMessage}
                  </div>
                ) : null}
              </section>

              <section className="space-y-4 border border-stone-900/8 bg-white/70 p-4">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-stone-500">
                    Editable fields
                  </h3>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-stone-800">Tags</span>
                  <input
                    type="text"
                    value={detailForm.tags}
                    onChange={(event) => {
                      setDetailForm((current) => ({
                        ...current,
                        tags: event.target.value,
                      }));
                      setDetailError(null);
                    }}
                    placeholder="tag-one, tag-two"
                    className="w-full border border-stone-900/10 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-emerald-800"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium text-stone-800">Published</span>
                  <input
                    type="datetime-local"
                    value={detailForm.published}
                    onChange={(event) => {
                      setDetailForm((current) => ({
                        ...current,
                        published: event.target.value,
                      }));
                      setDetailError(null);
                    }}
                    className="w-full border border-stone-900/10 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-emerald-800"
                  />
                  <span className="mt-1.5 block text-[0.78rem] text-stone-500">
                    Leave this empty to clear the stored published timestamp.
                  </span>
                </label>

                {detailError ? (
                  <div className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                    {detailError}
                  </div>
                ) : null}
              </section>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-900/8 px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleAnalyze(detailDownload)}
                  disabled={!isAnalyzable(detailDownload) || isAnalyzing}
                  className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${getAnalyzeButtonTone(detailDownload)}`}
                >
                  <AnalyzeIcon className="size-4" aria-hidden="true" />
                  {hasSavedAnalysis(detailDownload) ? "Re-run analysis" : "Analyze"}
                </button>
                <button
                  type="button"
                  onClick={() => handleRowDelete(detailDownload)}
                  disabled={isDeleting || isAnalysisActive(detailDownload)}
                  className="inline-flex items-center gap-2 border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <DeleteIcon className="size-4" aria-hidden="true" />
                  Delete
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={closeDetails}
                  className="border border-stone-900/10 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleDetailSave}
                  disabled={isSavingDetail}
                  className="border border-stone-900/10 bg-stone-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSavingDetail ? "Saving..." : "Save changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {analysisOverwriteDownload ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-stone-950/75 p-4">
          <div className="w-full max-w-md border border-stone-900/10 bg-[rgba(255,252,247,0.98)] shadow-[0_24px_60px_rgba(28,25,23,0.24)]">
            <div className="border-b border-stone-900/8 px-5 py-4">
              <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-amber-800">
                Confirm overwrite
              </p>
              <h2 className="mt-2 text-lg font-semibold text-stone-950">
                Overwrite existing analysis?
              </h2>
            </div>

            <div className="space-y-3 px-5 py-5 text-sm leading-6 text-stone-600">
              <p>
                {analysisOverwriteDownload.name || "This video"} already has saved analysis results.
              </p>
              <p>
                Starting a new analysis will replace the existing analysis document and generated artifacts.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-stone-900/8 px-5 py-4">
              <button
                type="button"
                onClick={() => setAnalysisOverwriteId(null)}
                className="border border-stone-900/10 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmOverwriteAnalysis}
                disabled={isAnalyzing}
                className="border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Overwrite analysis
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteConfirmation ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-stone-950/75 p-4">
          <div className="w-full max-w-md border border-stone-900/10 bg-[rgba(255,252,247,0.98)] shadow-[0_24px_60px_rgba(28,25,23,0.24)]">
            <div className="border-b border-stone-900/8 px-5 py-4">
              <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-rose-800">
                Confirm delete
              </p>
              <h2 className="mt-2 text-lg font-semibold text-stone-950">
                {deleteConfirmation.title}
              </h2>
            </div>

            <div className="space-y-3 px-5 py-5 text-sm leading-6 text-stone-600">
              <p>{deleteConfirmation.message}</p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-stone-900/8 px-5 py-4">
              <button
                type="button"
                onClick={closeDeleteConfirmation}
                disabled={isDeleting}
                className="border border-stone-900/10 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toasts.length > 0 ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={[
                "border px-4 py-3 text-sm shadow-[0_18px_40px_rgba(28,25,23,0.14)]",
                toast.kind === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : toast.kind === "error"
                    ? "border-rose-200 bg-rose-50 text-rose-900"
                    : "border-sky-200 bg-sky-50 text-sky-900",
              ].join(" ")}
            >
              {toast.message}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}