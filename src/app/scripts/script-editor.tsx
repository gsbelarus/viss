"use client";

import { markdown } from "@codemirror/lang-markdown";
import CodeMirror from "@uiw/react-codemirror";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import { useCallback, useState, useTransition } from "react";

import { formatLocalizedDateTime, getPreferredLocale } from "@/lib/date-time";
import {
  SCRIPT_LANGUAGES,
  SCRIPT_LANGUAGE_LABELS,
  type ScriptDetailRecord,
  type ScriptGenerateResponse,
  type ScriptGenerationInput,
  type ScriptLanguage,
  type ScriptMutationInput,
  type ScriptMutationResponse,
  type ScriptSourceVideoRecord,
} from "@/lib/scripts-shared";

const MARKDOWN_EXTENSIONS = [markdown()];

type ToastKind = "success" | "error";
type GeneratedScriptViewMode = "preview" | "edit";

interface ToastMessage {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ScriptEditorProps {
  initialScript: ScriptDetailRecord | null;
  sourceVideos: ScriptSourceVideoRecord[];
}

interface ScriptFormState {
  name: string;
  basedOnDownloadIds: string[];
  language: ScriptLanguage;
  durationSec: string;
  content: string;
  generatedScript: string;
}

function formatDateTime(value: string) {
  return formatLocalizedDateTime(
    value,
    typeof navigator === "undefined"
      ? undefined
      : getPreferredLocale(navigator.languages) ?? navigator.language
  );
}

function getRequestError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

function createInitialForm(script: ScriptDetailRecord | null): ScriptFormState {
  return {
    name: script?.name ?? "",
    basedOnDownloadIds: script?.basedOn.map((video) => video.id) ?? [],
    language: script?.language ?? "english",
    durationSec: script?.durationSec ? String(script.durationSec) : "",
    content: script?.content ?? "",
    generatedScript: script?.generatedScript ?? "",
  };
}

function parseDurationInput(value: string) {
  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  const parsedValue = Number.parseFloat(normalizedValue);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new Error("Duration must be a positive number of seconds.");
  }

  return Math.round(parsedValue);
}

export default function ScriptEditor({
  initialScript,
  sourceVideos,
}: ScriptEditorProps) {
  const router = useRouter();
  const [form, setForm] = useState<ScriptFormState>(() => createInitialForm(initialScript));
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [generatedScriptViewMode, setGeneratedScriptViewMode] =
    useState<GeneratedScriptViewMode>(() =>
      initialScript?.generatedScript?.trim() ? "preview" : "edit"
    );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isSaving, startSaving] = useTransition();
  const [isGenerating, startGenerating] = useTransition();

  const mergedSourceVideos = [...sourceVideos];

  for (const sourceVideo of initialScript?.basedOn ?? []) {
    if (mergedSourceVideos.some((currentVideo) => currentVideo.id === sourceVideo.id)) {
      continue;
    }

    mergedSourceVideos.push(sourceVideo);
  }

  const sourceVideoById = new Map<string, ScriptSourceVideoRecord>();

  for (const video of mergedSourceVideos) {
    sourceVideoById.set(video.id, video);
  }

  const selectedVideos = form.basedOnDownloadIds.map(
    (downloadId) =>
      sourceVideoById.get(downloadId) ?? {
        id: downloadId,
        name: downloadId,
        description: null,
        fileName: null,
        published: null,
        analysisStatus: "not_started",
        analysisReady: false,
      }
  );
  const addableVideos = mergedSourceVideos.filter(
    (video) => !form.basedOnDownloadIds.includes(video.id)
  );

  const pushToast = useCallback((kind: ToastKind, message: string) => {
    const id = crypto.randomUUID();

    setToasts((current) => [...current, { id, kind, message }]);

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  function updateForm<K extends keyof ScriptFormState>(key: K, value: ScriptFormState[K]) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function addSourceVideo() {
    if (!selectedSourceId || form.basedOnDownloadIds.includes(selectedSourceId)) {
      return;
    }

    updateForm("basedOnDownloadIds", [...form.basedOnDownloadIds, selectedSourceId]);
    setSelectedSourceId("");
  }

  function removeSourceVideo(downloadId: string) {
    updateForm(
      "basedOnDownloadIds",
      form.basedOnDownloadIds.filter((currentId) => currentId !== downloadId)
    );
  }

  function buildMutationPayload(): ScriptMutationInput {
    const name = form.name.trim();
    const content = form.content.trim();

    if (!name) {
      throw new Error("Name is required.");
    }

    if (!content) {
      throw new Error("Script Content is required.");
    }

    return {
      name,
      basedOnDownloadIds: form.basedOnDownloadIds,
      language: form.language,
      durationSec: parseDurationInput(form.durationSec),
      content,
      generatedScript: form.generatedScript.trim() || null,
    };
  }

  function buildGenerationPayload(): ScriptGenerationInput {
    const { generatedScript: _generatedScript, ...payload } = buildMutationPayload();

    return payload;
  }

  function validateGenerationSources() {
    const unavailableSources = selectedVideos.filter((video) => !video.analysisReady);

    if (unavailableSources.length === 0) {
      return;
    }

    throw new Error(
      `Analyze selected videos before generating: ${unavailableSources
        .map((video) => video.name)
        .join(", ")}.`
    );
  }

  function handleSave() {
    startSaving(async () => {
      try {
        const payload = buildMutationPayload();
        const response = await fetch(
          initialScript ? `/api/scripts/${initialScript.id}` : "/api/scripts",
          {
            method: initialScript ? "PATCH" : "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          }
        );
        const responsePayload = (await response.json()) as ScriptMutationResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(responsePayload.error || "Failed to save the script.");
        }

        router.push("/scripts");
        router.refresh();
      } catch (error) {
        pushToast("error", getRequestError(error, "Failed to save the script."));
      }
    });
  }

  function handleGenerate() {
    startGenerating(async () => {
      try {
        validateGenerationSources();
        const payload = buildGenerationPayload();
        const response = await fetch("/api/scripts/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        const responsePayload = (await response.json()) as ScriptGenerateResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(responsePayload.error || "Failed to generate the script.");
        }

        updateForm("generatedScript", responsePayload.generatedScript);
        setGeneratedScriptViewMode("preview");
        pushToast("success", responsePayload.message || "Script generated.");
      } catch (error) {
        pushToast("error", getRequestError(error, "Failed to generate the script."));
      }
    });
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <section className="shrink-0 border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-900/8 pb-4">
            <div>
              <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
                Script Details
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-stone-950">
                {initialScript ? initialScript.name : "New script draft"}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
                Define the brief, attach inspiration videos, and keep the generated markdown
                editable before it becomes part of your production workflow.
              </p>
              {initialScript ? (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[0.78rem] text-stone-500">
                  <span>Created {formatDateTime(initialScript.createdAt)}</span>
                  <span>Updated {formatDateTime(initialScript.updatedAt)}</span>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || isGenerating}
                className="inline-flex items-center justify-center border border-stone-900 bg-stone-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
              <Link
                href="/scripts"
                className="inline-flex items-center justify-center border border-stone-900/10 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50"
              >
                Cancel
              </Link>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-5">
            <div className="space-y-2">
              <label className="block font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                Name
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(event) => updateForm("name", event.target.value)}
                className="w-full border border-stone-900/10 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-900/30"
                placeholder="Enter a working title for the script"
              />
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                  Based On
                </label>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Add one or more analyzed videos for inspiration. Their saved analysis summaries
                  are used during script generation.
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={selectedSourceId}
                  onChange={(event) => setSelectedSourceId(event.target.value)}
                  className="min-w-0 flex-1 border border-stone-900/10 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-900/30"
                  disabled={addableVideos.length === 0}
                >
                  <option value="">Select an analyzed video</option>
                  {addableVideos.map((video) => (
                    <option key={video.id} value={video.id}>
                      {video.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addSourceVideo}
                  disabled={!selectedSourceId}
                  className="inline-flex items-center justify-center border border-stone-900 bg-stone-950 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
                >
                  Add
                </button>
              </div>

              {selectedVideos.length === 0 ? (
                <div className="border border-dashed border-stone-900/10 bg-white/70 px-4 py-4 text-sm text-stone-500">
                  No source videos selected. You can still write a script from scratch using only
                  the brief below.
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedVideos.map((video) => (
                    <div
                      key={video.id}
                      className="flex flex-wrap items-start justify-between gap-3 border border-stone-900/8 bg-white/70 px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-stone-950">{video.name}</div>
                        <p className="mt-1 max-w-3xl text-[0.82rem] leading-5 text-stone-600">
                          {video.description ?? "Analysis summary is unavailable for this video."}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeSourceVideo(video.id)}
                        className="shrink-0 border border-stone-900/10 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="block font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                  Language
                </label>
                <select
                  value={form.language}
                  onChange={(event) => updateForm("language", event.target.value as ScriptLanguage)}
                  className="w-full border border-stone-900/10 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-900/30"
                >
                  {SCRIPT_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {SCRIPT_LANGUAGE_LABELS[language]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                  Duration
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.durationSec}
                  onChange={(event) => updateForm("durationSec", event.target.value)}
                  className="w-full border border-stone-900/10 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-900/30"
                  placeholder="Optional target duration in seconds"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <label className="block font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                  Script Content
                </label>
                <p className="mt-1 text-sm leading-6 text-stone-600">
                  Write the brief, narrative requirements, scene ideas, constraints, tone, or any
                  other details that should guide script generation.
                </p>
              </div>
              <div className="overflow-hidden border border-stone-900/10 bg-white">
                <CodeMirror
                  value={form.content}
                  height="280px"
                  extensions={MARKDOWN_EXTENSIONS}
                  onChange={(value) => updateForm("content", value)}
                  basicSetup={{
                    foldGutter: false,
                    dropCursor: false,
                    allowMultipleSelections: false,
                  }}
                />
              </div>
            </div>
          </div>

        </section>

        <section className="flex min-h-[28rem] flex-col border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-900/8 pb-4">
            <div>
              <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
                Generated Script
              </p>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                Generate editable markdown from the selected source analyses and your brief. You
                can revise the output directly before saving.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex overflow-hidden border border-stone-900/10 bg-white">
                <button
                  type="button"
                  onClick={() => setGeneratedScriptViewMode("preview")}
                  aria-pressed={generatedScriptViewMode === "preview"}
                  className={[
                    "px-3 py-2 text-sm font-medium transition",
                    generatedScriptViewMode === "preview"
                      ? "bg-stone-950 text-white"
                      : "bg-white text-stone-700 hover:bg-stone-50",
                  ].join(" ")}
                >
                  Preview
                </button>
                <button
                  type="button"
                  onClick={() => setGeneratedScriptViewMode("edit")}
                  aria-pressed={generatedScriptViewMode === "edit"}
                  className={[
                    "border-l border-stone-900/10 px-3 py-2 text-sm font-medium transition",
                    generatedScriptViewMode === "edit"
                      ? "bg-stone-950 text-white"
                      : "bg-white text-stone-700 hover:bg-stone-50",
                  ].join(" ")}
                >
                  Edit
                </button>
              </div>

              <button
                type="button"
                onClick={handleGenerate}
                disabled={isSaving || isGenerating}
                className="inline-flex items-center justify-center border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-900 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isGenerating ? "Generating..." : "Generate Script"}
              </button>
            </div>
          </div>

          <div className="mt-5 min-h-0 flex-1 overflow-auto">
            {generatedScriptViewMode === "preview" ? (
              <div className="min-h-[24rem] overflow-auto border border-stone-900/10 bg-white px-5 py-5">
                {form.generatedScript.trim() ? (
                  <div className="text-[0.92rem] leading-6 text-stone-700 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-stone-300 [&_blockquote]:pl-4 [&_code]:rounded-sm [&_code]:bg-stone-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_em]:text-stone-700 [&_h1]:mt-5 [&_h1]:text-[1.22rem] [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:text-stone-950 [&_h1:first-child]:mt-0 [&_h2]:mt-5 [&_h2]:text-[1.08rem] [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-stone-950 [&_h3]:mt-4 [&_h3]:text-[0.98rem] [&_h3]:font-semibold [&_h3]:text-stone-900 [&_hr]:my-4 [&_li]:mt-1 [&_li]:pl-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-7 [&_ol_ol]:mt-1 [&_ol_ol]:pl-6 [&_ol_ul]:mt-1 [&_ol_ul]:pl-6 [&_p]:mt-2 [&_p:first-child]:mt-0 [&_strong]:font-semibold [&_strong]:text-stone-950 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-7 [&_ul_ol]:mt-1 [&_ul_ol]:pl-6 [&_ul_ul]:mt-1 [&_ul_ul]:pl-6]">
                    <ReactMarkdown>{form.generatedScript}</ReactMarkdown>
                  </div>
                ) : (
                  <div className="border border-dashed border-stone-900/10 bg-white/70 px-4 py-3 text-sm text-stone-500">
                    No generated output yet. Click Generate Script to produce a structured markdown
                    draft, then preview it here.
                  </div>
                )}
              </div>
            ) : (
              <div className="overflow-hidden border border-stone-900/10 bg-white">
                <CodeMirror
                  value={form.generatedScript}
                  height="520px"
                  extensions={MARKDOWN_EXTENSIONS}
                  onChange={(value) => updateForm("generatedScript", value)}
                  basicSetup={{
                    foldGutter: false,
                    dropCursor: false,
                    allowMultipleSelections: false,
                  }}
                />
              </div>
            )}
          </div>
        </section>
      </div>

      {toasts.length > 0 ? (
        <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={[
                "border px-4 py-3 text-sm shadow-lg backdrop-blur",
                toast.kind === "success"
                  ? "border-emerald-200 bg-white/95 text-emerald-900"
                  : "border-rose-200 bg-white/95 text-rose-900",
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
