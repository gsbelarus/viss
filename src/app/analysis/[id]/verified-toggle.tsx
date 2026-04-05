"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import type {
  VideoAnalysisDetailResponse,
  VideoAnalysisUpdateResponse,
} from "@/lib/video-analysis-shared";

function getRequestError(error: unknown, fallbackMessage: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallbackMessage;
}

type VerifiedToggleProps = Readonly<{
  analysisId: string;
  initialVerified: boolean;
}>;

export default function VerifiedToggle({
  analysisId,
  initialVerified,
}: VerifiedToggleProps) {
  const router = useRouter();
  const syncControllerRef = useRef<AbortController | null>(null);
  const [verified, setVerified] = useState(initialVerified);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();

  useEffect(() => {
    setVerified(initialVerified);
    setErrorMessage(null);

    syncControllerRef.current?.abort();
    const controller = new AbortController();
    syncControllerRef.current = controller;

    void (async () => {
      try {
        const response = await fetch(`/api/analyses/${analysisId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as VideoAnalysisDetailResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to load verification status.");
        }

        setVerified(payload.analysis.verified);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setErrorMessage(getRequestError(error, "Failed to load verification status."));
      }
    })();

    return () => {
      if (syncControllerRef.current === controller) {
        syncControllerRef.current = null;
      }

      controller.abort();
    };
  }, [analysisId, initialVerified]);

  function handleChange(nextVerified: boolean) {
    const previousVerified = verified;

    syncControllerRef.current?.abort();
    syncControllerRef.current = null;
    setVerified(nextVerified);
    setErrorMessage(null);

    startSaving(async () => {
      try {
        const response = await fetch(`/api/analyses/${analysisId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            verified: nextVerified,
          }),
        });
        const payload = (await response.json()) as VideoAnalysisUpdateResponse & {
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error || "Failed to update verification status.");
        }

        setVerified(payload.analysis.verified);
        router.refresh();
      } catch (error) {
        setVerified(previousVerified);
        setErrorMessage(getRequestError(error, "Failed to update verification status."));
      }
    });
  }

  return (
    <div className="border border-stone-900/8 bg-white/70 p-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={verified}
          disabled={isSaving}
          onChange={(event) => handleChange(event.target.checked)}
          className="mt-1 size-4 rounded border-stone-400 text-emerald-800 focus:ring-emerald-800"
        />
        <span className="block">
          <span className="block text-sm font-medium text-stone-900">Verified</span>
          <span className="mt-1 block text-[0.78rem] leading-5 text-stone-500">
            Use this when the video description, narrative, and transcription make sense.
          </span>
        </span>
      </label>

      {errorMessage ? (
        <p className="mt-3 text-[0.78rem] leading-5 text-rose-800">{errorMessage}</p>
      ) : null}
    </div>
  );
}