export type PipelineStageStatus = "pending" | "completed" | "failed" | "skipped";

export type DownloadAnalysisStatus =
  | "not_started"
  | "queued"
  | "analyzing"
  | "completed"
  | "partial"
  | "failed";

export type VideoAnalysisStatus = "completed" | "partial" | "failed";

export type StoryRole =
  | "hook"
  | "setup"
  | "development"
  | "reveal"
  | "payoff"
  | "cta"
  | "unknown";

export type DynamicProfile =
  | "very_calm"
  | "calm"
  | "moderate"
  | "high_energy"
  | "very_high_energy";

export type AnalysisPipelineStageKey =
  | "probe"
  | "audioExtraction"
  | "transcription"
  | "sceneDetection"
  | "frameSelection"
  | "ocr"
  | "audioAnalysis"
  | "frameAnalysis"
  | "finalSynthesis"
  | "embeddings";

export interface PipelineStageRecord {
  status: PipelineStageStatus;
  startedAt: string | null;
  finishedAt: string | null;
  error?: string | null;
}

export interface MediaMetadataRecord {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string | null;
  audioPresent: boolean;
  audioCodec: string | null;
  bitrate: number | null;
  fileSizeBytes: number;
}

export interface TranscriptSegmentRecord {
  startSec: number;
  endSec: number;
  text: string;
  avgLogprob: number | null;
  compressionRatio: number | null;
  noSpeechProb: number | null;
}

export interface TranscriptRecord {
  status: PipelineStageStatus;
  provider: "openai";
  language: string | null;
  text: string | null;
  rawText: string | null;
  segments: TranscriptSegmentRecord[];
  audibleSpeechLikely: boolean;
  confidence: number | null;
  suppressionReason: string | null;
  error: string | null;
}

export interface SceneCandidateRecord {
  timestampSec: number;
  framePath: string;
  score: number | null;
}

export interface SceneSelectionStrategyRecord {
  earlyHookDenseSampling: boolean;
  sceneChangeDetection: boolean;
  uniformBackfill: boolean;
  dedupeApplied: boolean;
}

export interface SceneRecord {
  status: PipelineStageStatus;
  candidates: SceneCandidateRecord[];
  selectionStrategy: SceneSelectionStrategyRecord;
  error: string | null;
}

export interface SelectedFrameRecord {
  timestampSec: number;
  framePath: string;
  frameIndex: number;
  selectionReason: "early_hook" | "scene_change" | "uniform_backfill" | "fallback";
}

export interface OcrFrameRecord {
  timestampSec: number;
  framePath: string;
  text: string | null;
  confidence: number | null;
  boxes: Array<Record<string, unknown>>;
}

export interface OcrRecord {
  status: PipelineStageStatus;
  detected: boolean;
  summaryText: string | null;
  frames: OcrFrameRecord[];
  error: string | null;
}

export interface AudioEnergyPointRecord {
  startSec: number;
  endSec: number;
  rms: number;
  zeroCrossingRate: number;
}

export type AudioTransitionKind = "energy_change" | "silence_break" | "texture_change";

export interface AudioTransitionRecord {
  timestampSec: number;
  kind: AudioTransitionKind;
  strength: number;
  detail: string;
}

export interface SilenceRegionRecord {
  startSec: number;
  endSec: number;
}

export interface AudioHeuristicsRecord {
  status: PipelineStageStatus;
  audioPresent: boolean;
  speechPresentLikely: boolean;
  musicPresentLikely: boolean;
  musicPresenceConfidence: number;
  avgRmsEnergy: number;
  peakRmsEnergy: number;
  energyTimeline: AudioEnergyPointRecord[];
  transitionSignals: AudioTransitionRecord[];
  silenceRegions: SilenceRegionRecord[];
  dynamicProfile: DynamicProfile;
  notes: string[];
  error: string | null;
}

export interface FrameAnalysisRecord {
  timestampSec: number;
  sceneDescription: string;
  subjects: string[];
  objects: string[];
  actions: string[];
  environment: string | null;
  cameraFraming: string | null;
  emotionalTone: string | null;
  facialExpression: string | null;
  visualDevices: string[];
  visibleTextSummary: string | null;
  storyRole: StoryRole;
  observedFacts: string[];
  inferences: string[];
  uncertainties: string[];
}

export interface SceneReconstructionRecord {
  startSec: number;
  endSec: number;
  description: string;
}

export interface ConfidenceRecord {
  overall: number;
  transcriptConfidence: number;
  visualConfidence: number;
  scenarioConfidence: number;
}

export type NarrativeCueType = "audio" | "expression" | "visual_device" | "text" | "scene";

export interface NarrativeCueRecord {
  timestampSec: number;
  cueType: NarrativeCueType;
  observation: string;
  interpretation: string | null;
}

export interface AnalysisNarrativeStructureRecord {
  hook: string | null;
  setup: string | null;
  development: string | null;
  twistOrReveal: string | null;
  payoff: string | null;
  cta: string | null;
}

export interface AnalysisRecord {
  status: VideoAnalysisStatus;
  summary: string | null;
  mainIdea: string | null;
  language: string | null;
  contentCategory: string | null;
  narrativeStructure: AnalysisNarrativeStructureRecord;
  visualStyle: string | null;
  editingStyle: string | null;
  audioRole: string | null;
  musicRole: string | null;
  onScreenTextRole: string | null;
  probableScript: string | null;
  sceneBySceneReconstruction: SceneReconstructionRecord[];
  techniques: string[];
  narrativeCues: NarrativeCueRecord[];
  observedFacts: string[];
  inferredElements: string[];
  uncertainElements: string[];
  confidence: ConfidenceRecord;
  error: string | null;
}

export interface SceneEmbeddingRecord {
  startSec: number;
  endSec: number;
  storyRole: StoryRole;
  vector: number[];
}

export interface EmbeddingsRecord {
  status: PipelineStageStatus;
  embeddingProvider: "openai";
  embeddingModel: string;
  embeddingVersion: string;
  embeddingTextVersion: string;
  searchText: string;
  video: number[];
  scenes: SceneEmbeddingRecord[];
  error: string | null;
}

export interface VideoAnalysisDocumentData {
  videoId: string;
  downloadId: string | null;
  verified: boolean;
  filePath: string;
  sourceUrl: string | null;
  platform: string | null;
  status: VideoAnalysisStatus;
  mediaMetadata: MediaMetadataRecord;
  artifacts: {
    audioPath: string | null;
    framePaths: string[];
    tempFiles: string[];
  };
  transcript: TranscriptRecord;
  scenes: SceneRecord;
  frames: SelectedFrameRecord[];
  ocr: OcrRecord;
  audioHeuristics: AudioHeuristicsRecord;
  frameAnalyses: FrameAnalysisRecord[];
  analysis: AnalysisRecord;
  embeddings: EmbeddingsRecord;
  pipeline: Record<AnalysisPipelineStageKey, PipelineStageRecord>;
  debug: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface VideoAnalysisListRecord {
  id: string;
  videoId: string;
  downloadId: string | null;
  verified: boolean;
  name: string | null;
  fileName: string | null;
  published: string | null;
  platform: string | null;
  sourceUrl: string | null;
  status: VideoAnalysisStatus;
  contentCategory: string | null;
  summary: string | null;
  durationSec: number;
  analyzedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoAnalysisDetailRecord extends VideoAnalysisDocumentData {
  id: string;
  name: string | null;
  fileName: string | null;
  published: string | null;
}

export interface StartVideoAnalysisResponse {
  message: string;
}

export interface StartVideoAnalysisConflictResponse {
  error: string;
  requiresOverwrite: true;
}

export interface VideoAnalysesListResponse {
  analyses: VideoAnalysisListRecord[];
}

export interface VideoAnalysisDetailResponse {
  analysis: VideoAnalysisDetailRecord;
}

export interface VideoAnalysisDeleteResponse {
  deletedId: string;
  message: string;
}

export interface VideoAnalysisUpdateResponse {
  analysis: VideoAnalysisDetailRecord;
  message: string;
}