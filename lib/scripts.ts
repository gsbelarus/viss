import { Types } from "mongoose";
import OpenAI from "openai";

import { ApiError, toNonEmptyString } from "@/lib/api-utils";
import { connectToDatabase } from "@/lib/mongodb";
import {
  SCRIPT_LANGUAGE_LABELS,
  type ScriptDetailRecord,
  type ScriptGenerationInput,
  type ScriptListRecord,
  type ScriptMutationInput,
  type ScriptSourceVideoRecord,
} from "@/lib/scripts-shared";
import {
  buildStoryHypotheses,
  buildSynthesisCueTimeline,
} from "@/lib/video-analysis/cues";
import type {
  AnalysisRecord,
  AudioHeuristicsRecord,
  DownloadAnalysisStatus,
  FrameAnalysisRecord,
  MediaMetadataRecord,
  OcrRecord,
  TranscriptRecord,
} from "@/lib/video-analysis-shared";
import { Download, type DownloadReferenceDocument } from "@/models/download";
import { ScriptDraft, type ScriptDraftDocument } from "@/models/script";
import { VideoAnalysis } from "@/models/video-analysis";

type StoredScript = ScriptDraftDocument & {
  _id: Types.ObjectId;
};

export interface ScriptGenerationAnalysisSource {
  downloadId: string | null;
  videoId: string;
  mediaMetadata: MediaMetadataRecord;
  transcript: TranscriptRecord;
  ocr: OcrRecord;
  audioHeuristics: AudioHeuristicsRecord;
  frameAnalyses: FrameAnalysisRecord[];
  analysis: Pick<
    AnalysisRecord,
    | "mainIdea"
    | "summary"
    | "contentCategory"
    | "narrativeStructure"
    | "visualStyle"
    | "editingStyle"
    | "audioRole"
    | "musicRole"
    | "onScreenTextRole"
    | "probableScript"
    | "sceneBySceneReconstruction"
    | "techniques"
    | "narrativeCues"
  >;
}

type StoredVideoAnalysis = ScriptGenerationAnalysisSource;

export interface ScriptGenerationCreativeSignal {
  timestampSec: number;
  cueType: "audio" | "expression" | "visual_device" | "text" | "scene";
  observation: string;
  interpretationHint: string | null;
}

export interface ScriptGenerationSourceContext {
  title: string;
  published: string | null;
  platform: string | null;
  durationSec: number;
  mainIdea: string | null;
  summary: string | null;
  contentCategory: string | null;
  narrativeStructure: AnalysisRecord["narrativeStructure"];
  visualStyle: string | null;
  editingStyle: string | null;
  audioRole: string | null;
  musicRole: string | null;
  onScreenTextRole: string | null;
  techniques: string[];
  storyHypotheses: string[];
  creativeSignals: ScriptGenerationCreativeSignal[];
  transferDirectives: string[];
  avoidDirectives: string[];
  probableScript: string | null;
}

interface ScriptGenerationPromptInput {
  language: string;
  durationSec: number | null;
  name: string;
  content: string;
  sources: ScriptGenerationSourceContext[];
}

interface StoredSourceVideoAnalysisSummary {
  downloadId: string | null;
  videoId: string;
  status: "completed" | "partial" | "failed";
  analysis: Pick<AnalysisRecord, "summary" | "mainIdea">;
  updatedAt: Date;
}

const SCRIPT_GENERATION_MODEL =
  process.env.VISS_OPENAI_SCRIPT_MODEL ||
  process.env.VISS_OPENAI_SYNTHESIS_MODEL ||
  "gpt-4.1";

const HUMOR_PATTERN =
  /\b(humou?r|humou?rous|comedy|comic|funny|playful|whimsical|absurd|parody|satire|joke|gag|meme)\b/i;
const DISTORTION_PATTERN =
  /\b(distort(?:ion)?|warp(?:ed|ing)?|filter|exaggerat(?:e|ed|ion)?|caricature|morph(?:ing)?|transform(?:ation)?|styliz(?:ed|ation)|face[- ]?(?:warp|filter|distortion)|mask)\b/i;
const PROGRESSION_PATTERN =
  /\b(progress(?:ion)?|sequence|staged|montage|escalat(?:e|ion)|phase|label(?:ed|s)?|before[- ]?and[- ]?after|before-versus-after)\b/i;
const REVEAL_PATTERN =
  /\b(reveal|twist|pivot|abrupt(?:ly)?|sudden(?:ly)?|contrast|recontextuali[sz]e|exception|flip|turn|punchline|payoff)\b/i;
const RESPONSIBILITY_PATTERN =
  /\b(carefree|innocence|school|responsibilit(?:y|ies)|burden(?:ed)?|reality check|loss of innocence|adulting|work)\b/i;

let openAIClient: OpenAI | null = null;

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new ApiError(500, "OPENAI_API_KEY is not configured.");
  }

  if (!openAIClient) {
    openAIClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return openAIClient;
}

function isAnalysisReady(status: DownloadAnalysisStatus) {
  return status === "completed" || status === "partial";
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalizedValue = value.trim();

    if (!normalizedValue) {
      continue;
    }

    const key = normalizedValue.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalizedValue);
  }

  return result;
}

function normalizePromptText(value: string | null | undefined) {
  const normalizedValue = value?.trim();

  return normalizedValue ? normalizedValue : null;
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function joinPromptFragments(values: Array<string | null | undefined>) {
  return values
    .map((value) => normalizePromptText(value))
    .filter((value): value is string => value !== null)
    .join(" ");
}

function normalizeScriptId(value: string) {
  const scriptId = toNonEmptyString(value);

  if (!scriptId) {
    throw new ApiError(400, "A script id is required.");
  }

  if (!Types.ObjectId.isValid(scriptId)) {
    throw new ApiError(400, "Invalid script id.");
  }

  return scriptId;
}

function normalizeMutationInput(input: ScriptMutationInput): ScriptMutationInput {
  return {
    name: input.name.trim(),
    basedOnDownloadIds: uniqueStrings(input.basedOnDownloadIds),
    language: input.language,
    durationSec: input.durationSec,
    content: input.content.replace(/\r\n/g, "\n").trim(),
    generatedScript: input.generatedScript?.replace(/\r\n/g, "\n").trim() || null,
  };
}

function buildSourceVideoName(
  download: DownloadReferenceDocument | null,
  fallbackId: string,
  fallbackName = fallbackId
) {
  if (download?.name?.trim()) {
    return download.name.trim();
  }

  if (download?.fileName?.trim()) {
    return download.fileName.trim();
  }

  return fallbackName;
}

function buildSourceVideoDescription(
  analysis:
    | {
      analysis: Pick<AnalysisRecord, "summary" | "mainIdea">;
    }
    | null
) {
  const description =
    normalizePromptText(analysis?.analysis.summary) ??
    normalizePromptText(analysis?.analysis.mainIdea);

  if (!description) {
    return null;
  }

  return truncateText(description, 220);
}

function serializeSourceVideoRecord(
  download: DownloadReferenceDocument | null,
  analysis: {
    videoId: string;
    analysis: Pick<AnalysisRecord, "summary" | "mainIdea">;
    status: "completed" | "partial" | "failed";
  } | null,
  fallbackId: string
): ScriptSourceVideoRecord {
  const analysisStatus = download?.analysisStatus ?? analysis?.status ?? "not_started";

  return {
    id: download?._id.toString() ?? fallbackId,
    name: buildSourceVideoName(download, fallbackId, analysis?.videoId ?? fallbackId),
    description: buildSourceVideoDescription(analysis),
    fileName: download?.fileName ?? null,
    published: download?.published?.toISOString() ?? null,
    analysisStatus,
    analysisReady: isAnalysisReady(analysisStatus),
  };
}

async function loadDownloadMap(downloadIds: string[]) {
  const validDownloadIds = uniqueStrings(downloadIds).filter((downloadId) =>
    Types.ObjectId.isValid(downloadId)
  );

  if (validDownloadIds.length === 0) {
    return new Map<string, DownloadReferenceDocument>();
  }

  const downloads = await Download.find({
    _id: { $in: validDownloadIds.map((downloadId) => new Types.ObjectId(downloadId)) },
  }).exec();

  return new Map(
    downloads.map((download) => [download._id.toString(), download as DownloadReferenceDocument])
  );
}

async function loadAnalysisMap(downloadIds: string[]) {
  if (downloadIds.length === 0) {
    return new Map<string, StoredVideoAnalysis>();
  }

  const analyses = (await VideoAnalysis.find(
    {
      downloadId: { $in: uniqueStrings(downloadIds) },
      status: { $in: ["completed", "partial"] },
    },
    {
      downloadId: 1,
      videoId: 1,
      mediaMetadata: 1,
      transcript: 1,
      ocr: 1,
      audioHeuristics: 1,
      frameAnalyses: 1,
      analysis: 1,
    }
  )
    .lean()
    .exec()) as StoredVideoAnalysis[];

  return new Map(
    analyses
      .filter(
        (analysis): analysis is StoredVideoAnalysis & { downloadId: string } =>
          typeof analysis.downloadId === "string" && analysis.downloadId.length > 0
      )
      .map((analysis) => [analysis.downloadId, analysis])
  );
}

async function loadAnalysisSummaryMap(downloadIds: string[]) {
  const validDownloadIds = uniqueStrings(downloadIds).filter((downloadId) =>
    Types.ObjectId.isValid(downloadId)
  );

  if (validDownloadIds.length === 0) {
    return new Map<string, StoredSourceVideoAnalysisSummary>();
  }

  const analyses = (await VideoAnalysis.find(
    {
      downloadId: { $in: validDownloadIds },
      status: { $in: ["completed", "partial"] },
    },
    {
      downloadId: 1,
      videoId: 1,
      status: 1,
      analysis: 1,
      updatedAt: 1,
    }
  )
    .sort({ updatedAt: -1 })
    .lean()
    .exec()) as StoredSourceVideoAnalysisSummary[];

  const analysisByDownloadId = new Map<string, StoredSourceVideoAnalysisSummary>();

  for (const analysis of analyses) {
    if (typeof analysis.downloadId !== "string" || !analysis.downloadId) {
      continue;
    }

    if (!analysisByDownloadId.has(analysis.downloadId)) {
      analysisByDownloadId.set(analysis.downloadId, analysis);
    }
  }

  return analysisByDownloadId;
}

function serializeScriptListRecord(
  script: StoredScript,
  downloadById: Map<string, DownloadReferenceDocument>
): ScriptListRecord {
  return {
    id: script._id.toString(),
    name: script.name,
    basedOn: script.basedOnDownloadIds.map((downloadId) =>
      serializeSourceVideoRecord(downloadById.get(downloadId) ?? null, null, downloadId)
    ),
    language: script.language,
    durationSec: script.durationSec ?? null,
    createdAt: script.createdAt.toISOString(),
    updatedAt: script.updatedAt.toISOString(),
  };
}

function serializeScriptDetailRecord(
  script: StoredScript,
  downloadById: Map<string, DownloadReferenceDocument>,
  analysisByDownloadId: Map<string, StoredSourceVideoAnalysisSummary>
): ScriptDetailRecord {
  return {
    ...serializeScriptListRecord(script, downloadById),
    basedOn: script.basedOnDownloadIds.map((downloadId) =>
      serializeSourceVideoRecord(
        downloadById.get(downloadId) ?? null,
        analysisByDownloadId.get(downloadId) ?? null,
        downloadId
      )
    ),
    content: script.content,
    generatedScript: script.generatedScript ?? null,
  };
}

function buildSourceTransferProfile(analysis: ScriptGenerationAnalysisSource) {
  const storyHypotheses = buildStoryHypotheses(
    analysis.ocr,
    analysis.frameAnalyses,
    analysis.audioHeuristics
  );
  const creativeSignals = buildSynthesisCueTimeline(
    analysis.ocr,
    analysis.frameAnalyses,
    analysis.audioHeuristics
  )
    .map((cue) => ({
      timestampSec: cue.timestampSec,
      cueType: cue.cueType,
      observation: cue.observation,
      interpretationHint: cue.interpretationHint ?? null,
    }))
    .slice(0, 8);
  const sourceCorpus = joinPromptFragments([
    analysis.analysis.summary,
    analysis.analysis.mainIdea,
    analysis.analysis.contentCategory,
    analysis.analysis.visualStyle,
    analysis.analysis.editingStyle,
    analysis.analysis.audioRole,
    analysis.analysis.musicRole,
    analysis.analysis.onScreenTextRole,
    analysis.analysis.probableScript,
    ...analysis.analysis.techniques,
    ...analysis.analysis.narrativeCues.flatMap((cue) => [
      cue.observation,
      cue.interpretation,
    ]),
    ...storyHypotheses,
    ...creativeSignals.flatMap((cue) => [cue.observation, cue.interpretationHint]),
  ]).toLowerCase();
  const humorLikely = HUMOR_PATTERN.test(sourceCorpus);
  const distortionLikely =
    DISTORTION_PATTERN.test(sourceCorpus) ||
    creativeSignals.some((cue) => cue.cueType === "visual_device");
  const stagedProgressionLikely =
    PROGRESSION_PATTERN.test(sourceCorpus) ||
    Boolean(
      analysis.analysis.narrativeStructure.setup &&
      (analysis.analysis.narrativeStructure.development ||
        analysis.analysis.narrativeStructure.twistOrReveal)
    );
  const lateRevealLikely =
    REVEAL_PATTERN.test(sourceCorpus) ||
    Boolean(
      analysis.analysis.narrativeStructure.twistOrReveal ||
      analysis.analysis.narrativeStructure.payoff
    );
  const innocenceToRealityContrastLikely = RESPONSIBILITY_PATTERN.test(sourceCorpus);
  const transferDirectives: string[] = [];
  const avoidDirectives: string[] = [];

  if (humorLikely) {
    transferDirectives.push(
      "Keep the new concept humorous, playful, and slightly absurd instead of polished, inspirational, or purely sales-driven."
    );
    avoidDirectives.push(
      "Do not flatten the idea into a straight corporate ad, office montage, benefits list, or polished promotional voiceover."
    );
  }

  if (distortionLikely) {
    transferDirectives.push(
      "Use recurring original visual distortions, caricature transformations, or exaggerated face/body/environment changes as storytelling devices, not just decoration."
    );
    avoidDirectives.push(
      "Do not strip out the visual gag system; exaggeration should carry the joke and reveal character logic."
    );
  }

  if (stagedProgressionLikely) {
    transferDirectives.push(
      "Build the video as a staged progression or repeated mini-pattern that escalates before the final turn."
    );
  }

  if (lateRevealLikely) {
    transferDirectives.push(
      "Save the core point for a late reveal, contrast, reversal, or punchline that recontextualizes the earlier beats."
    );
    avoidDirectives.push(
      "Do not explain the message too early or resolve it as a smooth, generic improvement story."
    );
  }

  if (innocenceToRealityContrastLikely) {
    transferDirectives.push(
      "Look for an analogous innocence-to-reality or easy-mode-to-responsibility contrast in the new topic so the final beat lands as a rude awakening or comic truth."
    );
  }

  return {
    storyHypotheses,
    creativeSignals,
    transferDirectives: uniqueStrings(transferDirectives),
    avoidDirectives: uniqueStrings(avoidDirectives),
  };
}

export function buildGenerationSourceContext(
  analysis: StoredVideoAnalysis,
  download: DownloadReferenceDocument | null
): ScriptGenerationSourceContext {
  const transferProfile = buildSourceTransferProfile(analysis);

  return {
    title: buildSourceVideoName(download, analysis.videoId),
    published: download?.published?.toISOString() ?? null,
    platform: download?.provider ?? null,
    durationSec: analysis.mediaMetadata.durationSec,
    mainIdea: analysis.analysis.mainIdea,
    summary: analysis.analysis.summary,
    contentCategory: analysis.analysis.contentCategory,
    narrativeStructure: analysis.analysis.narrativeStructure,
    visualStyle: analysis.analysis.visualStyle,
    editingStyle: analysis.analysis.editingStyle,
    audioRole: analysis.analysis.audioRole,
    musicRole: analysis.analysis.musicRole,
    onScreenTextRole: analysis.analysis.onScreenTextRole,
    techniques: analysis.analysis.techniques.slice(0, 12),
    probableScript: analysis.analysis.probableScript,
    storyHypotheses: transferProfile.storyHypotheses,
    creativeSignals: transferProfile.creativeSignals,
    transferDirectives: transferProfile.transferDirectives,
    avoidDirectives: transferProfile.avoidDirectives,
  };
}

function formatPromptList(items: string[], indent = "") {
  return items.map((item) => `${indent}- ${item}`).join("\n");
}

function formatNarrativeStructure(
  narrativeStructure: ScriptGenerationSourceContext["narrativeStructure"]
) {
  const entries = [
    ["Hook", narrativeStructure.hook],
    ["Setup", narrativeStructure.setup],
    ["Development", narrativeStructure.development],
    ["Reveal", narrativeStructure.twistOrReveal],
    ["Payoff", narrativeStructure.payoff],
    ["CTA", narrativeStructure.cta],
  ].filter((entry): entry is [string, string] => Boolean(normalizePromptText(entry[1])));

  if (entries.length === 0) {
    return null;
  }

  return entries.map(([label, value]) => `  - ${label}: ${value}`).join("\n");
}

function formatCreativeSignal(signal: ScriptGenerationCreativeSignal) {
  const roundedTimestamp = Number(signal.timestampSec.toFixed(1));

  return [
    `  - ${roundedTimestamp}s [${signal.cueType}]: ${signal.observation}`,
    signal.interpretationHint ? `    Meaning: ${signal.interpretationHint}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join("\n");
}

function formatSourcePromptBlock(
  source: ScriptGenerationSourceContext,
  index: number
) {
  const narrativeStructureBlock = formatNarrativeStructure(source.narrativeStructure);
  const sections = [
    `Source ${index + 1}: ${source.title}`,
    `- Duration: ${Number(source.durationSec.toFixed(1))} seconds`,
    source.summary ? `- Summary: ${source.summary}` : null,
    source.mainIdea ? `- Main idea: ${source.mainIdea}` : null,
    source.contentCategory ? `- Category: ${source.contentCategory}` : null,
    source.visualStyle ? `- Visual style: ${source.visualStyle}` : null,
    source.editingStyle ? `- Editing style: ${source.editingStyle}` : null,
    source.transferDirectives.length > 0
      ? `- Transfer priorities:\n${formatPromptList(source.transferDirectives, "  ")}`
      : null,
    source.avoidDirectives.length > 0
      ? `- Avoid:\n${formatPromptList(source.avoidDirectives, "  ")}`
      : null,
    narrativeStructureBlock ? `- Narrative skeleton:\n${narrativeStructureBlock}` : null,
    source.storyHypotheses.length > 0
      ? `- Strongly supported source patterns:\n${formatPromptList(source.storyHypotheses, "  ")}`
      : null,
    source.creativeSignals.length > 0
      ? `- Timed creative signals:\n${source.creativeSignals
        .map((signal) => formatCreativeSignal(signal))
        .join("\n")}`
      : null,
    source.techniques.length > 0
      ? `- Techniques worth reusing: ${source.techniques.join(", ")}`
      : null,
    !source.summary && !source.mainIdea && source.probableScript
      ? `- Probable script clue: ${source.probableScript}`
      : null,
  ];

  return sections.filter((value): value is string => value !== null).join("\n");
}

export function buildScriptGenerationPrompt(input: ScriptGenerationPromptInput) {
  const sourceSection =
    input.sources.length === 0
      ? [
        "Source Creative DNA",
        "- No source analyses were supplied. Rely on the user brief alone.",
      ].join("\n")
      : [
        "Source Creative DNA",
        input.sources.map((source, index) => formatSourcePromptBlock(source, index)).join("\n\n"),
      ].join("\n");

  return [
    "Task",
    "Create an original short-form video script that keeps the user's requested topic while transferring the source video's creative DNA into the new idea.",
    "",
    "Priority Rules",
    "- The source videos are style exemplars, not topic templates. Transfer their storytelling mechanics, pacing, tone, escalation, and visual gag logic into the user's requested topic.",
    "- Before writing, silently identify the source's comic mechanism, visual exaggeration system, and reveal pattern, then adapt those mechanisms to the user's topic.",
    "- Keep the user's topic, offer, or message, but express it through the source video's vibe rather than defaulting to generic advertising language.",
    "- When a source is comedic, absurd, or playful, the result must stay comedic, absurd, or playful unless the user explicitly asks for a serious tone.",
    "- Treat recurring distortions, transformations, stylized filters, labels, progressions, and reveals as reusable storytelling devices. Invent analogous original versions that fit the new topic.",
    "- Do not copy exact scenes, names, dialogue, literal labels, or distinctive copyrighted lines from the source.",
    "- If the brief is business-oriented but the source is playful or comic, write a humorous short-form concept rather than a polished corporate campaign unless the user explicitly asks for a formal ad.",
    "- Do not flatten the idea into a benefits list, office montage, or generic 'before AI / after AI' promo unless that exact format is clearly requested.",
    "- A call to action is optional. Use one only if it fits naturally; otherwise let the final beat or punchline carry the ending.",
    "",
    "Output Requirements",
    "- Return markdown only, with no code fences, no JSON, and no tables.",
    `- Write the entire output in ${input.language}.`,
    input.durationSec !== null
      ? `- Shape the pacing and scene timing around approximately ${input.durationSec} seconds.`
      : "- Shape the pacing for a concise short-form video.",
    "- Keep the result text-only. Describe visuals, sounds, effects, transitions, distortions, and graphics in words.",
    "- Use clear markdown sections covering: core concept, narrative structure, scene plan, dialogue and voiceover, on-screen text and graphics, CTA or final beat, and production notes.",
    "- In the core concept, explain how the user's topic is being expressed through the source video's creative logic rather than as a generic campaign.",
    "- In the scene plan, describe each scene with timing, setting, characters, actions, camera/framing, visual effects or distortions, dialogue or voiceover, and on-screen text.",
    "",
    "Request",
    `- Target language: ${input.language}`,
    `- Target duration: ${input.durationSec !== null ? `${input.durationSec} seconds` : "Not specified"}`,
    `- Working title: ${input.name}`,
    "- User brief:",
    normalizePromptText(input.content) ?? "(No additional brief provided.)",
    "",
    sourceSection,
  ].join("\n");
}

async function requestGeneratedScript(input: {
  language: string;
  durationSec: number | null;
  name: string;
  content: string;
  sources: ScriptGenerationSourceContext[];
}) {
  const client = getOpenAIClient();

  const response: { output_text: string } = await client.responses.create({
    model: SCRIPT_GENERATION_MODEL,
    instructions: [
      "You are a creative short-form video script engine.",
      "Use source analyses as style exemplars and transfer their creative mechanics into the user's requested topic instead of defaulting to generic advertising language.",
      "When the source is humorous, absurd, playful, or stylized, preserve that energy unless the user explicitly asks for a serious tone.",
      "Treat recurring transformations, distortions, progression structures, labels, reversals, and reveal mechanics as reusable storytelling devices. Invent analogous original versions that fit the new concept.",
      "Do not copy exact scenes, names, dialogue, or literal labels from the source.",
      "Produce an original, production-usable script in markdown.",
      "Return markdown only, with no code fences, no JSON, and no tables.",
      "The result must remain text-only. When visuals, effects, sounds, transitions, or other media elements are needed, describe them clearly in text instead of using placeholders for assets.",
      "Do not flatten business or service briefs into benefits lists, polished office montages, or formal campaign copy unless the user explicitly asks for that format.",
      "If the source suggests a late reveal or punchline, preserve that structure in the new concept.",
      "A call to action is optional and should only be included when it fits the concept naturally.",
    ].join(" "),
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: buildScriptGenerationPrompt(input),
          },
        ],
      },
    ],
  });

  const generatedScript = response.output_text.trim();

  if (!generatedScript) {
    throw new ApiError(502, "OpenAI returned an empty generated script.");
  }

  return generatedScript;
}

export async function listScripts() {
  await connectToDatabase();

  const scripts = (await ScriptDraft.find({})
    .sort({ updatedAt: -1 })
    .lean()
    .exec()) as StoredScript[];
  const downloadById = await loadDownloadMap(
    scripts.flatMap((script) => script.basedOnDownloadIds)
  );

  return scripts.map((script) => serializeScriptListRecord(script, downloadById));
}

export async function listScriptSourceVideos() {
  await connectToDatabase();

  const analyses = (await VideoAnalysis.find(
    {
      downloadId: { $nin: [null, ""] },
      status: { $in: ["completed", "partial"] },
    },
    {
      downloadId: 1,
      videoId: 1,
      status: 1,
      analysis: 1,
      updatedAt: 1,
    }
  )
    .sort({ updatedAt: -1 })
    .lean()
    .exec()) as StoredSourceVideoAnalysisSummary[];

  const validAnalyses = analyses.filter(
    (analysis): analysis is StoredSourceVideoAnalysisSummary & { downloadId: string } =>
      typeof analysis.downloadId === "string" && analysis.downloadId.length > 0
  );
  const downloadById = await loadDownloadMap(validAnalyses.map((analysis) => analysis.downloadId));
  const uniqueAnalyses = new Map<string, StoredSourceVideoAnalysisSummary & { downloadId: string }>();

  for (const analysis of validAnalyses) {
    if (!uniqueAnalyses.has(analysis.downloadId)) {
      uniqueAnalyses.set(analysis.downloadId, analysis);
    }
  }

  return [...uniqueAnalyses.values()].map((analysis) =>
    serializeSourceVideoRecord(
      downloadById.get(analysis.downloadId) ?? null,
      analysis,
      analysis.downloadId
    )
  );
}

export async function getScriptDetails(scriptIdValue: string) {
  await connectToDatabase();

  const scriptId = normalizeScriptId(scriptIdValue);
  const script = (await ScriptDraft.findById(scriptId).lean().exec()) as StoredScript | null;

  if (!script) {
    throw new ApiError(404, "Script was not found.");
  }

  const downloadById = await loadDownloadMap(script.basedOnDownloadIds);
  const analysisByDownloadId = await loadAnalysisSummaryMap(script.basedOnDownloadIds);

  return serializeScriptDetailRecord(script, downloadById, analysisByDownloadId);
}

export async function createScript(input: ScriptMutationInput) {
  await connectToDatabase();

  const normalizedInput = normalizeMutationInput(input);
  const script = await ScriptDraft.create(normalizedInput);

  return getScriptDetails(script._id.toString());
}

export async function updateScript(scriptIdValue: string, input: ScriptMutationInput) {
  await connectToDatabase();

  const scriptId = normalizeScriptId(scriptIdValue);
  const script = await ScriptDraft.findById(scriptId).exec();

  if (!script) {
    throw new ApiError(404, "Script was not found.");
  }

  const normalizedInput = normalizeMutationInput(input);

  script.name = normalizedInput.name;
  script.basedOnDownloadIds = normalizedInput.basedOnDownloadIds;
  script.language = normalizedInput.language;
  script.durationSec = normalizedInput.durationSec;
  script.content = normalizedInput.content;
  script.generatedScript = normalizedInput.generatedScript;
  await script.save();

  return getScriptDetails(scriptId);
}

export async function deleteScript(scriptIdValue: string) {
  await connectToDatabase();

  const scriptId = normalizeScriptId(scriptIdValue);
  const deletedScript = await ScriptDraft.findByIdAndDelete(scriptId).exec();

  if (!deletedScript) {
    throw new ApiError(404, "Script was not found.");
  }

  return {
    deletedId: scriptId,
    message: "Script deleted.",
  };
}

export async function generateScriptFromInput(input: ScriptGenerationInput) {
  await connectToDatabase();

  const normalizedInput = normalizeMutationInput({
    ...input,
    generatedScript: null,
  });
  const downloadById = await loadDownloadMap(normalizedInput.basedOnDownloadIds);
  const analysisByDownloadId = await loadAnalysisMap(normalizedInput.basedOnDownloadIds);
  const missingAnalysisIds = normalizedInput.basedOnDownloadIds.filter(
    (downloadId) => !analysisByDownloadId.has(downloadId)
  );

  if (missingAnalysisIds.length > 0) {
    const missingLabels = missingAnalysisIds.map((downloadId) =>
      buildSourceVideoName(downloadById.get(downloadId) ?? null, downloadId)
    );

    throw new ApiError(
      400,
      `Generate script requires saved analysis for the selected videos: ${missingLabels.join(", ")}.`
    );
  }

  const generatedScript = await requestGeneratedScript({
    language: SCRIPT_LANGUAGE_LABELS[normalizedInput.language],
    durationSec: normalizedInput.durationSec,
    name: normalizedInput.name,
    content: normalizedInput.content,
    sources: normalizedInput.basedOnDownloadIds.map((downloadId) =>
      buildGenerationSourceContext(
        analysisByDownloadId.get(downloadId)!,
        downloadById.get(downloadId) ?? null
      )
    ),
  });

  return generatedScript;
}
