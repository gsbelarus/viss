import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getVideoAnalysisDetails } from "@/lib/analyses";
import { ApiError } from "@/lib/api-utils";
import {
  formatLocalizedDateTime,
  getPreferredLocaleFromAcceptLanguage,
} from "@/lib/date-time";
import CopyDownloadIdButton from "./copy-download-id-button";
import ReanalyzeButton from "./reanalyze-button";
import VerifiedToggle from "./verified-toggle";
import type {
  PipelineStageStatus,
  VideoAnalysisDetailRecord,
} from "@/lib/video-analysis-shared";

export const dynamic = "force-dynamic";

function formatDateTime(value: string | null | undefined, locale?: string) {
  return formatLocalizedDateTime(value, locale);
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

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function stageTone(status: PipelineStageStatus) {
  if (status === "completed") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (status === "failed") {
    return "bg-rose-100 text-rose-800";
  }

  if (status === "skipped") {
    return "bg-stone-200 text-stone-700";
  }

  return "bg-amber-100 text-amber-800";
}

function renderList(values: string[]) {
  if (values.length === 0) {
    return <p className="text-sm text-stone-500">-</p>;
  }

  return (
    <ul className="space-y-2 text-sm leading-6 text-stone-700">
      {values.map((value) => (
        <li key={value} className="border-l-2 border-stone-900/10 pl-3">
          {value}
        </li>
      ))}
    </ul>
  );
}

function renderNarrativeCell(label: string, value: string | null) {
  return (
    <div className="border border-stone-900/8 bg-white/70 p-4">
      <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">{label}</p>
      <p className="mt-2 text-sm leading-6 text-stone-700">{value || "-"}</p>
    </div>
  );
}

async function loadAnalysis(id: string) {
  try {
    return await getVideoAnalysisDetails(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }

    throw error;
  }
}

function renderSummaryCell(
  label: string,
  primary: ReactNode,
  secondary?: ReactNode,
  className?: string
) {
  return (
    <div className={["border border-stone-900/8 bg-white/70 p-4", className].filter(Boolean).join(" ")}>
      <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">{label}</p>
      <div className="mt-2 break-words text-sm font-medium leading-6 text-stone-900">{primary}</div>
      {secondary ? <div className="mt-1 text-[0.78rem] leading-5 text-stone-500">{secondary}</div> : null}
    </div>
  );
}

function formatMediaProfile(analysis: VideoAnalysisDetailRecord) {
  const hasResolution = analysis.mediaMetadata.width > 0 && analysis.mediaMetadata.height > 0;
  const resolution = hasResolution
    ? `${analysis.mediaMetadata.width} x ${analysis.mediaMetadata.height}`
    : null;
  const frameRate =
    analysis.mediaMetadata.fps > 0 ? `${analysis.mediaMetadata.fps.toFixed(2)} fps` : null;

  return {
    primary: resolution || frameRate || "-",
    secondary: resolution && frameRate ? frameRate : null,
  };
}

function formatCodecSummary(analysis: VideoAnalysisDetailRecord) {
  const videoCodec = analysis.mediaMetadata.videoCodec || null;
  const audioCodec = analysis.mediaMetadata.audioPresent
    ? analysis.mediaMetadata.audioCodec || "Unknown"
    : "No audio track";

  return {
    primary: videoCodec || audioCodec || "-",
    secondary: videoCodec ? `Audio: ${audioCodec}` : null,
  };
}

function formatConfidenceSummary(analysis: VideoAnalysisDetailRecord) {
  return {
    primary: formatPercent(analysis.analysis.confidence.overall),
    secondary: [
      `Transcript ${formatPercent(analysis.analysis.confidence.transcriptConfidence)}`,
      `Visual ${formatPercent(analysis.analysis.confidence.visualConfidence)}`,
      `Scenario ${formatPercent(analysis.analysis.confidence.scenarioConfidence)}`,
    ].join(" | "),
  };
}

export default async function AnalysisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const preferredLocale = getPreferredLocaleFromAcceptLanguage(
    (await headers()).get("accept-language")
  );
  const analysis = await loadAnalysis(id);
  const framesWithText = analysis.ocr.frames.filter((frame) => Boolean(frame.text)).length;
  const mediaProfile = formatMediaProfile(analysis);
  const codecSummary = formatCodecSummary(analysis);
  const confidenceSummary = formatConfidenceSummary(analysis);
  const primarySummary = analysis.analysis.mainIdea || analysis.analysis.summary;
  const supportingSummary =
    analysis.analysis.mainIdea &&
      analysis.analysis.summary &&
      analysis.analysis.summary !== analysis.analysis.mainIdea
      ? analysis.analysis.summary
      : null;

  return (
    <div className="space-y-4">
      <section className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
              Video Inspection
            </p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-stone-950">
              {analysis.name || analysis.fileName || analysis.videoId}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              {primarySummary || "No summary was produced for this video."}
            </p>
            {supportingSummary ? (
              <p className="mt-2 max-w-3xl text-[0.82rem] leading-6 text-stone-500">
                {supportingSummary}
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.78rem] text-stone-500">
              <span>{analysis.platform || "Unknown platform"}</span>
              <span>{formatDuration(analysis.mediaMetadata.durationSec)}</span>
              <span>{formatBytes(analysis.mediaMetadata.fileSizeBytes)}</span>
              <span>{analysis.analysis.contentCategory || "Uncategorized"}</span>
              {analysis.downloadId ? (
                <span className="inline-flex items-center gap-2">
                  <span>
                    Download ID:
                  </span>
                  <span className="font-mono text-[0.74rem] text-stone-600">{analysis.downloadId}</span>
                  <CopyDownloadIdButton downloadId={analysis.downloadId} />
                </span>
              ) : (
                <span>Download ID unavailable</span>
              )}
            </div>
          </div>
          <div className="w-full max-w-sm space-y-3 lg:w-auto">
            <ReanalyzeButton
              downloadId={analysis.downloadId}
              videoLabel={analysis.name || analysis.fileName || analysis.videoId}
              status={analysis.status}
            />
            <VerifiedToggle analysisId={analysis.id} initialVerified={analysis.verified} />
          </div>
        </div>
      </section>

      <section className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
              Technical Summary
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
              Compact media and analysis metadata for this video, including publication timing and model confidence.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {renderSummaryCell("Published", formatDateTime(analysis.published, preferredLocale))}
          {renderSummaryCell("Updated", formatDateTime(analysis.updatedAt, preferredLocale))}
          {renderSummaryCell("Duration", formatDuration(analysis.mediaMetadata.durationSec))}
          {renderSummaryCell("Picture", mediaProfile.primary, mediaProfile.secondary)}
          {renderSummaryCell("Codecs", codecSummary.primary, codecSummary.secondary)}
          {renderSummaryCell("Confidence", confidenceSummary.primary, confidenceSummary.secondary)}
          {renderSummaryCell("Category", analysis.analysis.contentCategory || "-")}
          {renderSummaryCell("File Size", formatBytes(analysis.mediaMetadata.fileSizeBytes))}
          {renderSummaryCell(
            "Source",
            analysis.sourceUrl ? (
              <a
                href={analysis.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-900 underline decoration-stone-300 underline-offset-2 transition hover:text-emerald-700"
              >
                {analysis.sourceUrl}
              </a>
            ) : (
              "-"
            ),
            analysis.fileName
          )}
        </div>
      </section>

      <section className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
        <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
          Narrative Structure
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {renderNarrativeCell("Hook", analysis.analysis.narrativeStructure.hook)}
          {renderNarrativeCell("Setup", analysis.analysis.narrativeStructure.setup)}
          {renderNarrativeCell("Development", analysis.analysis.narrativeStructure.development)}
          {renderNarrativeCell("Reveal", analysis.analysis.narrativeStructure.twistOrReveal)}
          {renderNarrativeCell("Payoff", analysis.analysis.narrativeStructure.payoff)}
          {renderNarrativeCell("CTA", analysis.analysis.narrativeStructure.cta)}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
          <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
            OCR
          </p>
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="border border-stone-900/8 bg-white/70 p-4">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">Status</p>
                <p className="mt-2 text-sm font-medium text-stone-900">{analysis.ocr.status}</p>
              </div>
              <div className="border border-stone-900/8 bg-white/70 p-4">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">Detected</p>
                <p className="mt-2 text-sm font-medium text-stone-900">{analysis.ocr.detected ? "Yes" : "No"}</p>
              </div>
              <div className="border border-stone-900/8 bg-white/70 p-4">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">Frames With Text</p>
                <p className="mt-2 text-sm font-medium text-stone-900">{framesWithText}</p>
              </div>
            </div>
            <div className="border border-stone-900/8 bg-white/70 p-4">
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">Summary</p>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">
                {analysis.ocr.summaryText || "No OCR summary available."}
              </div>
            </div>
          </div>
        </div>

        <div className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
          <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
            Transcript
          </p>
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="border border-stone-900/8 bg-white/70 p-4">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">Status</p>
                <p className="mt-2 text-sm font-medium text-stone-900">{analysis.transcript.status}</p>
              </div>
              <div className="border border-stone-900/8 bg-white/70 p-4">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">Language</p>
                <p className="mt-2 text-sm font-medium text-stone-900">{analysis.transcript.language || "-"}</p>
              </div>
            </div>
            <div className="border border-stone-900/8 bg-white/70 p-4">
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">Text</p>
              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-700">
                {analysis.transcript.text || "No transcript available."}
              </div>
              {analysis.transcript.suppressionReason ? (
                <p className="mt-2 text-[0.78rem] leading-5 text-stone-500">
                  {analysis.transcript.suppressionReason}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
          <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
            Observed Facts
          </p>
          <div className="mt-4">{renderList(analysis.analysis.observedFacts)}</div>
        </div>
        <div className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
          <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
            Inferred Elements
          </p>
          <div className="mt-4">{renderList(analysis.analysis.inferredElements)}</div>
        </div>
        <div className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
          <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
            Uncertain Elements
          </p>
          <div className="mt-4">{renderList(analysis.analysis.uncertainElements)}</div>
        </div>
      </section>

      <section className="border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
        <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
          Scene Reconstruction
        </p>
        <div className="mt-4 space-y-3">
          {analysis.analysis.sceneBySceneReconstruction.length > 0 ? (
            analysis.analysis.sceneBySceneReconstruction.map((scene, index) => (
              <div key={`${scene.startSec}-${scene.endSec}-${index}`} className="border border-stone-900/8 bg-white/70 p-4">
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.18em] text-stone-500">
                  {formatDuration(scene.startSec)} to {formatDuration(scene.endSec)}
                </p>
                <p className="mt-2 text-sm leading-6 text-stone-700">{scene.description}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-stone-500">No reconstructed scenes were stored.</p>
          )}
        </div>
      </section>

      <section className="flex min-h-[24rem] max-h-[calc(100dvh-12rem)] flex-col overflow-hidden border border-stone-900/8 bg-[rgba(255,252,247,0.92)] p-5 shadow-[0_12px_30px_rgba(28,25,23,0.05)] sm:p-6">
        <p className="font-mono text-[0.72rem] font-medium uppercase tracking-[0.22em] text-emerald-800">
          Pipeline
        </p>
        <div className="mt-4 min-h-0 flex-1 overflow-auto">
          <table className="min-w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-stone-900/8 bg-stone-950/[0.02]">
                <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">Stage</th>
                <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">Status</th>
                <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">Started</th>
                <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">Finished</th>
                <th className="px-4 py-3 text-[0.72rem] font-medium uppercase tracking-[0.18em] text-stone-500">Error</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(analysis.pipeline).map(([stageKey, stage]) => (
                <tr key={stageKey} className="border-b border-stone-900/8 last:border-b-0">
                  <td className="px-4 py-3 align-top text-sm font-medium text-stone-950">{stageKey}</td>
                  <td className="px-4 py-3 align-top">
                    <span className={`inline-flex px-2 py-1 text-[0.72rem] font-medium uppercase tracking-[0.16em] ${stageTone(stage.status)}`}>
                      {stage.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top text-sm text-stone-600">{formatDateTime(stage.startedAt, preferredLocale)}</td>
                  <td className="px-4 py-3 align-top text-sm text-stone-600">{formatDateTime(stage.finishedAt, preferredLocale)}</td>
                  <td className="px-4 py-3 align-top text-sm text-stone-600">{stage.error || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}