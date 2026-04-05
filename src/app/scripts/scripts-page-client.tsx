"use client";

import Link from "next/link";
import { type SVGProps, useCallback, useState, useTransition } from "react";

import { formatLocalizedDateTime, getPreferredLocale } from "@/lib/date-time";
import type {
  ScriptDeleteResponse,
  ScriptListRecord,
} from "@/lib/scripts-shared";

type ToastKind = "success" | "error";

interface ToastMessage {
  id: string;
  kind: ToastKind;
  message: string;
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

function EditIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...props}>
      <path d="M4 20h4l9.9-9.9-4-4L4 16v4Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m12.9 5.1 4 4" strokeLinecap="round" strokeLinejoin="round" />
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

function summarizeBasedOn(script: ScriptListRecord) {
  if (script.basedOn.length === 0) {
    return "Custom brief only";
  }

  return script.basedOn.map((video) => video.name).join(", ");
}

export default function ScriptsPageClient({
  initialScripts,
}: {
  initialScripts: ScriptListRecord[];
}) {
  const [scripts, setScripts] = useState(initialScripts);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isDeleting, startDeleting] = useTransition();

  const pushToast = useCallback((kind: ToastKind, message: string) => {
    const id = crypto.randomUUID();

    setToasts((current) => [...current, { id, kind, message }]);

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  function handleDelete(script: ScriptListRecord) {
    if (!window.confirm(`Delete ${script.name}?`)) {
      return;
    }

    setDeletingId(script.id);

    startDeleting(async () => {
      try {
        const response = await fetch(`/api/scripts/${script.id}`, {
          method: "DELETE",
        });
        const payload = (await response.json()) as ScriptDeleteResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to delete the script.");
        }

        setScripts((current) => current.filter((currentScript) => currentScript.id !== script.id));
        pushToast("success", payload.message || "Script deleted.");
      } catch (error) {
        pushToast("error", getRequestError(error, "Failed to delete the script."));
      } finally {
        setDeletingId(null);
      }
    });
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col gap-4">
        <section className="shrink-0 border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
                Script Library
              </p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-stone-950">
                Original drafts built from briefs and analyzed videos
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
                Create reusable script drafts, link them to uploaded videos for inspiration,
                and keep editable generated output in one workspace.
              </p>
            </div>

            <Link
              href="/scripts/new"
              className="inline-flex shrink-0 items-center justify-center border border-stone-900/10 bg-stone-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-stone-800"
            >
              <span className="text-white">Create New Script</span>
            </Link>
          </div>
        </section>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden border border-stone-900/8 bg-[rgba(255,252,247,0.92)] shadow-[0_12px_30px_rgba(28,25,23,0.05)]">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-stone-900/8 bg-stone-950/[0.02]">
                  <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Name
                  </th>
                  <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Based On
                  </th>
                  <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Created At
                  </th>
                  <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Updated At
                  </th>
                  <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {scripts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 align-middle">
                      <div>
                        <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-emerald-800">
                          Empty State
                        </p>
                        <p className="mt-2 max-w-xl text-sm leading-6 text-stone-600">
                          No scripts yet. Start a draft from your own brief, or anchor it to one or
                          more uploaded videos for inspiration.
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  scripts.map((script) => {
                    const deleteDisabled = isDeleting && deletingId === script.id;

                    return (
                      <tr key={script.id} className="border-b border-stone-900/8 last:border-b-0">
                        <td className="px-4 py-3 align-middle">
                          <div className="text-sm font-medium text-stone-950">{script.name}</div>
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          <div className="max-w-md break-words leading-6">{summarizeBasedOn(script)}</div>
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          {formatDateTime(script.createdAt)}
                        </td>
                        <td className="px-4 py-3 align-middle text-sm text-stone-600">
                          {formatDateTime(script.updatedAt)}
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={`/scripts/${script.id}`}
                              aria-label={`Edit ${script.name}`}
                              title="Edit"
                              className="inline-flex size-8 items-center justify-center border border-stone-900/10 bg-white text-stone-700 transition hover:border-stone-900/20 hover:bg-stone-50"
                            >
                              <EditIcon className="size-4" aria-hidden="true" />
                            </Link>
                            <button
                              type="button"
                              onClick={() => handleDelete(script)}
                              disabled={deleteDisabled}
                              aria-label={`Delete ${script.name}`}
                              title={deleteDisabled ? "Deleting..." : "Delete"}
                              className="inline-flex size-8 items-center justify-center border border-rose-200 bg-rose-50 text-rose-700 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <DeleteIcon className="size-4" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
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
