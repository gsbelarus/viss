"use client";

import {
  type SVGProps,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import type {
  DownloadDeleteResponse,
  DownloadMetadataResponse,
  DownloadMutationResponse,
  DownloadRecord,
  DownloadStatus,
  DownloadsListResponse,
} from "@/lib/downloads-shared";
import type {
  DownloadAnalysisStatus,
  StartVideoAnalysisResponse,
} from "@/lib/video-analysis-shared";

type ToastKind = "info" | "success" | "error";

interface ToastMessage {
  id: string;
  kind: ToastKind;
  message: string;
}

const EMPTY_FORM = {
  url: "",
  name: "",
  tags: "",
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
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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

export default function DownloadsPage() {
  const [downloads, setDownloads] = useState<DownloadRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [previewDownload, setPreviewDownload] = useState<DownloadRecord | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [isMetadataLoading, setIsMetadataLoading] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isSubmitting, startSubmitting] = useTransition();
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

      setDownloads(payload.downloads);
      setSelectedIds((current) =>
        current.filter((id) => payload.downloads.some((download) => download.id === id))
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
    void loadDownloads(true);

    const timer = window.setInterval(() => {
      void loadDownloads(false);
    }, 2500);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadDownloads]);

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

    const confirmed = window.confirm(
      selectedIds.length === 1
        ? "Delete the selected download?"
        : `Delete ${selectedIds.length} selected downloads?`
    );

    if (!confirmed) {
      return;
    }

    void deleteDownloadsByIds(selectedIds);
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
    const confirmed = window.confirm(
      `Delete ${download.name || "this download"}?`
    );

    if (!confirmed) {
      return;
    }

    startDeleting(async () => {
      await deleteDownloadsByIds([download.id]);
    });
  }

  function handleAnalyze(download: DownloadRecord) {
    if (!isAnalyzable(download)) {
      return;
    }

    startAnalyzing(async () => {
      try {
        const response = await fetch("/api/analyses", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ id: download.id }),
        });
        const payload = (await response.json()) as StartVideoAnalysisResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to start video analysis.");
        }

        pushToast("info", payload.message || "Video analysis started.");
        await loadDownloads(false);
      } catch (error) {
        pushToast(
          "error",
          getRequestError(error, "Failed to start video analysis.")
        );
      }
    });
  }

  return (
    <>
      <div className="space-y-4">
        <section className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
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
            <span>{downloads.length} registered downloads</span>
            <span>YouTube is the only supported provider at the moment.</span>
          </div>
        </section>

        <section className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] shadow-[0_12px_30px_rgba(28,25,23,0.05)]">
          {isLoading ? (
            <div className="px-5 py-8 text-sm text-stone-500">Loading downloads...</div>
          ) : loadError ? (
            <div className="px-5 py-8 text-sm text-rose-700">{loadError}</div>
          ) : downloads.length === 0 ? (
            <div className="px-5 py-8 text-sm text-stone-500">
              No downloads have been registered yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                      Downloaded
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Status
                    </th>
                    <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {downloads.map((download) => (
                    <tr key={download.id} className="border-b border-stone-900/8 last:border-b-0">
                      <td className="px-4 py-3 align-top">
                        <input
                          type="checkbox"
                          checked={selectedIdSet.has(download.id)}
                          onChange={() => toggleSelection(download.id)}
                          aria-label={`Select ${download.name || download.url}`}
                        />
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-stone-600">
                        {download.provider}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="text-sm font-medium text-stone-950">
                          {download.name || "Untitled video"}
                        </div>
                        <div className="mt-1 text-[0.76rem] text-stone-500">
                          {download.fileName || "File name will be assigned on download."}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-stone-600">
                        <div className="max-w-sm truncate">{download.url}</div>
                        {download.errorMessage ? (
                          <div className="mt-1 text-[0.76rem] text-rose-700">
                            {download.errorMessage}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 align-top">
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
                      <td className="px-4 py-3 align-top text-sm text-stone-600">
                        {download.status === "downloading" || download.status === "queued"
                          ? `${formatBytes(download.bytesReceived)}${download.expectedSize ? ` / ${formatBytes(download.expectedSize)}` : ""}`
                          : formatBytes(download.size)}
                      </td>
                      <td className="px-4 py-3 align-top text-sm text-stone-600">
                        {formatDateTime(download.downloaded)}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-flex px-2 py-1 text-[0.72rem] font-medium uppercase tracking-[0.16em] ${getStatusBadge(download.status)}`}
                        >
                          {download.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap gap-2">
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