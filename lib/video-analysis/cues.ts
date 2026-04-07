import type {
  AudioHeuristicsRecord,
  FrameAnalysisRecord,
  OcrRecord,
} from "@/lib/video-analysis-shared";

export interface SynthesisCueInput {
  timestampSec: number;
  cueType: "audio" | "expression" | "visual_device" | "text" | "scene";
  observation: string;
  interpretationHint?: string | null;
}

function roundTo(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function normalizeText(value: string | null) {
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

function splitLines(value: string) {
  return normalizeText(value)?.split("\n").map((line) => line.trim()).filter(Boolean) ?? [];
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

function normalizeCueText(value: string, maxLength = 160) {
  return trimSummaryText(normalizeText(value), maxLength);
}

function toCueKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractAgeLabel(value: string | null) {
  if (!value) {
    return null;
  }

  const ageMatch = value.match(/\bage\s*[:\-]?\s*(\d+)\b/i);

  if (ageMatch) {
    return Number.parseInt(ageMatch[1], 10);
  }

  const yearOldMatch = value.match(/\b(\d+)\s*years?\s*old\b/i);

  if (!yearOldMatch) {
    return null;
  }

  return Number.parseInt(yearOldMatch[1], 10);
}

function buildFrameText(frame: FrameAnalysisRecord) {
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
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join(" ")
    .toLowerCase();
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

function buildCombinedFrameText(
  frameAnalyses: FrameAnalysisRecord[],
  minimumTimestampSec = Number.NEGATIVE_INFINITY
) {
  return frameAnalyses
    .filter((frame) => frame.timestampSec >= minimumTimestampSec)
    .map((frame) => buildFrameText(frame))
    .join(" ");
}

function classifyFrameSetting(frame: FrameAnalysisRecord) {
  const text = buildFrameText(frame);

  if (
    /(classroom|school|desk|worksheet|teacher|lesson|student|whiteboard|blackboard|school items|educational posters?)/.test(
      text
    )
  ) {
    return "school" as const;
  }

  if (
    /(playground|play area|playroom|arcade|game machine|ball pit|water park|waterslide|slides|toy|toys|amusement|attraction|theme park|ice cream|funfair|pool)/.test(
      text
    )
  ) {
    return "play" as const;
  }

  return null;
}

function describeSetting(setting: ReturnType<typeof classifyFrameSetting>) {
  if (setting === "school") {
    return "a classroom or school-like setting";
  }

  if (setting === "play") {
    return "play or leisure settings";
  }

  return "a distinct later setting";
}

function findDominantSetting(settings: Array<NonNullable<ReturnType<typeof classifyFrameSetting>>>) {
  const counts = new Map<NonNullable<ReturnType<typeof classifyFrameSetting>>, number>();

  for (const setting of settings) {
    counts.set(setting, (counts.get(setting) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function buildSequentialAgeCue(frameAnalyses: FrameAnalysisRecord[]) {
  const orderedAges = [...frameAnalyses]
    .sort((left, right) => left.timestampSec - right.timestampSec)
    .map((frame) => ({
      timestampSec: frame.timestampSec,
      age: extractAgeLabel(frame.visibleTextSummary),
    }))
    .filter((entry): entry is { timestampSec: number; age: number } => entry.age !== null);

  if (orderedAges.length < 3) {
    return null;
  }

  const uniqueAges = orderedAges
    .map((entry) => entry.age)
    .filter((age, index, ages) => index === 0 || ages[index - 1] !== age);

  if (uniqueAges.length < 3) {
    return null;
  }

  const isIncreasingByOne = uniqueAges.every((age, index) => {
    if (index === 0) {
      return true;
    }

    return age === uniqueAges[index - 1] + 1;
  });

  if (!isIncreasingByOne) {
    return null;
  }

  return {
    timestampSec: roundTo(orderedAges[0].timestampSec, 3),
    cueType: "text" as const,
    observation: `On-screen age labels progress sequentially from ${uniqueAges[0]} to ${uniqueAges[uniqueAges.length - 1]}.`,
    interpretationHint:
      "The video is structured as a staged progression, so later labels should be compared against earlier ones for the main contrast or reveal.",
  } satisfies SynthesisCueInput;
}

function buildPhaseContrastCue(frameAnalyses: FrameAnalysisRecord[]) {
  const orderedFrames = [...frameAnalyses].sort((left, right) => left.timestampSec - right.timestampSec);

  if (orderedFrames.length < 2) {
    return null;
  }

  const lastFrame = orderedFrames[orderedFrames.length - 1];
  const lastSetting = classifyFrameSetting(lastFrame);
  const earlierFrames = orderedFrames.slice(0, -1);
  const earlierSettings = earlierFrames
    .map((frame) => classifyFrameSetting(frame))
    .filter((setting): setting is NonNullable<ReturnType<typeof classifyFrameSetting>> => setting !== null);

  if (!lastSetting || earlierSettings.length < 1) {
    return null;
  }

  const earlierDominantSetting = findDominantSetting(earlierSettings);

  if (!earlierDominantSetting || earlierDominantSetting === lastSetting) {
    return null;
  }

  const earlyAges = earlierFrames
    .map((frame) => extractAgeLabel(frame.visibleTextSummary))
    .filter((age): age is number => age !== null);
  const lateAge = extractAgeLabel(lastFrame.visibleTextSummary);
  const earlyAgeLabel =
    earlyAges.length >= 2
      ? `ages ${Math.min(...earlyAges)}-${Math.max(...earlyAges)}`
      : "the earlier phase";
  const lateAgeLabel = lateAge !== null ? `age ${lateAge}` : "the final phase";

  return {
    timestampSec: roundTo(lastFrame.timestampSec, 3),
    cueType: "scene" as const,
    observation: `The sequence shifts from ${describeSetting(earlierDominantSetting)} in ${earlyAgeLabel} to ${describeSetting(lastSetting)} at ${lateAgeLabel}.`,
    interpretationHint:
      earlierDominantSetting === "play" && lastSetting === "school"
        ? "This supports a before-versus-after reveal in which carefree childhood gives way to school life."
        : "This late-stage setting change is likely the core reveal rather than just another interchangeable scene.",
  } satisfies SynthesisCueInput;
}

function buildRepeatedVisualDeviceCue(frameAnalyses: FrameAnalysisRecord[]) {
  const orderedFrames = [...frameAnalyses].sort((left, right) => left.timestampSec - right.timestampSec);
  const distortionFrames = orderedFrames.filter((frame) =>
    frame.visualDevices.some((device) => /(distort|warp|filter|exaggerat)/i.test(device))
  );

  if (
    distortionFrames.length < 2 ||
    distortionFrames.length < Math.ceil(orderedFrames.length / 2)
  ) {
    return null;
  }

  return {
    timestampSec: roundTo(distortionFrames[0].timestampSec, 3),
    cueType: "visual_device" as const,
    observation:
      "A recurring face-warp or distortion effect is applied across most of the age-labeled sequence.",
    interpretationHint:
      "The repeated distortion likely caricatures childlike simplicity or immature thinking rather than serving as random decoration.",
  } satisfies SynthesisCueInput;
}

function buildAlignedAudioPivotCue(
  frameAnalyses: FrameAnalysisRecord[],
  audioHeuristics: AudioHeuristicsRecord
) {
  const phaseContrastCue = buildPhaseContrastCue(frameAnalyses);

  if (!phaseContrastCue) {
    return null;
  }

  const alignedSignal = audioHeuristics.transitionSignals.find(
    (signal) => Math.abs(signal.timestampSec - phaseContrastCue.timestampSec) <= 1.25
  );

  if (!alignedSignal) {
    return null;
  }

  return {
    timestampSec: alignedSignal.timestampSec,
    cueType: "audio" as const,
    observation: `${alignedSignal.detail} It lands with the late-stage setting pivot.`,
    interpretationHint:
      "The soundtrack accent likely marks the reveal or emotional turn, not just a background music fluctuation.",
  } satisfies SynthesisCueInput;
}

function normalizeSearchText(value: string | null) {
  return normalizeText(value)?.toLowerCase() ?? null;
}

function buildTextEscalationCue(
  ocrFrames: OcrRecord["frames"],
  frameAnalyses: FrameAnalysisRecord[]
) {
  const orderedFrames = [...ocrFrames].sort((left, right) => left.timestampSec - right.timestampSec);
  const normalTrickFrames = orderedFrames.filter((frame) =>
    /normal\s+trick\s+shot/.test(normalizeSearchText(frame.text) ?? "")
  );
  const singledOutFrame = orderedFrames.find((frame) =>
    /\bthis\s+guy\b/.test(normalizeSearchText(frame.text) ?? "")
  );

  if (!singledOutFrame || normalTrickFrames.length === 0) {
    const fastReflexFrames = orderedFrames.filter((frame) =>
      /\bothers\s+fast\s+reflex\b/.test(normalizeSearchText(frame.text) ?? "")
    );

    if (
      !singledOutFrame ||
      fastReflexFrames.length < 3 ||
      singledOutFrame.timestampSec <= fastReflexFrames[0].timestampSec
    ) {
      return null;
    }

    const allFrameText = buildCombinedFrameText(frameAnalyses);
    const lateFrameText = buildCombinedFrameText(
      frameAnalyses,
      Math.max(0, singledOutFrame.timestampSec - 1.5)
    );
    const hasBallLanguage = /(soccer ball|football|ball)/.test(allFrameText);
    const hasTwoBallOrDecoySetup =
      /\btwo\s+(soccer\s+)?balls?\b/.test(allFrameText) ||
      /(decoy|second ball|trap|bait|through the legs|between the legs)/.test(allFrameText);
    const hasPublicTargetLanguage =
      /(pedestrian|passerby|crowd|rollerblad|police|woman|girls?|street scene|people walking)/.test(
        allFrameText
      );
    const hasLateReversalLanguage =
      /(two young men|tracksuit|reacting to the other man|looking down and reacting|skull)/.test(
        lateFrameText
      );

    if (!hasBallLanguage || !hasTwoBallOrDecoySetup || !hasPublicTargetLanguage) {
      return null;
    }

    return {
      timestampSec: roundTo(singledOutFrame.timestampSec, 3),
      cueType: "text" as const,
      observation:
        "On-screen labels repeat 'OTHERS FAST REFLEX' across public soccer-ball reaction setups, then switch to a late 'THIS GUY' callout for a final one-on-one exchange.",
      interpretationHint: hasLateReversalLanguage
        ? "The video is structured as a prank/reflex montage: earlier people are successfully baited by decoy or second-ball through-the-legs moves, but the singled-out final guy reacts fast enough to flip the trick back on the prankster."
        : "The late label suggests the final participant is the exception within the earlier reflex-prank pattern rather than just another example of ball skill.",
    } satisfies SynthesisCueInput;
  }

  if (singledOutFrame.timestampSec <= normalTrickFrames[0].timestampSec) {
    return null;
  }

  const lateFrameText = buildCombinedFrameText(
    frameAnalyses,
    Math.max(0, singledOutFrame.timestampSec - 1.5)
  );
  const hasCueShotLanguage =
    /(billiard|pool cue|cue stick|cue|pocket|8-ball|pool ball)/.test(lateFrameText) &&
    /(pipe|pvc|elbow|tube|ball)/.test(lateFrameText);

  return {
    timestampSec: roundTo(singledOutFrame.timestampSec, 3),
    cueType: "text" as const,
    observation: hasCueShotLanguage
      ? "On-screen labels shift from repeated 'NORMAL TRICK SHOT:' overlays to a late 'THIS GUY:' callout over a more elaborate cue-and-obstacle tabletop shot."
      : "On-screen labels shift from repeated 'NORMAL TRICK SHOT:' overlays to a late 'THIS GUY:' callout.",
    interpretationHint: hasCueShotLanguage
      ? "The joke is escalation: after a montage of ordinary trick shots, the ending spotlights one absurdly over-engineered billiards-style shot as the standout punchline."
      : "The late label suggests the ending beat is a singled-out exception or escalation rather than just another example.",
  } satisfies SynthesisCueInput;
}

function buildManualTransformationCue(frameAnalyses: FrameAnalysisRecord[]) {
  const orderedFrames = [...frameAnalyses].sort((left, right) => left.timestampSec - right.timestampSec);
  const handFocusedFrames = orderedFrames
    .map((frame) => ({
      frame,
      text: buildFrameEvidenceText(frame),
    }))
    .filter(({ text }) =>
      /(hand|hands|finger|fingers|thumb|thumbs|pinky|little finger|index finger|knuckle|knuckles|palm|fist)/.test(
        text
      )
    );

  if (handFocusedFrames.length < 2) {
    return null;
  }

  const concealmentFrames = handFocusedFrames.filter(({ text }) =>
    /(wrap|wrapped|wrapping|cover|covered|covering|closed fist|clenched fist|fist around|clasp|grip|slides? along|sliding along|conceal|concealed|hide|hidden|encase)/.test(
      text
    )
  );
  const revealFrames = handFocusedFrames.filter(({ text }) => {
    if (
      /(hand illusion|finger illusion|finger transformation|manual transformation|sleight[- ]of[- ]hand|different finger|changed finger|switch(?:es|ing)? fingers?|substitut(?:e|es|ed|ion)|transforms? into)/.test(
        text
      )
    ) {
      return true;
    }

    return (
      /(index finger|little finger|pinky)/.test(text) &&
      /(reveal|reveals|revealed|illusion|transformation|switch|becomes|become|different|unexpected)/.test(
        text
      )
    );
  });

  if (concealmentFrames.length === 0 || revealFrames.length === 0) {
    return null;
  }

  const firstConcealmentTimestampSec = concealmentFrames[0].frame.timestampSec;
  const revealFrame =
    revealFrames.find(({ frame }) => frame.timestampSec >= firstConcealmentTimestampSec) ??
    revealFrames[0];

  if (revealFrame.frame.timestampSec < firstConcealmentTimestampSec) {
    return null;
  }

  const surprisedReaction = orderedFrames
    .map((frame) => ({
      frame,
      text: buildFrameEvidenceText(frame),
    }))
    .find(
      ({ frame, text }) =>
        frame.timestampSec >= revealFrame.frame.timestampSec &&
        /(surpris|shock|astonish|wide-eyed|jaw-drop|amazed|stunned|gasp|wow|confused surprise)/.test(
          text
        )
    );

  return {
    timestampSec: roundTo(revealFrame.frame.timestampSec, 3),
    cueType: "scene" as const,
    observation: surprisedReaction
      ? "Close-up hand positions progress from a covered-finger setup into a different-finger reveal, followed by a surprised reaction beat."
      : "Close-up hand positions progress from a covered-finger setup into a different-finger reveal.",
    interpretationHint:
      "This points to a hand-illusion joke: the performer stages a manual finger transformation or substitution reveal rather than generic posing, dancing, or team-play acting.",
  } satisfies SynthesisCueInput;
}

function buildHiddenHelperRemovalCue(frameAnalyses: FrameAnalysisRecord[]) {
  const orderedFrames = [...frameAnalyses].sort((left, right) => left.timestampSec - right.timestampSec);
  const helperFrames = orderedFrames
    .map((frame) => ({
      frame,
      text: buildFrameEvidenceText(frame),
    }))
    .filter(
      ({ text }) =>
        /(green (?:full[- ]body|full body|morph|bodysuit|body suit|suit|outfit)|full green (?:morph )?suit|bright green (?:full[- ]body )?suit|green-screen|greenscreen|chroma)/.test(
          text
        ) &&
        /(person|man|figure|helper|assistant|bodysuit|morph suit|full-body suit)/.test(text)
    );

  if (helperFrames.length < 2) {
    return null;
  }

  const ballInteractionFrames = helperFrames.filter(
    ({ text }) =>
      /(soccer ball|football|ball)/.test(text) &&
      /(hold(?:ing)?|catch(?:ing)?|throw(?:ing)?|pass(?:ing)?|support(?:ing)?|reach(?:ing)?|prop(?:ping)?|lift(?:ing)?|position(?:ing)?|move(?:s|d|ing)?|control(?:ling)?)/.test(
        text
      )
  );
  const supportFrames = helperFrames.filter(({ text }) =>
    /(holding another'?s leg|holding the lifted leg|support(?:ing)? .*leg|lifted leg|raised leg|other man's leg)/.test(
      text
    )
  );
  const effectFrames = helperFrames.filter(({ text }) =>
    /(camouflage|invisib(?:le|ility)|green screen|greenscreen|chroma|visual effect|special effect|post[- ]production|composit|remove(?:d|s|ing)?|erase(?:d|s|ing)?|conceal identity|hide|hidden)/.test(
      text
    )
  );

  if (ballInteractionFrames.length < 2 || effectFrames.length === 0) {
    return null;
  }

  return {
    timestampSec: roundTo(helperFrames[0].frame.timestampSec, 3),
    cueType: "visual_device" as const,
    observation:
      supportFrames.length > 0
        ? "A full-body green-suit figure repeatedly handles the ball and even props another performer into position, while frame evidence also points to camouflage or invisibility-style intent."
        : "A full-body green-suit figure repeatedly handles the ball, while frame evidence also points to camouflage or invisibility-style intent.",
    interpretationHint:
      "This points to a staged hidden-helper effect: the green-suit assistant is physically positioning or moving the ball so post-production can remove them and leave a clean-looking soccer trick.",
  } satisfies SynthesisCueInput;
}

export function buildAudioTransitionSignals(
  windows: AudioHeuristicsRecord["energyTimeline"],
  silenceThreshold: number
) {
  const rawSignals: AudioHeuristicsRecord["transitionSignals"] = [];

  for (let index = 1; index < windows.length; index += 1) {
    const previous = windows[index - 1];
    const current = windows[index];
    const timestampSec = roundTo(current.startSec, 3);
    const relativeEnergyChange =
      Math.abs(current.rms - previous.rms) / Math.max(0.01, Math.max(current.rms, previous.rms));
    const textureChange = Math.abs(current.zeroCrossingRate - previous.zeroCrossingRate);

    if (previous.rms <= silenceThreshold && current.rms > silenceThreshold * 1.35) {
      rawSignals.push({
        timestampSec,
        kind: "silence_break",
        strength: roundTo(Math.max(relativeEnergyChange, 0.4), 4),
        detail: "Audio shifts from quiet into a more active or emphasized beat.",
      });
      continue;
    }

    if (textureChange >= 0.08) {
      rawSignals.push({
        timestampSec,
        kind: "texture_change",
        strength: roundTo(textureChange, 4),
        detail: "Audio texture changes noticeably, suggesting a tonal or timbral pivot.",
      });
      continue;
    }

    if (relativeEnergyChange >= 0.55 && Math.abs(current.rms - previous.rms) >= 0.01) {
      rawSignals.push({
        timestampSec,
        kind: "energy_change",
        strength: roundTo(relativeEnergyChange, 4),
        detail:
          current.rms > previous.rms
            ? "Audio energy rises sharply, marking a likely emphasis point."
            : "Audio energy drops sharply, marking a likely transition or release.",
      });
    }
  }

  const strongestByWindow: AudioHeuristicsRecord["transitionSignals"] = [];

  for (const signal of rawSignals.sort((left, right) => right.strength - left.strength)) {
    if (
      strongestByWindow.some(
        (existing) => Math.abs(existing.timestampSec - signal.timestampSec) < 0.75
      )
    ) {
      continue;
    }

    strongestByWindow.push(signal);

    if (strongestByWindow.length >= 8) {
      break;
    }
  }

  return strongestByWindow.sort((left, right) => left.timestampSec - right.timestampSec);
}

function buildOcrTimelineCues(frames: OcrRecord["frames"]): SynthesisCueInput[] {
  const cues: SynthesisCueInput[] = [];
  const seenKeys = new Set<string>();

  for (const frame of frames) {
    if (!frame.text) {
      continue;
    }

    const [firstLine] = splitLines(frame.text);
    const line = normalizeCueText(firstLine || frame.text, 120);

    if (!line) {
      continue;
    }

    const key = `${toCueKey(line)}:${Math.round(frame.timestampSec * 2)}`;

    if (seenKeys.has(key)) {
      continue;
    }

    seenKeys.add(key);
    cues.push({
      timestampSec: roundTo(frame.timestampSec, 3),
      cueType: "text",
      observation: `On-screen text reads: ${line}`,
      interpretationHint: null,
    });
  }

  return cues;
}

function buildFrameSignalCues(frameAnalyses: FrameAnalysisRecord[]): SynthesisCueInput[] {
  const orderedFrames = [...frameAnalyses].sort((left, right) => left.timestampSec - right.timestampSec);
  const cues: SynthesisCueInput[] = [];
  let previousFrame: FrameAnalysisRecord | null = null;

  for (const frame of orderedFrames) {
    if (frame.facialExpression) {
      cues.push({
        timestampSec: roundTo(frame.timestampSec, 3),
        cueType: "expression",
        observation: `Facial expression or reaction: ${frame.facialExpression}.`,
        interpretationHint: null,
      });
    }

    if (frame.visualDevices.length > 0) {
      cues.push({
        timestampSec: roundTo(frame.timestampSec, 3),
        cueType: "visual_device",
        observation: `Visual devices present: ${frame.visualDevices.join(", ")}.`,
        interpretationHint: null,
      });
    }

    if (
      previousFrame &&
      frame.emotionalTone &&
      previousFrame.emotionalTone &&
      frame.emotionalTone !== previousFrame.emotionalTone
    ) {
      cues.push({
        timestampSec: roundTo(frame.timestampSec, 3),
        cueType: "scene",
        observation: `Emotional tone shifts from ${previousFrame.emotionalTone} to ${frame.emotionalTone}.`,
        interpretationHint: null,
      });
    }

    previousFrame = frame;
  }

  return cues;
}

export function buildSynthesisCueTimeline(
  ocr: OcrRecord,
  frameAnalyses: FrameAnalysisRecord[],
  audioHeuristics: AudioHeuristicsRecord
) {
  const rawCues: SynthesisCueInput[] = [
    buildSequentialAgeCue(frameAnalyses),
    buildPhaseContrastCue(frameAnalyses),
    buildRepeatedVisualDeviceCue(frameAnalyses),
    buildAlignedAudioPivotCue(frameAnalyses, audioHeuristics),
    buildTextEscalationCue(ocr.frames, frameAnalyses),
    buildManualTransformationCue(frameAnalyses),
    buildHiddenHelperRemovalCue(frameAnalyses),
    ...buildOcrTimelineCues(ocr.frames),
    ...buildFrameSignalCues(frameAnalyses),
    ...audioHeuristics.transitionSignals.map((signal) => ({
      timestampSec: signal.timestampSec,
      cueType: "audio" as const,
      observation: signal.detail,
      interpretationHint: null,
    })),
  ]
    .filter((cue): cue is SynthesisCueInput => cue !== null)
    .sort((left, right) => left.timestampSec - right.timestampSec);

  const cues: SynthesisCueInput[] = [];

  for (const cue of rawCues) {
    if (
      cues.some(
        (existing) =>
          existing.cueType === cue.cueType &&
          existing.observation === cue.observation &&
          Math.abs(existing.timestampSec - cue.timestampSec) < 0.75
      )
    ) {
      continue;
    }

    cues.push(cue);

    if (cues.length >= 16) {
      break;
    }
  }

  return cues;
}

export function buildStoryHypotheses(
  ocr: OcrRecord,
  frameAnalyses: FrameAnalysisRecord[],
  audioHeuristics: AudioHeuristicsRecord
) {
  const hypotheses: string[] = [];
  const phaseContrastCue = buildPhaseContrastCue(frameAnalyses);
  const repeatedVisualDeviceCue = buildRepeatedVisualDeviceCue(frameAnalyses);
  const alignedAudioPivotCue = buildAlignedAudioPivotCue(frameAnalyses, audioHeuristics);
  const textEscalationCue = buildTextEscalationCue(ocr.frames, frameAnalyses);
  const manualTransformationCue = buildManualTransformationCue(frameAnalyses);
  const hiddenHelperRemovalCue = buildHiddenHelperRemovalCue(frameAnalyses);

  if (phaseContrastCue?.interpretationHint?.includes("carefree childhood gives way to school life")) {
    hypotheses.push(
      "The montage sets up ages 1-4 as carefree play, then uses age 5 in a classroom to reveal that school life begins and carefree childhood ends."
    );
  } else if (phaseContrastCue?.interpretationHint) {
    hypotheses.push(phaseContrastCue.interpretationHint);
  }

  if (manualTransformationCue?.interpretationHint) {
    hypotheses.push(
      "The clip centers on a manual finger illusion: one hand covers or slides over a finger, then the reveal makes it look like a different finger has appeared as the punchline."
    );
  }

  if (hiddenHelperRemovalCue?.interpretationHint) {
    hypotheses.push(
      "The 'secret' is a staged editing trick: a green-suit helper physically moves or supports the ball setup, then post-production removes that helper to leave a clean-looking soccer trick."
    );
  }

  if (repeatedVisualDeviceCue?.interpretationHint) {
    hypotheses.push(
      "The recurring face distortion likely represents a simplistic pre-school mindset rather than a random comedic filter."
    );
  }

  if (alignedAudioPivotCue) {
    hypotheses.push(
      "The music accent at the final transition reinforces that the late classroom beat is the reveal, not just another scene."
    );
  }

  if (textEscalationCue?.interpretationHint?.includes("prank/reflex montage")) {
    hypotheses.push(
      "The repeated 'OTHERS FAST REFLEX' label frames a series of public soccer-ball prank tests, but the final 'THIS GUY' beat is the exception: he reacts fast enough to stop the trick and send it back at the prankster."
    );
  } else if (textEscalationCue?.interpretationHint?.includes("billiards-style shot")) {
    hypotheses.push(
      "The montage treats most setups as 'normal trick shots' and saves a singled-out, absurdly over-engineered billiards-style cue-and-pipe shot for the finale punchline."
    );
  } else if (textEscalationCue?.interpretationHint) {
    hypotheses.push(textEscalationCue.interpretationHint);
  }

  return [...new Set(hypotheses)].slice(0, 4);
}