import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { Types } from "mongoose";

import { ApiError, getErrorMessage, isRecord } from "@/lib/api-utils";
import { createLogEntry } from "@/lib/logs";
import { connectToDatabase } from "@/lib/mongodb";
import {
  extractAudioTrack,
  extractStillFrame,
  probeVideo,
  readFrameFingerprint,
  readFrameHistogramData,
} from "@/lib/video-analysis/ffmpeg";
import {
  buildAudioTransitionSignals,
  buildStoryHypotheses,
  buildSynthesisCueTimeline,
} from "@/lib/video-analysis/cues";
import {
  clampFrameTimestamp,
  getLateCoverageCandidateTimestamps,
  getMinimumRepresentativeFrameCount,
} from "@/lib/video-analysis/sampling";
import {
  analyzeFrameWithOpenAI,
  analyzeFrameSequenceWithOpenAI,
  buildSceneEmbeddingTexts,
  generateEmbeddingsWithOpenAI,
  runOcrOnFrameWithOpenAI,
  synthesizeVideoWithOpenAI,
  transcribeAudioWithOpenAI,
} from "@/lib/video-analysis/openai";
import { finalizeTranscriptCandidate } from "@/lib/video-analysis/transcript";
import type {
  AnalysisPipelineStageKey,
  AnalysisRecord,
  AudioHeuristicsRecord,
  DownloadAnalysisStatus,
  DynamicProfile,
  EmbeddingsRecord,
  FrameAnalysisRecord,
  MediaMetadataRecord,
  OcrFrameRecord,
  OcrRecord,
  PipelineStageRecord,
  PipelineStageStatus,
  SceneCandidateRecord,
  SceneRecord,
  SelectedFrameRecord,
  StartVideoAnalysisResponse,
  StoryRole,
  TranscriptRecord,
  VideoAnalysisDocumentData,
  VideoAnalysisStatus,
} from "@/lib/video-analysis-shared";
import { Download } from "@/models/download";
import { VideoAnalysis } from "@/models/video-analysis";

const ANALYSIS_SCOPE = "video_analysis";
const ANALYSIS_STORAGE_DIRECTORY = path.join(process.cwd(), "storage", "analyses");
const DOWNLOADS_DIRECTORY = path.join(process.cwd(), "storage", "downloads");
const ACTIVE_ANALYSIS_STATUSES = ["queued", "analyzing"] as const;

const STAGE_ORDER: AnalysisPipelineStageKey[] = [
  "probe",
  "audioExtraction",
  "transcription",
  "sceneDetection",
  "frameSelection",
  "ocr",
  "audioAnalysis",
  "frameAnalysis",
  "finalSynthesis",
  "embeddings",
];

const STAGE_LABELS: Record<AnalysisPipelineStageKey, string> = {
  probe: "Inspecting video",
  audioExtraction: "Extracting audio",
  transcription: "Transcribing speech",
  sceneDetection: "Detecting scenes",
  frameSelection: "Selecting frames",
  ocr: "Reading on-screen text",
  audioAnalysis: "Analyzing audio",
  frameAnalysis: "Analyzing frames",
  finalSynthesis: "Synthesizing video",
  embeddings: "Generating embeddings",
};

declare global {
  var __vissAnalysisJobs: Map<string, Promise<void>> | undefined;
}

const globalForAnalysisJobs = globalThis as typeof globalThis & {
  __vissAnalysisJobs?: Map<string, Promise<void>>;
};

const analysisJobRegistry = globalForAnalysisJobs.__vissAnalysisJobs ?? new Map<string, Promise<void>>();
globalForAnalysisJobs.__vissAnalysisJobs = analysisJobRegistry;

type AnalysisLogger = (
  level: "info" | "success" | "error",
  message: string,
  details?: Record<string, unknown>
) => Promise<void>;

interface StageRunOptions {
  allowFailure?: boolean;
  debugStore?: Record<string, unknown>;
}

interface SceneDetectionResult {
  candidates: SceneCandidateRecord[];
  tempFiles: string[];
}

interface FrameSelectionTarget {
  timestampSec: number;
  selectionReason: SelectedFrameRecord["selectionReason"];
  score: number | null;
}

interface FrameSelectionResult {
  frames: SelectedFrameRecord[];
}

interface WavSamplesResult {
  sampleRate: number;
  samples: Int16Array;
}

interface OcrLineSummary {
  text: string;
  key: string;
  count: number;
  firstTimestampSec: number;
}

const CTA_TEXT_PATTERN =
  /\b(subscribe|follow|like|comment|share|shop|buy|order|tap|click|visit|link in bio|learn more|save|download|join|book|sign up|dm|message|call now|try|watch more|swipe|get yours|shop now|see more)\b/i;

function roundTo(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function nowIso() {
  return new Date().toISOString();
}

function safeNull<T>(value: T | undefined | null): T | null {
  return value ?? null;
}

function createDefaultPipeline(): Record<AnalysisPipelineStageKey, PipelineStageRecord> {
  return Object.fromEntries(
    STAGE_ORDER.map((stage) => [
      stage,
      {
        status: "pending" satisfies PipelineStageStatus,
        startedAt: null,
        finishedAt: null,
        error: null,
      },
    ])
  ) as Record<AnalysisPipelineStageKey, PipelineStageRecord>;
}

function createEmptyMediaMetadata(): MediaMetadataRecord {
  return {
    durationSec: 0,
    width: 0,
    height: 0,
    fps: 0,
    videoCodec: null,
    audioPresent: false,
    audioCodec: null,
    bitrate: null,
    fileSizeBytes: 0,
  };
}

function createEmptyTranscript(): TranscriptRecord {
  return {
    status: "pending",
    provider: "openai",
    language: null,
    text: null,
    rawText: null,
    segments: [],
    audibleSpeechLikely: false,
    confidence: null,
    suppressionReason: null,
    error: null,
  };
}

function createEmptyScenes(): SceneRecord {
  return {
    status: "pending",
    candidates: [],
    selectionStrategy: {
      earlyHookDenseSampling: true,
      sceneChangeDetection: true,
      uniformBackfill: true,
      dedupeApplied: true,
    },
    error: null,
  };
}

function createEmptyOcr(): OcrRecord {
  return {
    status: "pending",
    detected: false,
    summaryText: null,
    frames: [],
    error: null,
  };
}

function createEmptyAudioHeuristics(): AudioHeuristicsRecord {
  return {
    status: "pending",
    audioPresent: false,
    speechPresentLikely: false,
    musicPresentLikely: false,
    musicPresenceConfidence: 0,
    avgRmsEnergy: 0,
    peakRmsEnergy: 0,
    energyTimeline: [],
    transitionSignals: [],
    silenceRegions: [],
    dynamicProfile: "very_calm",
    notes: [],
    error: null,
  };
}

function createEmptyAnalysis(): AnalysisRecord {
  return {
    status: "failed",
    summary: null,
    mainIdea: null,
    language: null,
    contentCategory: null,
    narrativeStructure: {
      hook: null,
      setup: null,
      development: null,
      twistOrReveal: null,
      payoff: null,
      cta: null,
    },
    visualStyle: null,
    editingStyle: null,
    audioRole: null,
    musicRole: null,
    onScreenTextRole: null,
    probableScript: null,
    sceneBySceneReconstruction: [],
    techniques: [],
    narrativeCues: [],
    observedFacts: [],
    inferredElements: [],
    uncertainElements: [],
    confidence: {
      overall: 0,
      transcriptConfidence: 0,
      visualConfidence: 0,
      scenarioConfidence: 0,
    },
    error: null,
  };
}

function createEmptyEmbeddings(): EmbeddingsRecord {
  return {
    status: "pending",
    embeddingProvider: "openai",
    embeddingModel: "",
    embeddingVersion: "v1",
    embeddingTextVersion: "v1",
    searchText: "",
    video: [],
    scenes: [],
    error: null,
  };
}

function getAnalysisDirectory(videoId: string) {
  return path.join(ANALYSIS_STORAGE_DIRECTORY, videoId);
}

function getDownloadFilePath(fileName: string) {
  return path.join(DOWNLOADS_DIRECTORY, path.basename(fileName));
}

function getStageIndex(stageKey: AnalysisPipelineStageKey) {
  return STAGE_ORDER.indexOf(stageKey);
}

function getStageProgressPercent(stageKey: AnalysisPipelineStageKey, completed: boolean) {
  const stageIndex = getStageIndex(stageKey);
  const fraction = completed
    ? (stageIndex + 1) / STAGE_ORDER.length
    : stageIndex / STAGE_ORDER.length;

  return Math.round(fraction * 100);
}

function buildAnalysisStageMessage(status: DownloadAnalysisStatus, stageKey?: AnalysisPipelineStageKey | null) {
  if (status === "queued") {
    return "Queued";
  }

  if (status === "completed") {
    return "Analysis completed";
  }

  if (status === "partial") {
    return "Analysis completed with warnings";
  }

  if (status === "failed") {
    return "Analysis failed";
  }

  if (status === "not_started") {
    return null;
  }

  return stageKey ? STAGE_LABELS[stageKey] : "Analyzing video";
}

function createAnalysisLogger(downloadId: string): AnalysisLogger {
  return async (level, message, details) => {
    await createLogEntry({
      scope: ANALYSIS_SCOPE,
      level,
      message,
      downloadId,
      details: details ?? null,
    });
  };
}

function createCommandLogger(logger: AnalysisLogger) {
  return async (message: string, details?: Record<string, unknown>) => {
    await logger("info", message, details);
  };
}

async function updateDownloadAnalysisState(
  downloadId: string,
  input: {
    analysisStatus: DownloadAnalysisStatus;
    analysisProgressPercent?: number | null;
    analysisStage?: string | null;
    analysisErrorMessage?: string | null;
    analyzed?: Date | null;
  }
) {
  await Download.findByIdAndUpdate(downloadId, {
    $set: {
      analysisStatus: input.analysisStatus,
      analysisProgressPercent: safeNull(input.analysisProgressPercent),
      analysisStage: safeNull(input.analysisStage),
      analysisErrorMessage: safeNull(input.analysisErrorMessage),
      analyzed: input.analyzed ?? null,
    },
  }).exec();
}

async function runStage<T>(
  downloadId: string,
  stageKey: AnalysisPipelineStageKey,
  pipeline: Record<AnalysisPipelineStageKey, PipelineStageRecord>,
  logger: AnalysisLogger,
  task: () => Promise<T>
): Promise<T>;
async function runStage<T>(
  downloadId: string,
  stageKey: AnalysisPipelineStageKey,
  pipeline: Record<AnalysisPipelineStageKey, PipelineStageRecord>,
  logger: AnalysisLogger,
  task: () => Promise<T>,
  options: StageRunOptions & { allowFailure?: false | undefined }
): Promise<T>;
async function runStage<T>(
  downloadId: string,
  stageKey: AnalysisPipelineStageKey,
  pipeline: Record<AnalysisPipelineStageKey, PipelineStageRecord>,
  logger: AnalysisLogger,
  task: () => Promise<T>,
  options: StageRunOptions & { allowFailure: true }
): Promise<T | null>;
async function runStage<T>(
  downloadId: string,
  stageKey: AnalysisPipelineStageKey,
  pipeline: Record<AnalysisPipelineStageKey, PipelineStageRecord>,
  logger: AnalysisLogger,
  task: () => Promise<T>,
  options?: StageRunOptions
) {
  const startedAt = nowIso();
  const stageLabel = STAGE_LABELS[stageKey];

  pipeline[stageKey] = {
    status: "pending",
    startedAt,
    finishedAt: null,
    error: null,
  };

  await updateDownloadAnalysisState(downloadId, {
    analysisStatus: "analyzing",
    analysisProgressPercent: getStageProgressPercent(stageKey, false),
    analysisStage: buildAnalysisStageMessage("analyzing", stageKey),
    analysisErrorMessage: null,
  });

  await logger("info", `${stageLabel} started.`, {
    stage: stageKey,
  });

  const startedAtMs = Date.now();

  try {
    const result = await task();

    pipeline[stageKey] = {
      status: "completed",
      startedAt,
      finishedAt: nowIso(),
      error: null,
    };

    await logger("success", `${stageLabel} completed.`, {
      stage: stageKey,
      elapsedMs: Date.now() - startedAtMs,
    });

    await updateDownloadAnalysisState(downloadId, {
      analysisStatus: "analyzing",
      analysisProgressPercent: getStageProgressPercent(stageKey, true),
      analysisStage: buildAnalysisStageMessage("analyzing", stageKey),
      analysisErrorMessage: null,
    });

    return result;
  } catch (error) {
    const message = getErrorMessage(error, `${stageLabel} failed.`);

    pipeline[stageKey] = {
      status: "failed",
      startedAt,
      finishedAt: nowIso(),
      error: message,
    };

    captureDebugPayload(options?.debugStore, stageKey, error);

    await logger("error", `${stageLabel} failed.`, {
      stage: stageKey,
      elapsedMs: Date.now() - startedAtMs,
      error: message,
    });

    if (options?.allowFailure) {
      return null;
    }

    throw error;
  }
}

async function markStageSkipped(
  stageKey: AnalysisPipelineStageKey,
  pipeline: Record<AnalysisPipelineStageKey, PipelineStageRecord>,
  logger: AnalysisLogger,
  reason: string
) {
  const timestamp = nowIso();

  pipeline[stageKey] = {
    status: "skipped",
    startedAt: timestamp,
    finishedAt: timestamp,
    error: null,
  };

  await logger("info", `${STAGE_LABELS[stageKey]} skipped.`, {
    stage: stageKey,
    reason,
  });
}

function buildTimestampSeries(endSec: number, stepSec: number) {
  const timestamps: number[] = [];

  if (endSec <= 0) {
    return [0];
  }

  for (let timestamp = 0; timestamp < endSec; timestamp += stepSec) {
    timestamps.push(timestamp);
  }

  if (timestamps.length === 0 || Math.abs(timestamps[timestamps.length - 1] - endSec) > stepSec / 2) {
    timestamps.push(endSec);
  }

  return timestamps;
}

function buildUniformTimestamps(durationSec: number, count: number) {
  if (count <= 1 || durationSec <= 0.1) {
    return [0];
  }

  return Array.from({ length: count }, (_, index) => (durationSec / (count - 1)) * index);
}

function computeVisualDifference(left: Buffer, right: Buffer) {
  const length = Math.min(left.length, right.length);

  if (length === 0) {
    return 0;
  }

  let differenceSum = 0;

  for (let index = 0; index < length; index += 1) {
    differenceSum += Math.abs(left[index] - right[index]);
  }

  return differenceSum / (length * 255);
}

function captureDebugPayload(
  debugStore: Record<string, unknown> | undefined,
  stageKey: AnalysisPipelineStageKey,
  error: unknown
) {
  if (!debugStore || !(error instanceof ApiError) || !isRecord(error.details)) {
    return;
  }

  const rawOutput = error.details.rawOutput;
  const validationError = error.details.validationError;

  if (typeof rawOutput === "string" || typeof validationError === "string") {
    debugStore[stageKey] = {
      rawOutput: typeof rawOutput === "string" ? rawOutput : null,
      validationError: typeof validationError === "string" ? validationError : null,
    };
  }
}

async function detectSceneCandidates(
  filePath: string,
  durationSec: number,
  analysisDirectory: string,
  commandLogger: (message: string, details?: Record<string, unknown>) => Promise<void>
): Promise<SceneDetectionResult> {
  const candidateDirectory = path.join(analysisDirectory, "scene-candidates");
  await mkdir(candidateDirectory, { recursive: true });

  const stepSec = durationSec <= 8 ? 0.25 : durationSec <= 20 ? 0.4 : 0.6;
  const sampleTimestamps = buildTimestampSeries(durationSec, stepSec).map((timestamp) =>
    clampFrameTimestamp(timestamp, durationSec)
  );
  const candidates: SceneCandidateRecord[] = [];
  let previousFingerprint: Buffer | null = null;
  let candidateIndex = 1;

  for (const timestampSec of sampleTimestamps) {
    const fingerprint = await readFrameFingerprint(filePath, timestampSec, commandLogger);

    if (previousFingerprint) {
      const score = computeVisualDifference(previousFingerprint, fingerprint);

      if (score >= 0.18) {
        const framePath = path.join(
          candidateDirectory,
          `scene-${String(candidateIndex).padStart(3, "0")}.jpg`
        );
        await extractStillFrame(filePath, timestampSec, framePath, commandLogger);
        candidates.push({
          timestampSec: roundTo(timestampSec, 3),
          framePath,
          score: roundTo(score, 4),
        });
        candidateIndex += 1;
      }
    }

    previousFingerprint = fingerprint;
  }

  return {
    candidates,
    tempFiles: candidates.map((candidate) => candidate.framePath),
  };
}

function isTimestampNear(
  candidates: FrameSelectionTarget[],
  timestampSec: number,
  minimumSpacingSec: number
) {
  return candidates.some(
    (candidate) => Math.abs(candidate.timestampSec - timestampSec) < minimumSpacingSec
  );
}

async function selectRepresentativeFrames(
  filePath: string,
  durationSec: number,
  sceneCandidates: SceneCandidateRecord[],
  analysisDirectory: string,
  commandLogger: (message: string, details?: Record<string, unknown>) => Promise<void>
): Promise<FrameSelectionResult> {
  const framesDirectory = path.join(analysisDirectory, "frames");
  await mkdir(framesDirectory, { recursive: true });

  const minimumSpacingSec = durationSec <= 8 ? 0.2 : 0.35;
  const earlyHookTargets = buildTimestampSeries(Math.min(durationSec, 3), 0.4).map((timestampSec) => ({
    timestampSec: clampFrameTimestamp(timestampSec, durationSec),
    selectionReason: "early_hook" as const,
    score: null,
  }));
  const lateCoverageTargets = getLateCoverageCandidateTimestamps(
    durationSec,
    sceneCandidates.map((candidate) => ({
      timestampSec: candidate.timestampSec,
      score: candidate.score,
    }))
  ).map((timestampSec) => ({
    timestampSec,
    selectionReason: "uniform_backfill" as const,
    score: null,
  }));
  const sceneTargets = [...sceneCandidates]
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .map((candidate) => ({
      timestampSec: candidate.timestampSec,
      selectionReason: "scene_change" as const,
      score: candidate.score,
    }));
  const uniformTargets = buildUniformTimestamps(durationSec, 12).map((timestampSec) => ({
    timestampSec: clampFrameTimestamp(timestampSec, durationSec),
    selectionReason: "uniform_backfill" as const,
    score: null,
  }));
  const fallbackTargets = buildUniformTimestamps(durationSec, 20).map((timestampSec) => ({
    timestampSec: clampFrameTimestamp(timestampSec, durationSec),
    selectionReason: "fallback" as const,
    score: null,
  }));

  const prioritizedTargets: FrameSelectionTarget[] = [];

  for (const candidate of [
    ...earlyHookTargets,
    ...lateCoverageTargets,
    ...sceneTargets,
    ...uniformTargets,
    ...fallbackTargets,
  ]) {
    if (isTimestampNear(prioritizedTargets, candidate.timestampSec, minimumSpacingSec)) {
      continue;
    }

    prioritizedTargets.push(candidate);

    if (prioritizedTargets.length >= 20) {
      break;
    }
  }

  const selectedFrames: SelectedFrameRecord[] = [];
  const keptHistograms: Buffer[] = [];
  const minimumFrameCount = getMinimumRepresentativeFrameCount(durationSec);

  for (const target of prioritizedTargets) {
    const framePath = path.join(
      framesDirectory,
      `frame-${String(selectedFrames.length + 1).padStart(3, "0")}.jpg`
    );

    await extractStillFrame(filePath, target.timestampSec, framePath, commandLogger);
    const histogram = await readFrameHistogramData(framePath, commandLogger);
    const isDuplicate = keptHistograms.some(
      (existing) => computeVisualDifference(existing, histogram) < 0.035
    );

    if (isDuplicate) {
      await rm(framePath, { force: true }).catch(() => undefined);
      continue;
    }

    keptHistograms.push(histogram);
    selectedFrames.push({
      timestampSec: roundTo(target.timestampSec, 3),
      framePath,
      frameIndex: selectedFrames.length + 1,
      selectionReason: target.selectionReason,
    });

    if (selectedFrames.length >= 15) {
      break;
    }
  }

  if (selectedFrames.length < minimumFrameCount) {
    throw new ApiError(
      500,
      `Unable to derive enough representative frames for analysis (selected ${selectedFrames.length}, require ${minimumFrameCount}).`
    );
  }

  return {
    frames: [...selectedFrames]
      .sort((left, right) => left.timestampSec - right.timestampSec)
      .map((frame, index) => ({
        ...frame,
        frameIndex: index + 1,
      })),
  };
}

function normalizeOcrText(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  return normalized || null;
}

function toOcrKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function splitOcrLines(value: string) {
  return normalizeOcrText(value)?.split("\n").map((line) => line.trim()).filter(Boolean) ?? [];
}

function trimSummaryText(value: string | null, maxLength: number) {
  if (!value) {
    return null;
  }

  const normalized = value.trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function pickOpeningHookText(frames: OcrFrameRecord[], durationSec: number) {
  const preferredWindowSec = Math.max(3, Math.min(durationSec * 0.35, 5));
  const earliestFrameWithText =
    frames.find((frame) => frame.text && frame.timestampSec <= preferredWindowSec) ??
    frames.find((frame) => frame.text);

  if (!earliestFrameWithText?.text) {
    return null;
  }

  const [firstLine] = splitOcrLines(earliestFrameWithText.text);
  return trimSummaryText(firstLine || earliestFrameWithText.text, 180);
}

function pickCtaText(
  lines: Array<{ text: string; timestampSec: number }>,
  durationSec: number
) {
  const latestPreferredStart = Math.max(0, Math.max(durationSec * 0.6, durationSec - 4));
  const preferred = [...lines]
    .reverse()
    .find((line) => line.timestampSec >= latestPreferredStart && CTA_TEXT_PATTERN.test(line.text));

  if (preferred) {
    return trimSummaryText(preferred.text, 180);
  }

  const fallback = [...lines].reverse().find((line) => CTA_TEXT_PATTERN.test(line.text));
  return trimSummaryText(fallback?.text ?? null, 180);
}

function pickSubtitleLines(
  summaries: OcrLineSummary[],
  hookText: string | null,
  ctaText: string | null
) {
  const excludedKeys = new Set(
    [hookText, ctaText]
      .map((value) => (value ? toOcrKey(value) : null))
      .filter((value): value is string => Boolean(value))
  );

  return summaries
    .filter((summary) => !excludedKeys.has(summary.key))
    .filter((summary) => !CTA_TEXT_PATTERN.test(summary.text))
    .filter((summary) => summary.text.length >= 12 && summary.text.length <= 120)
    .filter((summary) => {
      const words = summary.text.split(/\s+/).filter(Boolean);
      return words.length >= 3 || /[.!?,:;]/.test(summary.text);
    })
    .sort((left, right) => {
      const leftWords = left.text.split(/\s+/).filter(Boolean).length;
      const rightWords = right.text.split(/\s+/).filter(Boolean).length;
      const leftScore = left.count * 3 + (/[.!?]/.test(left.text) ? 1 : 0) + (leftWords >= 5 ? 1 : 0);
      const rightScore =
        right.count * 3 + (/[.!?]/.test(right.text) ? 1 : 0) + (rightWords >= 5 ? 1 : 0);

      return rightScore - leftScore || left.firstTimestampSec - right.firstTimestampSec;
    })
    .slice(0, 6)
    .map((summary) => trimSummaryText(summary.text, 160))
    .filter((value): value is string => Boolean(value));
}

function finalizeOcrRecord(frames: OcrFrameRecord[], durationSec: number): OcrRecord {
  const sanitizedFrames = frames.map((frame) => {
    const text = normalizeOcrText(frame.text);

    return {
      ...frame,
      text,
      confidence: text ? frame.confidence : null,
      boxes: text ? frame.boxes : [],
    } satisfies OcrFrameRecord;
  });
  const populatedFrames = sanitizedFrames.filter((frame) => Boolean(frame.text));

  if (populatedFrames.length === 0) {
    return {
      status: "completed",
      detected: false,
      summaryText: null,
      frames: sanitizedFrames,
      error: null,
    };
  }

  const lineSummaries = new Map<string, OcrLineSummary>();
  const orderedLines: string[] = [];
  const lineTimeline: Array<{ text: string; timestampSec: number }> = [];

  for (const frame of populatedFrames) {
    const sourceLines = frame.text ? splitOcrLines(frame.text) : [];
    const frameLines = sourceLines.length > 0 ? sourceLines : frame.text ? [frame.text] : [];
    const seenInFrame = new Set<string>();

    for (const line of frameLines) {
      const normalizedLine = normalizeOcrText(line);

      if (!normalizedLine) {
        continue;
      }

      const key = toOcrKey(normalizedLine);

      if (!key || seenInFrame.has(key)) {
        continue;
      }

      seenInFrame.add(key);
      lineTimeline.push({
        text: normalizedLine,
        timestampSec: frame.timestampSec,
      });

      const existing = lineSummaries.get(key);

      if (existing) {
        existing.count += 1;

        if (normalizedLine.length > existing.text.length) {
          existing.text = normalizedLine;
        }

        continue;
      }

      orderedLines.push(normalizedLine);
      lineSummaries.set(key, {
        text: normalizedLine,
        key,
        count: 1,
        firstTimestampSec: frame.timestampSec,
      });
    }
  }

  const hookText = pickOpeningHookText(populatedFrames, durationSec);
  const ctaText = pickCtaText(lineTimeline, durationSec);
  const subtitleLines = pickSubtitleLines([...lineSummaries.values()], hookText, ctaText);
  const deduplicatedLines = orderedLines.slice(0, 18);
  const sections: string[] = [];

  if (hookText) {
    sections.push(`Opening hook text: ${hookText}`);
  }

  if (ctaText) {
    sections.push(`CTA text: ${ctaText}`);
  }

  if (subtitleLines.length > 0) {
    sections.push(
      `Probable subtitle or caption lines:\n${subtitleLines.map((line) => `- ${line}`).join("\n")}`
    );
  }

  if (deduplicatedLines.length > 0) {
    sections.push(
      `Deduplicated on-screen text:\n${deduplicatedLines
        .map((line) => trimSummaryText(line, 180))
        .filter((value): value is string => Boolean(value))
        .map((line) => `- ${line}`)
        .join("\n")}`
    );
  }

  return {
    status: "completed",
    detected: true,
    summaryText: trimSummaryText(sections.join("\n\n"), 2400),
    frames: sanitizedFrames,
    error: null,
  };
}

function readChunkHeader(buffer: Buffer, offset: number) {
  return {
    id: buffer.toString("ascii", offset, offset + 4),
    size: buffer.readUInt32LE(offset + 4),
  };
}

function computeZeroCrossingRate(samples: Int16Array, startIndex: number, endIndex: number) {
  const sampleCount = endIndex - startIndex;

  if (sampleCount <= 1) {
    return 0;
  }

  let crossings = 0;
  let previous = samples[startIndex];

  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const current = samples[index];

    if ((previous < 0 && current >= 0) || (previous > 0 && current <= 0)) {
      crossings += 1;
    }

    previous = current;
  }

  return crossings / (sampleCount - 1);
}

async function readWavMonoSamples(audioPath: string): Promise<WavSamplesResult> {
  const buffer = await readFile(audioPath);

  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Extracted audio is not a valid WAV file.");
  }

  let offset = 12;
  let sampleRate = 16000;
  let channelCount = 1;
  let bitsPerSample = 16;
  let audioFormat = 1;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= buffer.length) {
    const chunk = readChunkHeader(buffer, offset);
    const valueOffset = offset + 8;

    if (chunk.id === "fmt ") {
      audioFormat = buffer.readUInt16LE(valueOffset);
      channelCount = buffer.readUInt16LE(valueOffset + 2);
      sampleRate = buffer.readUInt32LE(valueOffset + 4);
      bitsPerSample = buffer.readUInt16LE(valueOffset + 14);
    }

    if (chunk.id === "data") {
      dataOffset = valueOffset;
      dataLength = chunk.size;
      break;
    }

    offset = valueOffset + chunk.size + (chunk.size % 2);
  }

  if (audioFormat !== 1 || channelCount !== 1 || bitsPerSample !== 16 || dataOffset < 0) {
    throw new Error("Extracted audio must be mono PCM16 WAV.");
  }

  const slice = buffer.subarray(dataOffset, dataOffset + dataLength);
  const sampleCount = Math.floor(slice.length / 2);
  const samples = new Int16Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    samples[index] = slice.readInt16LE(index * 2);
  }

  return {
    sampleRate,
    samples,
  };
}

function buildSilenceRegions(
  windows: Array<{ startSec: number; endSec: number; rms: number }>,
  threshold: number
) {
  const silenceRegions: AudioHeuristicsRecord["silenceRegions"] = [];
  let activeStart: number | null = null;

  for (const window of windows) {
    if (window.rms <= threshold) {
      if (activeStart === null) {
        activeStart = window.startSec;
      }

      continue;
    }

    if (activeStart !== null) {
      silenceRegions.push({
        startSec: roundTo(activeStart, 3),
        endSec: roundTo(window.startSec, 3),
      });
      activeStart = null;
    }
  }

  if (activeStart !== null && windows.length > 0) {
    silenceRegions.push({
      startSec: roundTo(activeStart, 3),
      endSec: roundTo(windows[windows.length - 1].endSec, 3),
    });
  }

  return silenceRegions;
}

function determineDynamicProfile(avgRmsEnergy: number, peakRmsEnergy: number): DynamicProfile {
  const combined = avgRmsEnergy * 0.65 + peakRmsEnergy * 0.35;

  if (combined < 0.025) {
    return "very_calm";
  }

  if (combined < 0.05) {
    return "calm";
  }

  if (combined < 0.09) {
    return "moderate";
  }

  if (combined < 0.16) {
    return "high_energy";
  }

  return "very_high_energy";
}

function calculateTranscriptCoverage(transcript: TranscriptRecord, durationSec: number) {
  if (durationSec <= 0 || transcript.segments.length === 0) {
    return transcript.text ? Math.min(0.4, transcript.text.length / 600) : 0;
  }

  const coveredDuration = transcript.segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.endSec - segment.startSec),
    0
  );

  return Math.max(0, Math.min(1, coveredDuration / durationSec));
}

async function analyzeAudioHeuristics(
  audioPath: string,
  transcript: TranscriptRecord
): Promise<{ record: AudioHeuristicsRecord; speechLikelihoodScore: number }> {
  const { sampleRate, samples } = await readWavMonoSamples(audioPath);
  const windowDurationSec = 0.5;
  const windowSize = Math.max(1, Math.floor(sampleRate * windowDurationSec));
  const energyTimeline: AudioHeuristicsRecord["energyTimeline"] = [];
  let rmsTotal = 0;
  let peakRmsEnergy = 0;
  let zeroCrossingTotal = 0;

  for (let startIndex = 0; startIndex < samples.length; startIndex += windowSize) {
    const endIndex = Math.min(samples.length, startIndex + windowSize);
    let squareSum = 0;
    let peak = 0;

    for (let sampleIndex = startIndex; sampleIndex < endIndex; sampleIndex += 1) {
      const normalized = samples[sampleIndex] / 32768;
      squareSum += normalized * normalized;
      peak = Math.max(peak, Math.abs(normalized));
    }

    const frameSampleCount = Math.max(1, endIndex - startIndex);
    const rms = Math.sqrt(squareSum / frameSampleCount);
    const zeroCrossingRate = computeZeroCrossingRate(samples, startIndex, endIndex);
    const startSec = startIndex / sampleRate;
    const endSec = endIndex / sampleRate;

    energyTimeline.push({
      startSec: roundTo(startSec, 3),
      endSec: roundTo(endSec, 3),
      rms: roundTo(rms, 4),
      zeroCrossingRate: roundTo(zeroCrossingRate, 4),
    });

    rmsTotal += rms;
    zeroCrossingTotal += zeroCrossingRate;
    peakRmsEnergy = Math.max(peakRmsEnergy, peak);
  }

  const avgRmsEnergy = energyTimeline.length > 0 ? rmsTotal / energyTimeline.length : 0;
  const avgZeroCrossingRate =
    energyTimeline.length > 0 ? zeroCrossingTotal / energyTimeline.length : 0;
  const silenceThreshold = Math.max(0.015, avgRmsEnergy * 0.35);
  const silenceRegions = buildSilenceRegions(energyTimeline, silenceThreshold);
  const transitionSignals = buildAudioTransitionSignals(energyTimeline, silenceThreshold);
  const transcriptCoverage = calculateTranscriptCoverage(
    transcript,
    energyTimeline.length > 0 ? energyTimeline[energyTimeline.length - 1].endSec : 0
  );
  const activeEnergyRatio =
    energyTimeline.length > 0
      ? energyTimeline.filter((entry) => entry.rms > silenceThreshold * 1.3).length /
      energyTimeline.length
      : 0;
  const pauseDensity =
    energyTimeline.length > 0
      ? Math.min(1, silenceRegions.length / Math.max(1, energyTimeline.length / 4))
      : 0;
  const rmsVariance =
    energyTimeline.length > 0
      ? energyTimeline.reduce((sum, entry) => sum + (entry.rms - avgRmsEnergy) ** 2, 0) /
      energyTimeline.length
      : 0;
  const zeroCrossingVariance =
    energyTimeline.length > 0
      ? energyTimeline.reduce(
        (sum, entry) => sum + (entry.zeroCrossingRate - avgZeroCrossingRate) ** 2,
        0
      ) / energyTimeline.length
      : 0;
  const speechLikelihoodScore = Math.max(
    0,
    Math.min(
      1,
      pauseDensity * 0.45 +
      Math.min(1, Math.sqrt(rmsVariance) / 0.04) * 0.25 +
      Math.min(1, Math.sqrt(zeroCrossingVariance) / 0.06) * 0.2 +
      (1 - activeEnergyRatio) * 0.1
    )
  );
  const musicPresenceConfidence = Math.max(
    0,
    Math.min(
      1,
      activeEnergyRatio * 0.4 +
      (1 - pauseDensity) * 0.25 +
      (1 - transcriptCoverage) * 0.2 +
      (1 - speechLikelihoodScore) * 0.15
    )
  );
  const speechPresentLikely = speechLikelihoodScore >= 0.5;
  const musicPresentLikely = musicPresenceConfidence >= 0.55;
  const dynamicProfile = determineDynamicProfile(avgRmsEnergy, peakRmsEnergy);
  const notes = [
    `Computed ${energyTimeline.length} RMS windows at ${windowDurationSec.toFixed(1)} second resolution.`,
    `Transcript coverage estimate: ${(transcriptCoverage * 100).toFixed(0)}%.`,
    `Heuristic music confidence: ${(musicPresenceConfidence * 100).toFixed(0)}%.`,
    `Audio-only speech likelihood: ${(speechLikelihoodScore * 100).toFixed(0)}%.`,
    `Detected ${transitionSignals.length} notable audio transition signal(s).`,
  ];

  return {
    record: {
      status: "completed",
      audioPresent: true,
      speechPresentLikely,
      musicPresentLikely,
      musicPresenceConfidence: roundTo(musicPresenceConfidence, 4),
      avgRmsEnergy: roundTo(avgRmsEnergy, 4),
      peakRmsEnergy: roundTo(peakRmsEnergy, 4),
      energyTimeline,
      transitionSignals,
      silenceRegions,
      dynamicProfile,
      notes,
      error: null,
    },
    speechLikelihoodScore: roundTo(speechLikelihoodScore, 4),
  };
}

function getTranscriptExcerpt(
  transcript: TranscriptRecord,
  startSec: number,
  endSec: number
) {
  if (transcript.segments.length > 0) {
    const matching = transcript.segments
      .filter((segment) => segment.endSec >= startSec && segment.startSec <= endSec)
      .map((segment) => segment.text)
      .join(" ")
      .trim();

    return matching || null;
  }

  return transcript.text ? transcript.text.slice(0, 400) : null;
}

function buildSynthesisTranscriptContext(transcript: TranscriptRecord) {
  return {
    status: transcript.status,
    language: transcript.language,
    text: transcript.text,
    segments: transcript.segments.map((segment) => ({
      startSec: segment.startSec,
      endSec: segment.endSec,
      text: segment.text,
    })),
    audibleSpeechLikely: transcript.audibleSpeechLikely,
    confidence: transcript.confidence,
    suppressionReason: transcript.suppressionReason,
  };
}

function findTranscriptTimestamp(transcript: TranscriptRecord, pattern: RegExp) {
  for (const segment of transcript.segments) {
    if (pattern.test(segment.text.toLowerCase())) {
      return segment.startSec;
    }
  }

  return null;
}

function buildTranscriptReversalHint(transcript: TranscriptRecord) {
  const normalizedTranscript = transcript.text?.toLowerCase() ?? "";

  if (!normalizedTranscript) {
    return null;
  }

  const refusalCount = normalizedTranscript.match(/\bno\b/g)?.length ?? 0;
  const hasPermissionSetup =
    /(teacher\s+can\s+i|can\s+i)/.test(normalizedTranscript) && refusalCount >= 4;
  const hasCallbackToRefusals =
    /(you\s+said\s+no|once\s+again\s+you\s+said\s+no|but\s+you\s+said\s+no)/.test(
      normalizedTranscript
    );
  const hasLatePermissionAbuse =
    /(thanks\s+for\s+allowing\s+me|swear\s+at\s+principal|yes\s+yes\s+yes)/.test(
      normalizedTranscript
    );

  if (!(hasPermissionSetup && hasCallbackToRefusals && hasLatePermissionAbuse)) {
    return null;
  }

  return {
    timestampSec:
      findTranscriptTimestamp(
        transcript,
        /(thanks\s+for\s+allowing\s+me|swear\s+at\s+principal|yes\s+yes\s+yes)/
      ) ?? 0,
    observation:
      "Dialogue repeatedly sets up permission requests answered with 'no', then explicitly cites those refusals before a late 'yes' enables the final absurd outburst.",
    hypothesis:
      "The skit repeats a strict authority figure's 'no' to every request, then flips that rigidity back on them when the other character cites those refusals as excuses and treats the eventual 'yes' as permission for an absurd punchline.",
  };
}

function buildFrameEvidenceText(frame: FrameAnalysisRecord) {
  return [
    frame.sceneDescription,
    frame.environment,
    frame.cameraFraming,
    frame.emotionalTone,
    frame.facialExpression,
    frame.visibleTextSummary,
    frame.subjects.join(" "),
    frame.objects.join(" "),
    frame.actions.join(" "),
    frame.observedFacts.join(" "),
    frame.inferences.join(" "),
    frame.uncertainties.join(" "),
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ")
    .toLowerCase();
}

function scoreHandFocusedFrame(frame: FrameAnalysisRecord) {
  const text = buildFrameEvidenceText(frame);
  let score = 0;

  if (/(hand|hands|finger|fingers|thumb|thumbs|pinky|little finger|index finger|knuckle|palm|fist)/.test(text)) {
    score += 1;
  }

  if (/(pinky|little finger|index finger|thumb|thumbs|palm|fist|knuckle)/.test(text)) {
    score += 2;
  }

  if (/(wrap|wrapped|wrapping|cover|covered|covering|closed fist|clenched fist|slides? along|sliding along|conceal|concealed|hide|hidden|encase)/.test(text)) {
    score += 3;
  }

  if (/(hand illusion|finger illusion|finger transformation|manual reveal|sleight[- ]of[- ]hand|different finger|changed finger|switch(?:es|ing)? fingers?|substitut(?:e|es|ed|ion)|transforms? into|reveals? an index finger|reveals? a little finger)/.test(text)) {
    score += 4;
  }

  return score;
}

function selectFocusedSequenceFrames(
  frames: SelectedFrameRecord[],
  frameAnalyses: FrameAnalysisRecord[]
) {
  const pairedFrames = frameAnalyses
    .map((analysis, index) => ({
      analysis,
      selectedFrame: frames[index] ?? null,
      score: scoreHandFocusedFrame(analysis),
    }))
    .filter(
      (
        entry
      ): entry is {
        analysis: FrameAnalysisRecord;
        selectedFrame: SelectedFrameRecord;
        score: number;
      } => entry.selectedFrame !== null && entry.score > 0
    );

  if (pairedFrames.length < 3) {
    return [];
  }

  let bestWindow: typeof pairedFrames = [];
  let bestScore = 0;

  for (let startIndex = 0; startIndex < pairedFrames.length; startIndex += 1) {
    const window = [pairedFrames[startIndex]];
    let windowScore = pairedFrames[startIndex].score;

    for (let index = startIndex + 1; index < pairedFrames.length; index += 1) {
      if (
        pairedFrames[index].analysis.timestampSec -
        window[window.length - 1].analysis.timestampSec >
        1.05
      ) {
        break;
      }

      window.push(pairedFrames[index]);
      windowScore += pairedFrames[index].score;

      if (window.length >= 5) {
        break;
      }
    }

    if (window.length >= 3 && windowScore > bestScore) {
      bestWindow = window;
      bestScore = windowScore;
    }
  }

  if (bestWindow.length < 3 || bestScore < 6) {
    return [];
  }

  return bestWindow;
}

async function deriveFocusedSequenceInterpretation(
  filePath: string,
  frames: SelectedFrameRecord[],
  frameAnalyses: FrameAnalysisRecord[],
  mediaMetadata: MediaMetadataRecord,
  durationSec: number,
  analysisDirectory: string,
  transcript: TranscriptRecord,
  ocrSummary: string | null,
  logger: AnalysisLogger,
  commandLogger: (message: string, details?: Record<string, unknown>) => Promise<void>
) {
  const sequenceFrames = selectFocusedSequenceFrames(frames, frameAnalyses);

  if (sequenceFrames.length === 0) {
    return null;
  }

  const lateSequenceFrames = sequenceFrames.slice(-Math.min(sequenceFrames.length, 4));
  const startSec = Math.max(0, lateSequenceFrames[0].analysis.timestampSec - 0.12);
  const endSec = Math.min(
    durationSec,
    lateSequenceFrames[lateSequenceFrames.length - 1].analysis.timestampSec + 0.18
  );
  const denseFrameDirectory = path.join(analysisDirectory, "sequence-focus");
  const denseFrameCount = Math.min(
    8,
    Math.max(5, Math.round((endSec - startSec) / 0.15) + 1)
  );
  const cropWidth = Math.min(
    mediaMetadata.width,
    Math.max(180, Math.round(mediaMetadata.width * 0.8))
  );
  const cropHeight = Math.min(
    mediaMetadata.height,
    Math.max(180, Math.round(mediaMetadata.height * 0.48))
  );
  const cropX = Math.max(0, Math.round((mediaMetadata.width - cropWidth) / 2));
  const cropY = Math.max(
    0,
    Math.min(
      mediaMetadata.height - cropHeight,
      Math.round(mediaMetadata.height * 0.14)
    )
  );
  const cropFilter = `crop=${cropWidth}:${cropHeight}:${cropX}:${cropY},scale=768:-1`;
  const denseFrames: Array<{
    framePath: string;
    timestampSec: number;
    sceneDescription: string;
    actions: string[];
    inferences: string[];
  }> = [];

  try {
    await mkdir(denseFrameDirectory, { recursive: true });

    for (let index = 0; index < denseFrameCount; index += 1) {
      const timestampSec =
        denseFrameCount === 1
          ? startSec
          : clampFrameTimestamp(
            startSec + ((endSec - startSec) * index) / (denseFrameCount - 1),
            durationSec
          );
      const framePath = path.join(
        denseFrameDirectory,
        `sequence-${String(index + 1).padStart(3, "0")}.jpg`
      );
      const nearestFrame = lateSequenceFrames.reduce((bestMatch, candidate) => {
        if (!bestMatch) {
          return candidate;
        }

        return Math.abs(candidate.analysis.timestampSec - timestampSec) <
          Math.abs(bestMatch.analysis.timestampSec - timestampSec)
          ? candidate
          : bestMatch;
      }, lateSequenceFrames[0]);

      await extractStillFrame(filePath, timestampSec, framePath, commandLogger, cropFilter);
      denseFrames.push({
        framePath,
        timestampSec: roundTo(timestampSec, 3),
        sceneDescription: nearestFrame.analysis.sceneDescription,
        actions: nearestFrame.analysis.actions,
        inferences: nearestFrame.analysis.inferences,
      });
    }

    const sequenceAnalysis = await analyzeFrameSequenceWithOpenAI(
      {
        frames: denseFrames,
        transcriptExcerpt: getTranscriptExcerpt(
          transcript,
          Math.max(0, startSec - 0.75),
          endSec + 0.75
        ),
        ocrExcerpt: ocrSummary,
      },
      createCommandLogger(logger)
    );

    if (!sequenceAnalysis.hypothesis || sequenceAnalysis.confidence < 0.55) {
      return null;
    }

    return {
      timestampSec: startSec,
      observation:
        sequenceAnalysis.observationSummary ??
        "A short run of consecutive frames suggests a precise manual reveal rather than generic gesturing.",
      hypothesis: sequenceAnalysis.hypothesis,
    };
  } catch (error) {
    await logger("info", "Focused sequence interpretation skipped after an error.", {
      error: getErrorMessage(error, "Unknown sequence analysis error."),
    });

    return null;
  } finally {
    await rm(denseFrameDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

function inferStoryRoleForScene(
  scene: { startSec: number; endSec: number },
  frameAnalyses: FrameAnalysisRecord[]
): StoryRole {
  const matchingRoles = frameAnalyses
    .filter((frame) => frame.timestampSec >= scene.startSec && frame.timestampSec <= scene.endSec)
    .map((frame) => frame.storyRole);

  if (matchingRoles.length === 0) {
    return "unknown";
  }

  const roleCounts = new Map<StoryRole, number>();

  for (const role of matchingRoles) {
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }

  return [...roleCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "unknown";
}

function buildSearchText(
  analysis: AnalysisRecord,
  transcript: TranscriptRecord,
  ocrSummary: string | null
) {
  return [
    analysis.summary,
    analysis.mainIdea ? `Main idea: ${analysis.mainIdea}` : null,
    analysis.narrativeStructure.hook ? `Hook: ${analysis.narrativeStructure.hook}` : null,
    analysis.contentCategory ? `Category: ${analysis.contentCategory}` : null,
    analysis.probableScript ? `Probable script: ${analysis.probableScript}` : null,
    analysis.techniques.length > 0 ? `Techniques: ${analysis.techniques.join(" | ")}` : null,
    analysis.narrativeCues.length > 0
      ? `Narrative cues:\n${analysis.narrativeCues
        .map(
          (cue) =>
            `- ${cue.timestampSec.toFixed(2)}s [${cue.cueType}] ${cue.observation}${cue.interpretation ? ` => ${cue.interpretation}` : ""}`
        )
        .join("\n")}`
      : null,
    ocrSummary ? `OCR summary: ${ocrSummary}` : null,
    transcript.text ? `Transcript: ${transcript.text.slice(0, 1200)}` : null,
    analysis.visualStyle ? `Visual style: ${analysis.visualStyle}` : null,
    analysis.editingStyle ? `Editing style: ${analysis.editingStyle}` : null,
    analysis.audioRole ? `Audio role: ${analysis.audioRole}` : null,
    analysis.musicRole ? `Music role: ${analysis.musicRole}` : null,
    analysis.onScreenTextRole ? `On-screen text role: ${analysis.onScreenTextRole}` : null,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join("\n");
}

function buildSceneEmbeddingSlices(
  analysis: AnalysisRecord,
  transcript: TranscriptRecord,
  ocrSummary: string | null,
  frameAnalyses: FrameAnalysisRecord[]
) {
  return analysis.sceneBySceneReconstruction.map((scene) => ({
    startSec: scene.startSec,
    endSec: scene.endSec,
    storyRole: inferStoryRoleForScene(scene, frameAnalyses),
    description: scene.description,
    transcriptSlice: getTranscriptExcerpt(transcript, scene.startSec, scene.endSec),
    ocrSlice: ocrSummary,
  }));
}

function computeFinalStatus(
  pipeline: Record<AnalysisPipelineStageKey, PipelineStageRecord>
): VideoAnalysisStatus {
  const hasOptionalFailure = Object.entries(pipeline).some(([stageKey, stage]) => {
    if (stage.status !== "failed") {
      return false;
    }

    return ["audioExtraction", "transcription", "ocr", "audioAnalysis", "embeddings"].includes(
      stageKey
    );
  });

  return hasOptionalFailure ? "partial" : "completed";
}

function serializeSavedDocument(savedDocument: {
  verified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
} & Omit<VideoAnalysisDocumentData, "createdAt" | "updatedAt">) {
  return {
    ...savedDocument,
    verified: savedDocument.verified === true,
    createdAt: savedDocument.createdAt?.toISOString(),
    updatedAt: savedDocument.updatedAt?.toISOString(),
  } satisfies VideoAnalysisDocumentData;
}

async function saveVideoAnalysisDocument(
  document: Omit<VideoAnalysisDocumentData, "createdAt" | "updatedAt">,
  logger: AnalysisLogger
) {
  await logger("info", "Persisting video analysis document.", {
    videoId: document.videoId,
    status: document.status,
  });

  const saved = await VideoAnalysis.findOneAndUpdate(
    { videoId: document.videoId },
    { $set: document },
    {
      upsert: true,
      returnDocument: "after",
      setDefaultsOnInsert: true,
    }
  )
    .lean()
    .exec();

  if (!saved) {
    throw new ApiError(500, "Failed to persist the video analysis document.");
  }

  await logger("success", "Video analysis document persisted.", {
    videoId: document.videoId,
  });

  return serializeSavedDocument(saved as typeof saved & { createdAt: Date; updatedAt: Date });
}

export async function deleteVideoAnalysisArtifacts(videoId: string) {
  await connectToDatabase();
  await rm(getAnalysisDirectory(videoId), { recursive: true, force: true }).catch(() => undefined);
  await VideoAnalysis.deleteOne({ videoId }).exec();
}

export async function processVideo(
  videoId: string,
  filePath: string,
  sourceUrl?: string,
  platform?: string
): Promise<VideoAnalysisDocumentData> {
  await connectToDatabase();

  const logger = createAnalysisLogger(videoId);
  const commandLogger = createCommandLogger(logger);
  const pipeline = createDefaultPipeline();
  const debug: Record<string, unknown> = {};
  let mediaMetadata = createEmptyMediaMetadata();
  let transcript = createEmptyTranscript();
  let transcriptionCandidate: {
    provider: "openai";
    language: string | null;
    text: string | null;
    segments: TranscriptRecord["segments"];
  } | null = null;
  let scenes = createEmptyScenes();
  let frames: SelectedFrameRecord[] = [];
  let ocr = createEmptyOcr();
  let audioHeuristics = createEmptyAudioHeuristics();
  let frameAnalyses: FrameAnalysisRecord[] = [];
  let analysis = createEmptyAnalysis();
  let embeddings = createEmptyEmbeddings();
  let audioSpeechLikelihoodScore = 0.5;
  const analysisDirectory = getAnalysisDirectory(videoId);
  const audioPath = path.join(analysisDirectory, "audio.wav");
  const artifacts = {
    audioPath: null as string | null,
    framePaths: [] as string[],
    tempFiles: [] as string[],
  };

  try {
    await rm(analysisDirectory, { recursive: true, force: true }).catch(() => undefined);
    await mkdir(analysisDirectory, { recursive: true });

    mediaMetadata = await runStage(
      videoId,
      "probe",
      pipeline,
      logger,
      async () => probeVideo(filePath, commandLogger),
      { debugStore: debug }
    );

    if (mediaMetadata.audioPresent) {
      const extractedAudioPath = await runStage(
        videoId,
        "audioExtraction",
        pipeline,
        logger,
        async () => extractAudioTrack(filePath, audioPath, commandLogger),
        {
          allowFailure: true,
          debugStore: debug,
        }
      );

      if (extractedAudioPath) {
        artifacts.audioPath = extractedAudioPath;
      } else {
        transcript = {
          ...transcript,
          status: "skipped",
          error: "Audio extraction failed.",
        };
        audioHeuristics = {
          ...audioHeuristics,
          status: "skipped",
          audioPresent: true,
          error: "Audio extraction failed.",
        };
      }
    } else {
      await markStageSkipped("audioExtraction", pipeline, logger, "Video has no audio stream.");
      transcript = {
        ...transcript,
        status: "skipped",
      };
      audioHeuristics = {
        ...audioHeuristics,
        status: "skipped",
        audioPresent: false,
      };
    }

    if (artifacts.audioPath) {
      const transcriptionResult = await runStage(
        videoId,
        "transcription",
        pipeline,
        logger,
        async () => transcribeAudioWithOpenAI(artifacts.audioPath!, createCommandLogger(logger)),
        {
          allowFailure: true,
          debugStore: debug,
        }
      );

      if (transcriptionResult) {
        transcriptionCandidate = transcriptionResult;
        transcript = {
          status: "completed",
          provider: "openai",
          language: transcriptionResult.language,
          text: transcriptionResult.text,
          rawText: transcriptionResult.text,
          segments: transcriptionResult.segments,
          audibleSpeechLikely: Boolean(transcriptionResult.text?.trim()),
          confidence: null,
          suppressionReason: null,
          error: null,
        };
      } else {
        transcript = {
          ...transcript,
          status: "failed",
          error: pipeline.transcription.error ?? "Transcription failed.",
        };
      }
    } else if (pipeline.transcription.status === "pending") {
      await markStageSkipped(
        "transcription",
        pipeline,
        logger,
        "No extracted audio was available for transcription."
      );
    }

    const sceneDetection = await runStage(
      videoId,
      "sceneDetection",
      pipeline,
      logger,
      async () => detectSceneCandidates(filePath, mediaMetadata.durationSec, analysisDirectory, commandLogger),
      { debugStore: debug }
    );
    scenes = {
      ...scenes,
      status: "completed",
      candidates: sceneDetection.candidates,
      error: null,
    };
    artifacts.tempFiles.push(...sceneDetection.tempFiles);

    const frameSelection = await runStage(
      videoId,
      "frameSelection",
      pipeline,
      logger,
      async () =>
        selectRepresentativeFrames(
          filePath,
          mediaMetadata.durationSec,
          sceneDetection.candidates,
          analysisDirectory,
          commandLogger
        ),
      { debugStore: debug }
    );
    frames = frameSelection.frames;
    artifacts.framePaths = frames.map((frame) => frame.framePath);

    const ocrFrames = await runStage(
      videoId,
      "ocr",
      pipeline,
      logger,
      async () => {
        const output: OcrFrameRecord[] = [];

        for (const frame of frames) {
          const frameOcr = await runOcrOnFrameWithOpenAI(
            {
              framePath: frame.framePath,
              timestampSec: frame.timestampSec,
            },
            createCommandLogger(logger)
          );

          output.push({
            timestampSec: frame.timestampSec,
            framePath: frame.framePath,
            text: frameOcr.text,
            confidence: frameOcr.confidence,
            boxes: frameOcr.boxes,
          });
        }

        return output;
      },
      {
        allowFailure: true,
        debugStore: debug,
      }
    );

    if (ocrFrames) {
      ocr = finalizeOcrRecord(ocrFrames, mediaMetadata.durationSec);
    } else {
      ocr = {
        ...ocr,
        status: "failed",
        error: pipeline.ocr.error ?? "OCR failed.",
      };
    }

    if (artifacts.audioPath) {
      const audioAnalysisResult = await runStage(
        videoId,
        "audioAnalysis",
        pipeline,
        logger,
        async () => analyzeAudioHeuristics(artifacts.audioPath!, transcript),
        {
          allowFailure: true,
          debugStore: debug,
        }
      );

      if (audioAnalysisResult) {
        audioHeuristics = audioAnalysisResult.record;
        audioSpeechLikelihoodScore = audioAnalysisResult.speechLikelihoodScore;
      } else {
        audioHeuristics = {
          ...audioHeuristics,
          status: "failed",
          audioPresent: true,
          error: pipeline.audioAnalysis.error ?? "Audio analysis failed.",
        };
      }
    } else if (pipeline.audioAnalysis.status === "pending") {
      await markStageSkipped(
        "audioAnalysis",
        pipeline,
        logger,
        "No extracted audio was available for heuristics."
      );
    }

    if (transcriptionCandidate) {
      transcript = finalizeTranscriptCandidate(transcriptionCandidate, {
        durationSec: mediaMetadata.durationSec,
        audioSpeechLikelihoodScore,
        audioSpeechPresentLikely:
          audioHeuristics.status === "completed" ? audioHeuristics.speechPresentLikely : true,
      });
    }

    const analyzedFrames = await runStage(
      videoId,
      "frameAnalysis",
      pipeline,
      logger,
      async () => {
        const output: FrameAnalysisRecord[] = [];

        for (const frame of frames) {
          const transcriptExcerpt = getTranscriptExcerpt(
            transcript,
            Math.max(0, frame.timestampSec - 1.5),
            frame.timestampSec + 1.5
          );
          const frameAnalysis = await analyzeFrameWithOpenAI(
            {
              framePath: frame.framePath,
              timestampSec: frame.timestampSec,
              transcriptExcerpt,
              ocrExcerpt: ocr.summaryText,
            },
            createCommandLogger(logger)
          );

          output.push({
            timestampSec: frame.timestampSec,
            ...frameAnalysis,
          });
        }

        return output;
      },
      { debugStore: debug }
    );
    frameAnalyses = analyzedFrames;

    const focusedSequenceInterpretation = await deriveFocusedSequenceInterpretation(
      filePath,
      frames,
      frameAnalyses,
      mediaMetadata,
      mediaMetadata.durationSec,
      analysisDirectory,
      transcript,
      ocr.summaryText,
      logger,
      commandLogger
    );
    const transcriptReversalHint = buildTranscriptReversalHint(transcript);
    const storyHypotheses = [
      ...(focusedSequenceInterpretation?.hypothesis
        ? [focusedSequenceInterpretation.hypothesis]
        : []),
      ...(transcriptReversalHint?.hypothesis ? [transcriptReversalHint.hypothesis] : []),
      ...buildStoryHypotheses(ocr, frameAnalyses, audioHeuristics),
    ].filter(
      (value, index, allValues): value is string =>
        Boolean(value) && allValues.indexOf(value) === index
    );
    const cueTimeline = [
      ...(focusedSequenceInterpretation
        ? [
          {
            timestampSec: focusedSequenceInterpretation.timestampSec,
            cueType: "scene" as const,
            observation: focusedSequenceInterpretation.observation,
            interpretationHint: focusedSequenceInterpretation.hypothesis,
          },
        ]
        : []),
      ...(transcriptReversalHint
        ? [
          {
            timestampSec: transcriptReversalHint.timestampSec,
            cueType: "text" as const,
            observation: transcriptReversalHint.observation,
            interpretationHint: transcriptReversalHint.hypothesis,
          },
        ]
        : []),
      ...buildSynthesisCueTimeline(ocr, frameAnalyses, audioHeuristics),
    ].sort((left, right) => left.timestampSec - right.timestampSec);

    const synthesis = await runStage(
      videoId,
      "finalSynthesis",
      pipeline,
      logger,
      async () =>
        synthesizeVideoWithOpenAI(
          {
            mediaMetadata,
            transcript: buildSynthesisTranscriptContext(transcript),
            ocrSummary: ocr.summaryText,
            storyHypotheses,
            cueTimeline,
            frameAnalyses,
            sceneCandidates: scenes.candidates,
            audioHeuristics,
          },
          createCommandLogger(logger)
        ),
      { debugStore: debug }
    );
    analysis = {
      status: "completed",
      summary: synthesis.summary,
      mainIdea: synthesis.mainIdea,
      language: synthesis.language,
      contentCategory: synthesis.contentCategory,
      narrativeStructure: synthesis.narrativeStructure,
      visualStyle: synthesis.visualStyle,
      editingStyle: synthesis.editingStyle,
      audioRole: synthesis.audioRole,
      musicRole: synthesis.musicRole,
      onScreenTextRole: synthesis.onScreenTextRole,
      probableScript: synthesis.probableScript,
      sceneBySceneReconstruction: synthesis.sceneBySceneReconstruction,
      techniques: synthesis.techniques,
      narrativeCues: synthesis.narrativeCues,
      observedFacts: synthesis.observedFacts,
      inferredElements: synthesis.inferredElements,
      uncertainElements: synthesis.uncertainElements,
      confidence: synthesis.confidence,
      error: null,
    };

    const sceneEmbeddingSlices = buildSceneEmbeddingSlices(
      analysis,
      transcript,
      ocr.summaryText,
      frameAnalyses
    );
    const searchText = buildSearchText(analysis, transcript, ocr.summaryText);
    const sceneEmbeddingTexts = buildSceneEmbeddingTexts(sceneEmbeddingSlices);
    const embeddingResult = await runStage(
      videoId,
      "embeddings",
      pipeline,
      logger,
      async () =>
        generateEmbeddingsWithOpenAI([searchText, ...sceneEmbeddingTexts], createCommandLogger(logger)),
      {
        allowFailure: true,
        debugStore: debug,
      }
    );

    if (embeddingResult) {
      embeddings = {
        status: "completed",
        embeddingProvider: "openai",
        embeddingModel: embeddingResult.model,
        embeddingVersion: "v1",
        embeddingTextVersion: "v1",
        searchText,
        video: embeddingResult.vectors[0] ?? [],
        scenes: sceneEmbeddingSlices.map((scene, index) => ({
          startSec: scene.startSec,
          endSec: scene.endSec,
          storyRole: scene.storyRole,
          vector: embeddingResult.vectors[index + 1] ?? [],
        })),
        error: null,
      };
    } else {
      embeddings = {
        ...embeddings,
        status: "failed",
        searchText,
        error: pipeline.embeddings.error ?? "Embedding generation failed.",
      };
    }

    const finalStatus = computeFinalStatus(pipeline);
    analysis = {
      ...analysis,
      status: finalStatus,
    };

    const savedDocument = await saveVideoAnalysisDocument(
      {
        videoId,
        downloadId: videoId,
        verified: false,
        filePath,
        sourceUrl: sourceUrl ?? null,
        platform: platform ?? null,
        status: finalStatus,
        mediaMetadata,
        artifacts,
        transcript,
        scenes,
        frames,
        ocr,
        audioHeuristics,
        frameAnalyses,
        analysis,
        embeddings,
        pipeline,
        debug: Object.keys(debug).length > 0 ? debug : null,
      },
      logger
    );

    await updateDownloadAnalysisState(videoId, {
      analysisStatus: finalStatus,
      analysisProgressPercent: 100,
      analysisStage: buildAnalysisStageMessage(finalStatus),
      analysisErrorMessage: null,
      analyzed: new Date(),
    });

    await logger(
      finalStatus === "partial" ? "info" : "success",
      finalStatus === "partial"
        ? "Video analysis completed with warnings."
        : "Video analysis completed.",
      {
        status: finalStatus,
      }
    );

    return savedDocument;
  } catch (error) {
    const failureMessage = getErrorMessage(error, "Video analysis failed.");
    analysis = {
      ...analysis,
      status: "failed",
      error: failureMessage,
    };

    await saveVideoAnalysisDocument(
      {
        videoId,
        downloadId: videoId,
        verified: false,
        filePath,
        sourceUrl: sourceUrl ?? null,
        platform: platform ?? null,
        status: "failed",
        mediaMetadata,
        artifacts,
        transcript,
        scenes,
        frames,
        ocr,
        audioHeuristics,
        frameAnalyses,
        analysis,
        embeddings,
        pipeline,
        debug: Object.keys(debug).length > 0 ? debug : null,
      },
      logger
    ).catch(() => undefined);

    await updateDownloadAnalysisState(videoId, {
      analysisStatus: "failed",
      analysisProgressPercent: null,
      analysisStage: buildAnalysisStageMessage("failed"),
      analysisErrorMessage: failureMessage,
      analyzed: null,
    });

    await logger("error", "Video analysis failed.", {
      error: failureMessage,
    });

    throw error;
  }
}

export async function enqueueVideoAnalysis(
  downloadId: string,
  options?: {
    overwrite?: boolean;
  }
): Promise<StartVideoAnalysisResponse> {
  await connectToDatabase();

  if (!Types.ObjectId.isValid(downloadId)) {
    throw new ApiError(400, "Invalid download id.");
  }

  const download = await Download.findById(downloadId).exec();

  if (!download) {
    throw new ApiError(404, "Download record was not found.");
  }

  if (download.status !== "completed" || !download.fileName) {
    throw new ApiError(409, "Only completed downloads can be analyzed.");
  }

  if (
    ACTIVE_ANALYSIS_STATUSES.includes(
      download.analysisStatus as (typeof ACTIVE_ANALYSIS_STATUSES)[number]
    ) ||
    analysisJobRegistry.has(downloadId)
  ) {
    throw new ApiError(409, "Video analysis is already running for this download.");
  }

  const hasSavedAnalysis =
    download.analysisStatus === "completed" ||
    download.analysisStatus === "partial" ||
    Boolean(
      await VideoAnalysis.exists({
        videoId: downloadId,
        status: { $in: ["completed", "partial"] },
      })
    );

  if (hasSavedAnalysis && !options?.overwrite) {
    throw new ApiError(409, "An analysis already exists for this video.", {
      requiresOverwrite: true,
    });
  }

  const filePath = getDownloadFilePath(download.fileName);
  const fileStats = await stat(filePath).catch(() => null);

  if (!fileStats || !fileStats.isFile()) {
    throw new ApiError(404, "Downloaded file was not found in storage.");
  }

  await updateDownloadAnalysisState(downloadId, {
    analysisStatus: "queued",
    analysisProgressPercent: 0,
    analysisStage: buildAnalysisStageMessage("queued"),
    analysisErrorMessage: null,
    analyzed: null,
  });

  await createLogEntry({
    scope: ANALYSIS_SCOPE,
    level: "info",
    message: "Video analysis queued.",
    downloadId,
    details: {
      filePath,
      sourceUrl: download.url,
      platform: download.provider,
    },
  });

  const job = processVideo(downloadId, filePath, download.url, download.provider)
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      analysisJobRegistry.delete(downloadId);
    });

  analysisJobRegistry.set(downloadId, job);

  return {
    message: "Video analysis started.",
  };
}
