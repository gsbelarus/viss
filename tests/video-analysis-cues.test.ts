import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAudioTransitionSignals,
  buildStoryHypotheses,
  buildSynthesisCueTimeline,
} from "../lib/video-analysis/cues";
import type {
  AudioHeuristicsRecord,
  FrameAnalysisRecord,
  OcrRecord,
} from "../lib/video-analysis-shared";

test("audio transition signals capture silence breaks and texture shifts", () => {
  const signals = buildAudioTransitionSignals(
    [
      {
        startSec: 0,
        endSec: 0.5,
        rms: 0.004,
        zeroCrossingRate: 0.02,
      },
      {
        startSec: 0.5,
        endSec: 1,
        rms: 0.061,
        zeroCrossingRate: 0.03,
      },
      {
        startSec: 1.4,
        endSec: 1.9,
        rms: 0.064,
        zeroCrossingRate: 0.16,
      },
      {
        startSec: 2.4,
        endSec: 2.9,
        rms: 0.02,
        zeroCrossingRate: 0.17,
      },
    ],
    0.015
  );

  assert.ok(signals.some((signal) => signal.kind === "silence_break"));
  assert.ok(signals.some((signal) => signal.kind === "texture_change"));
});

test("synthesis cue timeline preserves text, audio, expression, and effect cues in order", () => {
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
      sceneDescription: "A child plays happily.",
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
      sceneDescription: "The child reacts with confused surprise before understanding the situation.",
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

  const cues = buildSynthesisCueTimeline(ocr, frameAnalyses, audioHeuristics);

  assert.ok(cues.some((cue) => cue.cueType === "text" && cue.observation.includes("1 year old")));
  assert.ok(cues.some((cue) => cue.cueType === "audio"));
  assert.ok(cues.some((cue) => cue.cueType === "expression"));
  assert.ok(cues.some((cue) => cue.cueType === "visual_device"));
  assert.ok(
    cues.some(
      (cue) =>
        cue.cueType === "scene" &&
        cue.interpretationHint?.includes("carefree childhood gives way to school life")
    )
  );
  assert.ok(
    cues.some(
      (cue) =>
        cue.cueType === "visual_device" &&
        cue.interpretationHint?.includes("childlike simplicity")
    )
  );
  assert.ok(cues[0].timestampSec <= cues[cues.length - 1].timestampSec);

  const hypotheses = buildStoryHypotheses(ocr, frameAnalyses, audioHeuristics);

  assert.ok(hypotheses.some((hypothesis) => hypothesis.includes("school life begins")));
  assert.ok(hypotheses.some((hypothesis) => hypothesis.includes("pre-school mindset")));
});

test("text escalation cue singles out a labeled finale as the punchline", () => {
  const ocr: OcrRecord = {
    status: "completed",
    detected: true,
    summaryText: "NORMAL TRICK SHOT\nTHIS GUY:",
    frames: [
      {
        timestampSec: 0.4,
        framePath: "frame-001.jpg",
        text: "NORMAL TRICK SHOT:",
        confidence: 0.97,
        boxes: [],
      },
      {
        timestampSec: 40.8,
        framePath: "frame-002.jpg",
        text: "THIS GUY:",
        confidence: 0.94,
        boxes: [],
      },
    ],
    error: null,
  };

  const frameAnalyses: FrameAnalysisRecord[] = [
    {
      timestampSec: 0.4,
      sceneDescription: "Two friends attempt a basic trick shot.",
      subjects: ["two men"],
      objects: ["cans", "ball"],
      actions: ["attempting"],
      environment: "living room",
      cameraFraming: "medium shot",
      emotionalTone: "playful",
      facialExpression: "focused amusement",
      visualDevices: [],
      visibleTextSummary: "NORMAL TRICK SHOT:",
      storyRole: "setup",
      observedFacts: ["Two men attempt a basic trick shot."],
      inferences: ["The montage establishes ordinary examples first."],
      uncertainties: [],
    },
    {
      timestampSec: 49.8,
      sceneDescription: "A man uses a pool cue to send a ball through pipe elbows toward a pocket in a tabletop stunt.",
      subjects: ["man"],
      objects: ["pool cue", "pipe elbows", "ball", "table pocket"],
      actions: ["aiming", "shooting"],
      environment: "tabletop setup",
      cameraFraming: "medium shot",
      emotionalTone: "showy escalation",
      facialExpression: "concentrated anticipation",
      visualDevices: [],
      visibleTextSummary: "THIS GUY:",
      storyRole: "payoff",
      observedFacts: ["The final shot uses a pool cue and pipe obstacles."],
      inferences: ["The ending is deliberately more absurd than the earlier attempts."],
      uncertainties: [],
    },
  ];

  const audioHeuristics: AudioHeuristicsRecord = {
    status: "completed",
    audioPresent: true,
    speechPresentLikely: false,
    musicPresentLikely: true,
    musicPresenceConfidence: 0.72,
    avgRmsEnergy: 0.04,
    peakRmsEnergy: 0.12,
    energyTimeline: [],
    transitionSignals: [],
    silenceRegions: [],
    dynamicProfile: "moderate",
    notes: [],
    error: null,
  };

  const cues = buildSynthesisCueTimeline(ocr, frameAnalyses, audioHeuristics);

  assert.ok(
    cues.some(
      (cue) =>
        cue.observation.includes("THIS GUY:") &&
        cue.interpretationHint?.includes("standout punchline")
    )
  );

  const hypotheses = buildStoryHypotheses(ocr, frameAnalyses, audioHeuristics);

  assert.ok(
    hypotheses.some((hypothesis) => hypothesis.includes("over-engineered billiards-style"))
  );
});
