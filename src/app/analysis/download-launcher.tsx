"use client";

import { type SVGProps, useRef, useState, useTransition } from "react";

import { dispatchActiveProcessesRefresh } from "@/lib/active-process-events";
import type {
  DownloadMetadataResponse,
  DownloadMutationResponse,
} from "@/lib/downloads-shared";

type ToastKind = "info" | "error";

interface DownloadLauncherProps {
  onToast?: (kind: ToastKind, message: string) => void;
}

const EMPTY_FORM = {
  url: "",
  name: "",
  tags: "",
};

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

function DownloadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M12 3v11" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m7 10 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" strokeLinecap="round" />
    </svg>
  );
}

export default function DownloadLauncher({ onToast }: DownloadLauncherProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [isMetadataLoading, setIsMetadataLoading] = useState(false);
  const [isSubmitting, startSubmitting] = useTransition();
  const fieldEditsRef = useRef({
    name: false,
    tags: false,
  });

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

  async function fetchMetadata(url: string) {
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
        onToast?.("info", payload.message || "Download started.");
        dispatchActiveProcessesRefresh();
      } catch (error) {
        const errorMessage = getRequestError(error, "Failed to queue the download.");

        setFormError(errorMessage);
        onToast?.("error", errorMessage);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="inline-flex items-center gap-2 border border-stone-900/10 bg-stone-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-800"
      >
        <DownloadIcon className="size-4" aria-hidden="true" />
        Download
      </button>

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
    </>
  );
}