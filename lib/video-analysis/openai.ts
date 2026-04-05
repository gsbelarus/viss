import { createReadStream, readFileSync } from "node:fs";

import OpenAI from "openai";

import { ApiError, isRecord } from "@/lib/api-utils";
import type {
  AnalysisRecord,
  AudioHeuristicsRecord,
  ConfidenceRecord,
  FrameAnalysisRecord,
  MediaMetadataRecord,
  OcrFrameRecord,
  SceneCandidateRecord,
  SceneReconstructionRecord,
  StoryRole,
  TranscriptRecord,
  TranscriptSegmentRecord,
} from "@/lib/video-analysis-shared";

type OpenAILogger = (
  message: string,
  details?: Record<string, unknown>
) => Promise<void> | void;

interface StructuredRequestOptions<T> {
  model: string;
  schemaName: string;
  schema: Record<string, unknown>;
  instructions: string;
  buildInput: (repairText: string | null) => string | OpenAI.Responses.ResponseInput;
  validate: (rawText: string) => T;
  logger?: OpenAILogger;
  requestLabel: string;
}

interface FrameAnalysisInput {
  framePath: string;
  timestampSec: number;
  transcriptExcerpt: string | null;
  ocrExcerpt: string | null;
}

interface FrameSequenceInput {
  frames: Array<{
    framePath: string;
    timestampSec: number;
    sceneDescription: string;
    actions: string[];
    inferences: string[];
  }>;
  transcriptExcerpt: string | null;
  ocrExcerpt: string | null;
}

interface OcrInput {
  framePath: string;
  timestampSec: number;
}

interface OcrFramePayload {
  detected: boolean;
  text: string | null;
  confidence: number | null;
  boxes: OcrFrameRecord["boxes"];
}

interface FrameSequencePayload {
  observationSummary: string | null;
  hypothesis: string | null;
  confidence: number;
}

interface SceneSliceInput {
  startSec: number;
  endSec: number;
  storyRole: StoryRole;
  description: string;
  transcriptSlice: string | null;
  ocrSlice: string | null;
}

interface FinalSynthesisInput {
  mediaMetadata: MediaMetadataRecord;
  transcript: {
    status: TranscriptRecord["status"];
    language: string | null;
    text: string | null;
    segments: Array<{
      startSec: number;
      endSec: number;
      text: string;
    }>;
    audibleSpeechLikely: boolean;
    confidence: number | null;
    suppressionReason: string | null;
  };
  ocrSummary: string | null;
  storyHypotheses: string[];
  cueTimeline: Array<{
    timestampSec: number;
    cueType: "audio" | "expression" | "visual_device" | "text" | "scene";
    observation: string;
    interpretationHint?: string | null;
  }>;
  frameAnalyses: FrameAnalysisRecord[];
  sceneCandidates: SceneCandidateRecord[];
  audioHeuristics: AudioHeuristicsRecord;
}

interface FinalSynthesisPayload {
  summary: string | null;
  mainIdea: string | null;
  language: string | null;
  contentCategory: string | null;
  narrativeStructure: AnalysisRecord["narrativeStructure"];
  visualStyle: string | null;
  editingStyle: string | null;
  audioRole: string | null;
  musicRole: string | null;
  onScreenTextRole: string | null;
  probableScript: string | null;
  sceneBySceneReconstruction: SceneReconstructionRecord[];
  techniques: string[];
  narrativeCues: AnalysisRecord["narrativeCues"];
  observedFacts: string[];
  inferredElements: string[];
  uncertainElements: string[];
  confidence: ConfidenceRecord;
}

const DEFAULT_TRANSCRIPTION_MODEL =
  process.env.VISS_OPENAI_TRANSCRIPTION_MODEL || "whisper-1";
const DEFAULT_FRAME_ANALYSIS_MODEL =
  process.env.VISS_OPENAI_VISION_MODEL || "gpt-4.1-mini";
const DEFAULT_OCR_MODEL =
  process.env.VISS_OPENAI_OCR_MODEL ||
  process.env.VISS_OPENAI_VISION_MODEL ||
  "gpt-4.1-mini";
const DEFAULT_SYNTHESIS_MODEL =
  process.env.VISS_OPENAI_SYNTHESIS_MODEL || "gpt-4.1";
const DEFAULT_EMBEDDING_MODEL =
  process.env.VISS_OPENAI_EMBEDDING_MODEL || "text-embedding-3-large";

const FRAME_ANALYSIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "sceneDescription",
    "subjects",
    "objects",
    "actions",
    "environment",
    "cameraFraming",
    "emotionalTone",
    "facialExpression",
    "visualDevices",
    "visibleTextSummary",
    "storyRole",
    "observedFacts",
    "inferences",
    "uncertainties",
  ],
  properties: {
    sceneDescription: { type: "string" },
    subjects: {
      type: "array",
      items: { type: "string" },
    },
    objects: {
      type: "array",
      items: { type: "string" },
    },
    actions: {
      type: "array",
      items: { type: "string" },
    },
    environment: { type: ["string", "null"] },
    cameraFraming: { type: ["string", "null"] },
    emotionalTone: { type: ["string", "null"] },
    facialExpression: { type: ["string", "null"] },
    visualDevices: {
      type: "array",
      items: { type: "string" },
    },
    visibleTextSummary: { type: ["string", "null"] },
    storyRole: {
      type: "string",
      enum: ["hook", "setup", "development", "reveal", "payoff", "cta", "unknown"],
    },
    observedFacts: {
      type: "array",
      items: { type: "string" },
    },
    inferences: {
      type: "array",
      items: { type: "string" },
    },
    uncertainties: {
      type: "array",
      items: { type: "string" },
    },
  },
} as const;

const OCR_FRAME_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["detected", "text", "confidence", "boxes"],
  properties: {
    detected: { type: "boolean" },
    text: { type: ["string", "null"] },
    confidence: { type: ["number", "null"] },
    boxes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "x", "y", "width", "height"],
        properties: {
          text: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
        },
      },
    },
  },
} as const;

const FRAME_SEQUENCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["observationSummary", "hypothesis", "confidence"],
  properties: {
    observationSummary: { type: ["string", "null"] },
    hypothesis: { type: ["string", "null"] },
    confidence: { type: "number" },
  },
} as const;

const FINAL_SYNTHESIS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "mainIdea",
    "language",
    "contentCategory",
    "narrativeStructure",
    "visualStyle",
    "editingStyle",
    "audioRole",
    "musicRole",
    "onScreenTextRole",
    "probableScript",
    "sceneBySceneReconstruction",
    "techniques",
    "narrativeCues",
    "observedFacts",
    "inferredElements",
    "uncertainElements",
    "confidence",
  ],
  properties: {
    summary: { type: ["string", "null"] },
    mainIdea: { type: ["string", "null"] },
    language: { type: ["string", "null"] },
    contentCategory: { type: ["string", "null"] },
    narrativeStructure: {
      type: "object",
      additionalProperties: false,
      required: ["hook", "setup", "development", "twistOrReveal", "payoff", "cta"],
      properties: {
        hook: { type: ["string", "null"] },
        setup: { type: ["string", "null"] },
        development: { type: ["string", "null"] },
        twistOrReveal: { type: ["string", "null"] },
        payoff: { type: ["string", "null"] },
        cta: { type: ["string", "null"] },
      },
    },
    visualStyle: { type: ["string", "null"] },
    editingStyle: { type: ["string", "null"] },
    audioRole: { type: ["string", "null"] },
    musicRole: { type: ["string", "null"] },
    onScreenTextRole: { type: ["string", "null"] },
    probableScript: { type: ["string", "null"] },
    sceneBySceneReconstruction: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["startSec", "endSec", "description"],
        properties: {
          startSec: { type: "number" },
          endSec: { type: "number" },
          description: { type: "string" },
        },
      },
    },
    techniques: {
      type: "array",
      items: { type: "string" },
    },
    narrativeCues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["timestampSec", "cueType", "observation", "interpretation"],
        properties: {
          timestampSec: { type: "number" },
          cueType: {
            type: "string",
            enum: ["audio", "expression", "visual_device", "text", "scene"],
          },
          observation: { type: "string" },
          interpretation: { type: ["string", "null"] },
        },
      },
    },
    observedFacts: {
      type: "array",
      items: { type: "string" },
    },
    inferredElements: {
      type: "array",
      items: { type: "string" },
    },
    uncertainElements: {
      type: "array",
      items: { type: "string" },
    },
    confidence: {
      type: "object",
      additionalProperties: false,
      required: [
        "overall",
        "transcriptConfidence",
        "visualConfidence",
        "scenarioConfidence",
      ],
      properties: {
        overall: { type: "number" },
        transcriptConfidence: { type: "number" },
        visualConfidence: { type: "number" },
        scenarioConfidence: { type: "number" },
      },
    },
  },
} as const;

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

function parseJsonObject(rawText: string) {
  const value = JSON.parse(rawText) as unknown;

  if (!isRecord(value)) {
    throw new Error("The model returned a non-object JSON payload.");
  }

  return value;
}

function asString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value.trim();
}

function asNullableString(value: unknown, label: string) {
  if (value === null) {
    return null;
  }

  return asString(value, label);
}

function asBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
}

function asStringArray(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((item, index) => asString(item, `${label}[${index}]`));
}

function asNumber(value: unknown, label: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}

function asNullableNumber(value: unknown, label: string) {
  if (value === null) {
    return null;
  }

  return asNumber(value, label);
}

function asStoryRole(value: unknown, label: string): StoryRole {
  const storyRole = asString(value, label) as StoryRole;

  if (![
    "hook",
    "setup",
    "development",
    "reveal",
    "payoff",
    "cta",
    "unknown",
  ].includes(storyRole)) {
    throw new Error(`${label} must be a supported story role.`);
  }

  return storyRole;
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clampUnitInterval(value: number) {
  return Math.max(0, Math.min(1, value));
}

function normalizeMultilineText(value: string | null) {
  if (value === null) {
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

function parseFrameAnalysis(rawText: string) {
  const value = parseJsonObject(rawText);

  return {
    sceneDescription: asString(value.sceneDescription, "sceneDescription"),
    subjects: asStringArray(value.subjects, "subjects"),
    objects: asStringArray(value.objects, "objects"),
    actions: asStringArray(value.actions, "actions"),
    environment: asNullableString(value.environment, "environment"),
    cameraFraming: asNullableString(value.cameraFraming, "cameraFraming"),
    emotionalTone: asNullableString(value.emotionalTone, "emotionalTone"),
    facialExpression: asNullableString(value.facialExpression, "facialExpression"),
    visualDevices: asStringArray(value.visualDevices, "visualDevices"),
    visibleTextSummary: asNullableString(value.visibleTextSummary, "visibleTextSummary"),
    storyRole: asStoryRole(value.storyRole, "storyRole"),
    observedFacts: asStringArray(value.observedFacts, "observedFacts"),
    inferences: asStringArray(value.inferences, "inferences"),
    uncertainties: asStringArray(value.uncertainties, "uncertainties"),
  };
}

function parseNarrativeCues(value: unknown, label: string): AnalysisRecord["narrativeCues"] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`${label}[${index}] must be an object.`);
    }

    const cueType = asString(entry.cueType, `${label}[${index}].cueType`) as AnalysisRecord["narrativeCues"][number]["cueType"];

    if (!["audio", "expression", "visual_device", "text", "scene"].includes(cueType)) {
      throw new Error(`${label}[${index}].cueType must be supported.`);
    }

    return {
      timestampSec: asNumber(entry.timestampSec, `${label}[${index}].timestampSec`),
      cueType,
      observation: asString(entry.observation, `${label}[${index}].observation`),
      interpretation: asNullableString(entry.interpretation, `${label}[${index}].interpretation`),
    };
  });
}

function parseOcrBoxes(value: unknown, label: string): OcrFrameRecord["boxes"] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  const boxes: OcrFrameRecord["boxes"] = [];

  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      throw new Error(`${label}[${index}] must be an object.`);
    }

    const text = normalizeMultilineText(asString(entry.text, `${label}[${index}].text`));

    if (!text) {
      continue;
    }

    boxes.push({
      text,
      x: clampUnitInterval(asNumber(entry.x, `${label}[${index}].x`)),
      y: clampUnitInterval(asNumber(entry.y, `${label}[${index}].y`)),
      width: clampUnitInterval(asNumber(entry.width, `${label}[${index}].width`)),
      height: clampUnitInterval(asNumber(entry.height, `${label}[${index}].height`)),
    });
  }

  return boxes;
}

function parseOcrFrame(rawText: string): OcrFramePayload {
  const value = parseJsonObject(rawText);
  const text = normalizeMultilineText(asNullableString(value.text, "text"));
  const detected = asBoolean(value.detected, "detected") && Boolean(text);
  const confidence = asNullableNumber(value.confidence, "confidence");

  return {
    detected,
    text: detected ? text : null,
    confidence: detected && confidence !== null ? clampConfidence(confidence) : null,
    boxes: detected ? parseOcrBoxes(value.boxes, "boxes") : [],
  };
}

function parseFrameSequence(rawText: string): FrameSequencePayload {
  const value = parseJsonObject(rawText);

  return {
    observationSummary: asNullableString(value.observationSummary, "observationSummary"),
    hypothesis: asNullableString(value.hypothesis, "hypothesis"),
    confidence: clampConfidence(asNumber(value.confidence, "confidence")),
  };
}

function parseSceneReconstruction(value: unknown, label: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`${label}[${index}] must be an object.`);
    }

    return {
      startSec: asNumber(entry.startSec, `${label}[${index}].startSec`),
      endSec: asNumber(entry.endSec, `${label}[${index}].endSec`),
      description: asString(entry.description, `${label}[${index}].description`),
    };
  });
}

function parseFinalSynthesis(rawText: string): FinalSynthesisPayload {
  const value = parseJsonObject(rawText);

  if (!isRecord(value.narrativeStructure)) {
    throw new Error("narrativeStructure must be an object.");
  }

  if (!isRecord(value.confidence)) {
    throw new Error("confidence must be an object.");
  }

  return {
    summary: asNullableString(value.summary, "summary"),
    mainIdea: asNullableString(value.mainIdea, "mainIdea"),
    language: asNullableString(value.language, "language"),
    contentCategory: asNullableString(value.contentCategory, "contentCategory"),
    narrativeStructure: {
      hook: asNullableString(value.narrativeStructure.hook, "narrativeStructure.hook"),
      setup: asNullableString(value.narrativeStructure.setup, "narrativeStructure.setup"),
      development: asNullableString(
        value.narrativeStructure.development,
        "narrativeStructure.development"
      ),
      twistOrReveal: asNullableString(
        value.narrativeStructure.twistOrReveal,
        "narrativeStructure.twistOrReveal"
      ),
      payoff: asNullableString(value.narrativeStructure.payoff, "narrativeStructure.payoff"),
      cta: asNullableString(value.narrativeStructure.cta, "narrativeStructure.cta"),
    },
    visualStyle: asNullableString(value.visualStyle, "visualStyle"),
    editingStyle: asNullableString(value.editingStyle, "editingStyle"),
    audioRole: asNullableString(value.audioRole, "audioRole"),
    musicRole: asNullableString(value.musicRole, "musicRole"),
    onScreenTextRole: asNullableString(value.onScreenTextRole, "onScreenTextRole"),
    probableScript: asNullableString(value.probableScript, "probableScript"),
    sceneBySceneReconstruction: parseSceneReconstruction(
      value.sceneBySceneReconstruction,
      "sceneBySceneReconstruction"
    ),
    techniques: asStringArray(value.techniques, "techniques"),
    narrativeCues: parseNarrativeCues(value.narrativeCues, "narrativeCues"),
    observedFacts: asStringArray(value.observedFacts, "observedFacts"),
    inferredElements: asStringArray(value.inferredElements, "inferredElements"),
    uncertainElements: asStringArray(value.uncertainElements, "uncertainElements"),
    confidence: {
      overall: clampConfidence(asNumber(value.confidence.overall, "confidence.overall")),
      transcriptConfidence: clampConfidence(
        asNumber(value.confidence.transcriptConfidence, "confidence.transcriptConfidence")
      ),
      visualConfidence: clampConfidence(
        asNumber(value.confidence.visualConfidence, "confidence.visualConfidence")
      ),
      scenarioConfidence: clampConfidence(
        asNumber(value.confidence.scenarioConfidence, "confidence.scenarioConfidence")
      ),
    },
  };
}

async function requestStructuredJson<T>({
  model,
  schemaName,
  schema,
  instructions,
  buildInput,
  validate,
  logger,
  requestLabel,
}: StructuredRequestOptions<T>) {
  const client = getOpenAIClient();
  let previousOutput: string | null = null;
  let lastValidationError: string | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await logger?.("OpenAI structured request started.", {
      requestLabel,
      attempt,
      model,
    });

    const response: { output_text: string } = await client.responses.create({
      model,
      instructions:
        attempt === 1
          ? instructions
          : `${instructions}\n\nThe previous attempt failed JSON validation. Repair it and return valid JSON only.`,
      input: buildInput(previousOutput),
      text: {
        format: {
          type: "json_schema",
          name: schemaName,
          strict: true,
          schema,
        },
      },
    });
    const rawText = response.output_text.trim();

    try {
      const validated = validate(rawText);

      await logger?.("OpenAI structured request completed.", {
        requestLabel,
        attempt,
        model,
      });

      return validated;
    } catch (error) {
      previousOutput = rawText;
      lastValidationError = error instanceof Error ? error.message : "Unknown validation error.";

      await logger?.("OpenAI structured request returned invalid JSON.", {
        requestLabel,
        attempt,
        model,
        error: lastValidationError,
      });
    }
  }

  throw new ApiError(
    502,
    `OpenAI returned invalid structured output for ${requestLabel}.`,
    {
      rawOutput: previousOutput,
      validationError: lastValidationError,
    }
  );
}

function frameToDataUrl(framePath: string) {
  const imageBuffer = readFileSync(framePath);
  return `data:image/jpeg;base64,${imageBuffer.toString("base64")}`;
}

export async function transcribeAudioWithOpenAI(
  audioPath: string,
  logger?: OpenAILogger
) {
  const client = getOpenAIClient();

  await logger?.("OpenAI transcription request started.", {
    model: DEFAULT_TRANSCRIPTION_MODEL,
    audioPath,
  });

  const transcription = await client.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model: DEFAULT_TRANSCRIPTION_MODEL,
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const segments: TranscriptSegmentRecord[] = Array.isArray(transcription.segments)
    ? transcription.segments.map((segment) => ({
      startSec: typeof segment.start === "number" ? segment.start : 0,
      endSec: typeof segment.end === "number" ? segment.end : 0,
      text: typeof segment.text === "string" ? segment.text.trim() : "",
      avgLogprob:
        typeof segment.avg_logprob === "number" ? segment.avg_logprob : null,
      compressionRatio:
        typeof segment.compression_ratio === "number" ? segment.compression_ratio : null,
      noSpeechProb:
        typeof segment.no_speech_prob === "number" ? segment.no_speech_prob : null,
    }))
    : [];

  await logger?.("OpenAI transcription request completed.", {
    model: DEFAULT_TRANSCRIPTION_MODEL,
    audioPath,
    segments: segments.length,
  });

  return {
    provider: "openai" as const,
    language: typeof transcription.language === "string" ? transcription.language : null,
    text: typeof transcription.text === "string" ? transcription.text.trim() : null,
    segments,
  };
}

export async function analyzeFrameWithOpenAI(
  input: FrameAnalysisInput,
  logger?: OpenAILogger
): Promise<Omit<FrameAnalysisRecord, "timestampSec">> {
  const dataUrl = frameToDataUrl(input.framePath);

  return requestStructuredJson({
    model: DEFAULT_FRAME_ANALYSIS_MODEL,
    schemaName: "frame_analysis",
    schema: FRAME_ANALYSIS_SCHEMA,
    requestLabel: "frame analysis",
    logger,
    instructions: [
      "You are a multimodal video frame analysis engine.",
      "Analyze the provided frame and return JSON only.",
      "Separate observed facts from inferences.",
      "Do not invent events not visible in the frame.",
      "If a face is visible, capture the dominant reaction beat using face and body language together when needed.",
      "Prefer specific reactions such as puzzled surprise, dawning realization, playful delight, smug satisfaction, boredom, or resignation over vague labels like engaged when the image supports them.",
      "Treat hands, fingers, and object states as first-class evidence when they are foregrounded. If the frame centers on hands, describe the exact finger configuration, which hand is covering or wrapping the other, and any before/after state that could signal a hand trick, illusion, or transformation reveal.",
      "If the image suggests a step-by-step hand trick or sleight-of-hand, say so explicitly in inferences using direct terms such as hand illusion, finger transformation, manual reveal, or sleight-of-hand instead of generic labels like gesture or pose.",
      "Do not flatten precise hand or finger choreography into generic dance moves, posing, or team rivalry just because clothing, music, or staging has a performance vibe.",
      "List deliberate visual devices or stylization cues such as face warp, distortion, exaggeration, filters, or comedic edits when visible. Use an empty array when none are apparent.",
      "If visible text exists, summarize it separately.",
      "Classify the frame's likely story role using one of: hook, setup, development, reveal, payoff, cta, unknown.",
    ].join(" "),
    buildInput: (repairText) => [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `Timestamp: ${input.timestampSec.toFixed(2)} seconds.`,
              input.transcriptExcerpt
                ? `Nearby spoken transcript:\n${input.transcriptExcerpt}`
                : "Nearby spoken transcript: none available.",
              input.ocrExcerpt
                ? `Nearby on-screen text context:\n${input.ocrExcerpt}`
                : "Nearby on-screen text context: none available.",
              repairText ? `Previous invalid JSON output:\n${repairText}` : null,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
          {
            type: "input_image",
            detail: "high",
            image_url: dataUrl,
          },
        ],
      },
    ],
    validate: parseFrameAnalysis,
  });
}

export async function runOcrOnFrameWithOpenAI(
  input: OcrInput,
  logger?: OpenAILogger
): Promise<OcrFramePayload> {
  const dataUrl = frameToDataUrl(input.framePath);

  return requestStructuredJson({
    model: DEFAULT_OCR_MODEL,
    schemaName: "frame_ocr",
    schema: OCR_FRAME_SCHEMA,
    requestLabel: "frame OCR",
    logger,
    instructions: [
      "You are an OCR extraction engine for short-video frames.",
      "Read only visible on-screen text and return JSON only.",
      "Do not describe non-text visual content and do not infer missing words.",
      "Preserve meaningful line breaks in the text field.",
      "If no readable text is present, return detected false, text null, confidence null, and an empty boxes array.",
      "When text regions are clear, provide approximate normalized bounding boxes using x, y, width, and height values between 0 and 1.",
      "If box coordinates are not reasonably inferable, return an empty boxes array instead of guessing.",
      "Confidence must be a number between 0 and 1 when text is detected.",
    ].join(" "),
    buildInput: (repairText) => [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              `Timestamp: ${input.timestampSec.toFixed(2)} seconds.`,
              "Extract only readable text that is visually present in this frame.",
              "Include short overlays, subtitles, captions, buttons, and end-card text when readable.",
              repairText ? `Previous invalid JSON output:\n${repairText}` : null,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
          {
            type: "input_image",
            detail: "high",
            image_url: dataUrl,
          },
        ],
      },
    ],
    validate: parseOcrFrame,
  });
}

export async function analyzeFrameSequenceWithOpenAI(
  input: FrameSequenceInput,
  logger?: OpenAILogger
) {
  return requestStructuredJson({
    model: DEFAULT_FRAME_ANALYSIS_MODEL,
    schemaName: "frame_sequence_analysis",
    schema: FRAME_SEQUENCE_SCHEMA,
    requestLabel: "frame sequence analysis",
    logger,
    instructions: [
      "You are comparing consecutive frames from the same short video.",
      "Analyze the sequence as a progression rather than as unrelated stills.",
      "Focus on exact changes in hands, fingers, fists, palm orientation, coverings, and object state across frames.",
      "If one finger appears to be covered, guided, or replaced so that a different finger seems to appear on reveal, call that out directly even when the exact named fingers are slightly ambiguous.",
      "When a sequence starts with one isolated finger or thumb-based shape and ends with a different finger extension, prefer describing it as one finger seeming to turn into another or a finger-substitution reveal, not merely as a new pose.",
      "If the motion looks like a hand puzzle or visual illusion, hypothesis should explicitly mention the apparent finger change or substitution.",
      "If the sequence shows a deliberate manual trick, finger substitution, sleight-of-hand, or transformation reveal, state that explicitly in hypothesis.",
      "Do not reduce a sequence to clever gestures when the visual progression suggests a before-and-after hand trick or illusion.",
      "If the sequence is only ordinary posing, dancing, or generic gesturing, return hypothesis null.",
      "Do not let clothing theme or background vibe override the actual hand or object progression.",
      "Return JSON only.",
    ].join(" "),
    buildInput: (repairText) => [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "Frames are ordered chronologically.",
              input.frames
                .map(
                  (frame, index) =>
                    `Frame ${index + 1} @ ${frame.timestampSec.toFixed(2)}s\nScene: ${frame.sceneDescription}\nActions: ${frame.actions.join(", ") || "none"}\nInferences so far: ${frame.inferences.join(", ") || "none"}`
                )
                .join("\n\n"),
              input.transcriptExcerpt
                ? `Nearby spoken transcript:\n${input.transcriptExcerpt}`
                : "Nearby spoken transcript: none available.",
              input.ocrExcerpt
                ? `Nearby on-screen text context:\n${input.ocrExcerpt}`
                : "Nearby on-screen text context: none available.",
              repairText ? `Previous invalid JSON output:\n${repairText}` : null,
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
          ...input.frames.map((frame) => ({
            type: "input_image" as const,
            detail: "high" as const,
            image_url: frameToDataUrl(frame.framePath),
          })),
        ],
      },
    ],
    validate: parseFrameSequence,
  });
}

export async function synthesizeVideoWithOpenAI(
  input: FinalSynthesisInput,
  logger?: OpenAILogger
) {
  return requestStructuredJson({
    model: DEFAULT_SYNTHESIS_MODEL,
    schemaName: "video_analysis_summary",
    schema: FINAL_SYNTHESIS_SCHEMA,
    requestLabel: "final synthesis",
    logger,
    instructions: [
      "You are a grounded short-video analysis engine.",
      "You are given transcript of spoken audio, OCR text found on screen, frame-by-frame visual descriptions with timestamps, scene-change timing information, audio heuristics including energy, texture-change, and music-presence estimates, a chronological cue timeline, and basic video metadata.",
      "Your task is to reconstruct the likely scenario, the main idea or punchline, and the reusable creative techniques of the video.",
      "Treat transcript.text as the only reliable spoken-dialogue field. If transcript.text is null, transcript.status is skipped, or transcript.confidence is low, assume there is no dependable audible speech and do not invent spoken words.",
      "If storyHypotheses are present, treat them as high-priority structured summaries derived from repeated evidence. Use the strongest supported hypothesis to drive summary, mainIdea, and twistOrReveal instead of flattening the video into a generic montage.",
      "When a storyHypothesis describes a repeated prank pattern and a final reversal, preserve both halves of that structure explicitly: earlier targets are being tricked, and the singled-out final target counters or flips the trick.",
      "If OCR or frame text shows ordered labels such as ages, years, levels, or before/after states, use them as explicit structure and compare the corresponding settings, reactions, and audio cues.",
      "If repeated early labels frame examples as normal and a later label singles out one beat differently, treat that relabeling as an intentional escalation or punchline.",
      "When repeated labels present other people as reaction-test examples and a later label singles out one person, consider whether the final beat is the exception who reverses or defeats the earlier prank or challenge rather than just another skill demo.",
      "Pay special attention to contrast structures where later beats reinterpret earlier ones, such as before-versus-after, carefree-versus-burdened, innocence-versus-understanding, or setup-versus-payoff.",
      "When consecutive frames focus on hands or fingers and later frames reveal a changed finger or object state after concealment, treat that as the core trick or joke rather than as generic gesturing.",
      "If the visual action is a precise hand or finger illusion, do not flatten it into generic dancing, posing, cheer-team rivalry, or fashion/performance vibes based only on clothing or music.",
      "When a late stage clearly contrasts with earlier leisure/play stages and moves into school, work, responsibility, or another burdened context, favor that contrast as the main reveal instead of flattening the video into a generic montage.",
      "When the evidence supports a transition from carefree play to school, responsibility, or loss of innocence, the mainIdea must explicitly name that transition.",
      "Use timed cue combinations across text, facial expressions, visual devices, and audio transitions to infer the intended meaning when multiple channels align.",
      "If a cue includes an interpretationHint, treat it as a deterministic pattern summary and use it when it matches the rest of the evidence.",
      "When repeated distortion, exaggeration, or stylization appears during one phase of the video, infer its likely narrative function if the surrounding evidence supports that reading instead of leaving it generically uncertain.",
      "The mainIdea field must capture the single clearest premise, joke, or takeaway in one sentence.",
      "The techniques array must list reusable storytelling or editing techniques so similar videos can be found later.",
      "The narrativeCues array must cite the most important timed cues that support your interpretation, with an interpretation for each cue when possible.",
      "The probableScript field should reconstruct the intended beat-by-beat message, not just literal spoken words.",
      "Rules: Return valid JSON only. Distinguish observed facts from inferences. Spoken text and on-screen text are separate channels and must not be merged unless clearly aligned. Audio heuristics are supporting evidence, not certainty. Do not claim certainty where evidence is weak. Prefer concise, structured, production-usable output.",
    ].join(" "),
    buildInput: (repairText) => [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `${JSON.stringify(input, null, 2)}${repairText ? `\n\nPrevious invalid JSON output:\n${repairText}` : ""}`,
          },
        ],
      },
    ],
    validate: parseFinalSynthesis,
  });
}

export async function generateEmbeddingsWithOpenAI(
  texts: string[],
  logger?: OpenAILogger
) {
  if (texts.length === 0) {
    return {
      model: DEFAULT_EMBEDDING_MODEL,
      vectors: [] as number[][],
    };
  }

  const client = getOpenAIClient();

  await logger?.("OpenAI embeddings request started.", {
    model: DEFAULT_EMBEDDING_MODEL,
    count: texts.length,
  });

  const response = await client.embeddings.create({
    model: DEFAULT_EMBEDDING_MODEL,
    input: texts,
  });

  await logger?.("OpenAI embeddings request completed.", {
    model: DEFAULT_EMBEDDING_MODEL,
    count: response.data.length,
  });

  return {
    model: response.model,
    vectors: response.data.map((entry) => entry.embedding),
  };
}

export function buildSceneEmbeddingTexts(scenes: SceneSliceInput[]) {
  return scenes.map((scene) =>
    [
      `Role: ${scene.storyRole}`,
      `Time range: ${scene.startSec.toFixed(2)}-${scene.endSec.toFixed(2)} seconds`,
      `Scene description: ${scene.description}`,
      `Spoken text: ${scene.transcriptSlice || "none"}`,
      `On-screen text: ${scene.ocrSlice || "none"}`,
    ].join("\n")
  );
}