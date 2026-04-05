import assert from "node:assert/strict";
import test from "node:test";

import type { ScriptGenerationAnalysisSource } from "../lib/scripts";
import type {
  AudioHeuristicsRecord,
  FrameAnalysisRecord,
  OcrRecord,
  TranscriptRecord,
} from "../lib/video-analysis-shared";

async function loadScriptPromptHelpers() {
  process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/viss-test";
  process.env.MONGODB_DB ??= "viss-test";

  return import("../lib/scripts");
}

function buildHumorousSourceAnalysis(): ScriptGenerationAnalysisSource {
  const ocr: OcrRecord = {
    status: "completed",
    detected: true,
    summaryText: "Opening hook text: 1 year old\nDeduplicated on-screen text:\n- 1 year old\n- 5 years old",
    frames: [
      {
        timestampSec: 0.4,
        framePath: "frame-001.jpg",
        text: "1 year old",
        confidence: 0.94,
        boxes: [],
      },
      {
        timestampSec: 4.4,
        framePath: "frame-002.jpg",
        text: "5 years old",
        confidence: 0.96,
        boxes: [],
      },
    ],
    error: null,
  };

  const frameAnalyses: FrameAnalysisRecord[] = [
    {
      timestampSec: 0.4,
      sceneDescription: "A child plays happily in a whimsical play area.",
      subjects: ["child"],
      objects: ["toys"],
      actions: ["playing"],
      environment: "play area",
      cameraFraming: "medium shot",
      emotionalTone: "carefree",
      facialExpression: "smiling delight",
      visualDevices: ["face distortion filter"],
      visibleTextSummary: "1 year old",
      storyRole: "setup",
      observedFacts: ["A child is playing with toys."],
      inferences: ["The video presents a happy early-childhood phase."],
      uncertainties: [],
    },
    {
      timestampSec: 4.6,
      sceneDescription:
        "The child reacts with confused surprise in a classroom before understanding the situation.",
      subjects: ["child"],
      objects: ["school items"],
      actions: ["reacting"],
      environment: "school context",
      cameraFraming: "close-up",
      emotionalTone: "bewildered",
      facialExpression: "confused surprise, then an understanding smile",
      visualDevices: ["face distortion filter"],
      visibleTextSummary: "5 years old",
      storyRole: "reveal",
      observedFacts: ["The child looks confused and then smiles."],
      inferences: ["The moment likely marks a reveal or realization."],
      uncertainties: [],
    },
  ];

  const audioHeuristics: AudioHeuristicsRecord = {
    status: "completed",
    audioPresent: true,
    speechPresentLikely: false,
    musicPresentLikely: true,
    musicPresenceConfidence: 0.71,
    avgRmsEnergy: 0.04,
    peakRmsEnergy: 0.11,
    energyTimeline: [],
    transitionSignals: [
      {
        timestampSec: 4.5,
        kind: "texture_change",
        strength: 0.83,
        detail: "Audio texture changes noticeably, suggesting a tonal or timbral pivot.",
      },
    ],
    silenceRegions: [],
    dynamicProfile: "moderate",
    notes: [],
    error: null,
  };

  const transcript: TranscriptRecord = {
    status: "completed",
    provider: "openai",
    language: "en",
    text: null,
    rawText: null,
    segments: [],
    audibleSpeechLikely: false,
    confidence: 0.82,
    suppressionReason: null,
    error: null,
  };

  return {
    downloadId: "69d1817f6adf4031d13481df",
    videoId: "childhood-school-transition",
    mediaMetadata: {
      durationSec: 5,
      width: 1080,
      height: 1920,
      fps: 30,
      videoCodec: "h264",
      audioPresent: true,
      audioCodec: "aac",
      bitrate: 2000000,
      fileSizeBytes: 1234567,
    },
    transcript,
    ocr,
    audioHeuristics,
    frameAnalyses,
    analysis: {
      summary:
        "The video humorously depicts early childhood as carefree play before abruptly transitioning to school responsibilities.",
      mainIdea:
        "Carefree childhood play ends when school begins at age 5, turning innocence into responsibility with a playful punchline.",
      contentCategory: "humorous short-form comedy",
      narrativeStructure: {
        hook: "Age labels begin in a playful, carefree world.",
        setup: "A sequence of ages 1-4 shows childlike joy and simple fun.",
        development: "The montage repeats the same whimsical logic with escalating labels.",
        twistOrReveal: "Age 5 abruptly shifts the child into a classroom and the joke becomes clear.",
        payoff: "The reveal lands as a comic loss of innocence.",
        cta: null,
      },
      visualStyle: "Bright, playful comedy with whimsical face distortion filters.",
      editingStyle: "Fast montage with a sudden reveal pivot.",
      audioRole: "Music reinforces the playful setup before a reveal accent.",
      musicRole: "A tonal pivot underlines the final joke.",
      onScreenTextRole: "Sequential age labels structure the progression.",
      probableScript:
        "A child enjoys playful ages in sequence until school life arrives and reframes everything as responsibility.",
      sceneBySceneReconstruction: [
        {
          startSec: 0,
          endSec: 4,
          description: "Whimsical play montage with age labels and distortion filters.",
        },
        {
          startSec: 4,
          endSec: 5,
          description: "Abrupt classroom reveal turns the playful pattern into the punchline.",
        },
      ],
      techniques: [
        "sequential labels",
        "face distortion filters",
        "abrupt reveal",
        "carefree-to-responsibility contrast",
      ],
      narrativeCues: [
        {
          timestampSec: 4.5,
          cueType: "scene",
          observation: "The setting shifts from play to classroom.",
          interpretation: "The joke lands through a sudden responsibility reveal.",
        },
      ],
    },
  };
}

test("script generation prompt keeps comedic source mechanics for business briefs", async () => {
  const { buildGenerationSourceContext, buildScriptGenerationPrompt } =
    await loadScriptPromptHelpers();
  const source = buildGenerationSourceContext(buildHumorousSourceAnalysis(), null);

  assert.ok(
    source.storyHypotheses.some((hypothesis) => hypothesis.includes("school life begins"))
  );
  assert.ok(
    source.transferDirectives.some((directive) => directive.includes("humorous"))
  );
  assert.ok(
    source.transferDirectives.some((directive) => directive.includes("visual distortions"))
  );
  assert.ok(
    source.avoidDirectives.some((directive) => directive.includes("straight corporate ad"))
  );

  const prompt = buildScriptGenerationPrompt({
    language: "Russian",
    durationSec: 30,
    name: "AI software development offer",
    content: "A company offers to develop software with AI.",
    sources: [source],
  });

  assert.match(prompt, /style exemplars/i);
  assert.match(prompt, /humorous short-form concept/i);
  assert.match(prompt, /A call to action is optional\./i);
  assert.match(prompt, /visual distortions|face\/body\/environment changes/i);
  assert.match(prompt, /straight corporate ad/i);
});