import type {
  TranscriptRecord,
  TranscriptSegmentRecord,
} from "@/lib/video-analysis-shared";

interface TranscriptCandidate {
  provider: "openai";
  language: string | null;
  text: string | null;
  segments: TranscriptSegmentRecord[];
}

interface TranscriptValidationOptions {
  durationSec: number;
  audioSpeechLikelihoodScore: number;
  audioSpeechPresentLikely: boolean;
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizedText(value: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function countWords(value: string | null) {
  const cleaned = normalizedText(value);

  if (!cleaned) {
    return 0;
  }

  return cleaned.split(/\s+/).filter(Boolean).length;
}

function calculateCoveredDuration(segments: TranscriptSegmentRecord[]) {
  return segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.endSec - segment.startSec),
    0
  );
}

function calculateSpeechDensity(wordCount: number, coveredDuration: number) {
  if (wordCount <= 0 || coveredDuration <= 0) {
    return 0;
  }

  return wordCount / coveredDuration;
}

function calculateCoverage(segments: TranscriptSegmentRecord[], durationSec: number) {
  if (durationSec <= 0 || segments.length === 0) {
    return 0;
  }

  const coveredDuration = calculateCoveredDuration(segments);

  return clampUnit(coveredDuration / durationSec);
}

function calculateEffectiveCoverage(
  text: string | null,
  segments: TranscriptSegmentRecord[],
  durationSec: number
) {
  const rawCoverage = calculateCoverage(segments, durationSec);
  const coveredDuration = calculateCoveredDuration(segments);
  const speechDensity = calculateSpeechDensity(countWords(text), coveredDuration);
  const densityFactor = clampUnit(speechDensity / 1.6);

  return rawCoverage * densityFactor;
}

function scoreSegment(segment: TranscriptSegmentRecord) {
  let score = 1;

  if (typeof segment.noSpeechProb === "number") {
    score *= 1 - clampUnit(segment.noSpeechProb);
  }

  if (typeof segment.avgLogprob === "number") {
    if (segment.avgLogprob <= -1) {
      score *= 0.1;
    } else if (segment.avgLogprob < -0.25) {
      score *= 0.1 + ((segment.avgLogprob + 1) / 0.75) * 0.9;
    }
  }

  if (typeof segment.compressionRatio === "number") {
    if (segment.compressionRatio >= 2.8) {
      score *= 0.4;
    } else if (segment.compressionRatio > 2.2) {
      score *= 1 - (segment.compressionRatio - 2.2) / 0.6 * 0.6;
    }
  }

  return clampUnit(score);
}

export function calculateTranscriptSupportScore(
  text: string | null,
  segments: TranscriptSegmentRecord[],
  durationSec: number
) {
  const cleanedText = normalizedText(text);

  if (!cleanedText) {
    return 0;
  }

  if (segments.length === 0) {
    return clampUnit(Math.min(1, cleanedText.length / 120) * 0.35);
  }

  let weightedSum = 0;
  let weightedDuration = 0;

  for (const segment of segments) {
    const duration = Math.max(0.1, segment.endSec - segment.startSec);
    const score = scoreSegment(segment);
    weightedSum += score * duration;
    weightedDuration += duration;
  }

  const weightedSegmentScore = weightedDuration > 0 ? weightedSum / weightedDuration : 0;
  const coverageScore = calculateEffectiveCoverage(cleanedText, segments, durationSec);
  const textScore = Math.min(1, cleanedText.length / 120);

  return clampUnit(weightedSegmentScore * 0.6 + coverageScore * 0.25 + textScore * 0.15);
}

export function finalizeTranscriptCandidate(
  candidate: TranscriptCandidate,
  options: TranscriptValidationOptions
): TranscriptRecord {
  const rawText = normalizedText(candidate.text);
  const rawSegments = candidate.segments.filter((segment) => normalizedText(segment.text));
  const rawWordCount = countWords(rawText);
  const coveredDuration = calculateCoveredDuration(rawSegments);
  const coverage = calculateCoverage(rawSegments, options.durationSec);
  const effectiveCoverage = calculateEffectiveCoverage(
    rawText,
    rawSegments,
    options.durationSec
  );
  const speechDensity = calculateSpeechDensity(rawWordCount, coveredDuration);
  const longestSegmentDuration = rawSegments.reduce(
    (maxDuration, segment) => Math.max(maxDuration, Math.max(0, segment.endSec - segment.startSec)),
    0
  );
  const dominantSegmentShare =
    coveredDuration > 0 ? clampUnit(longestSegmentDuration / coveredDuration) : 0;
  const supportScore = calculateTranscriptSupportScore(
    rawText,
    rawSegments,
    options.durationSec
  );
  const silentLikeRatio =
    rawSegments.length > 0
      ? rawSegments.filter(
        (segment) =>
          (typeof segment.noSpeechProb === "number" && segment.noSpeechProb >= 0.65) ||
          (typeof segment.avgLogprob === "number" && segment.avgLogprob <= -0.8)
      ).length / rawSegments.length
      : 0;
  const sparseShortTranscript = rawWordCount <= 24 && effectiveCoverage < 0.3;
  const longLowDensityPhrase =
    rawWordCount > 0 &&
    rawWordCount <= 6 &&
    coverage >= 0.45 &&
    speechDensity < 1 &&
    dominantSegmentShare >= 0.7;
  const suppressBecauseNoSpeechSignals =
    rawText !== null &&
    !options.audioSpeechPresentLikely &&
    options.audioSpeechLikelihoodScore < 0.48 &&
    supportScore < 0.52 &&
    sparseShortTranscript;
  const suppressBecauseModelSignals =
    rawText !== null && silentLikeRatio >= 0.6 && supportScore < 0.45 && sparseShortTranscript;
  const suppressBecauseSparseCoverage =
    rawText !== null &&
    longLowDensityPhrase &&
    supportScore < 0.25;
  const shouldSuppress =
    suppressBecauseNoSpeechSignals ||
    suppressBecauseModelSignals ||
    suppressBecauseSparseCoverage;

  return {
    status: shouldSuppress ? "skipped" : rawText ? "completed" : "skipped",
    provider: candidate.provider,
    language: candidate.language,
    text: shouldSuppress ? null : rawText,
    rawText,
    segments: shouldSuppress ? [] : rawSegments,
    audibleSpeechLikely: Boolean(rawText) && !shouldSuppress,
    confidence: rawText ? supportScore : null,
    suppressionReason: shouldSuppress
      ? "Transcription was suppressed because the audio and no-speech signals did not support audible dialogue."
      : null,
    error: null,
  };
}