import { Model, Schema, model, models } from "mongoose";

import type { VideoAnalysisDocumentData, VideoAnalysisStatus } from "@/lib/video-analysis-shared";

export interface VideoAnalysisDocument extends Omit<VideoAnalysisDocumentData, "createdAt" | "updatedAt"> {
  createdAt: Date;
  updatedAt: Date;
}

const videoAnalysisSchema = new Schema(
  {
    videoId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    downloadId: {
      type: String,
      default: null,
      trim: true,
    },
    filePath: {
      type: String,
      required: true,
      trim: true,
    },
    sourceUrl: {
      type: String,
      default: null,
      trim: true,
    },
    platform: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["completed", "partial", "failed"] satisfies VideoAnalysisStatus[],
    },
    mediaMetadata: {
      type: Schema.Types.Mixed,
      required: true,
    },
    artifacts: {
      type: Schema.Types.Mixed,
      required: true,
    },
    transcript: {
      type: Schema.Types.Mixed,
      required: true,
    },
    scenes: {
      type: Schema.Types.Mixed,
      required: true,
    },
    frames: {
      type: Array,
      default: [],
    },
    ocr: {
      type: Schema.Types.Mixed,
      required: true,
    },
    audioHeuristics: {
      type: Schema.Types.Mixed,
      required: true,
    },
    frameAnalyses: {
      type: Array,
      default: [],
    },
    analysis: {
      type: Schema.Types.Mixed,
      required: true,
    },
    embeddings: {
      type: Schema.Types.Mixed,
      required: true,
    },
    pipeline: {
      type: Schema.Types.Mixed,
      required: true,
    },
    debug: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: "video_analyses",
  }
);

videoAnalysisSchema.index({ status: 1, updatedAt: -1 });

export const VideoAnalysis =
  (models.VideoAnalysis as Model<VideoAnalysisDocument>) ||
  model<VideoAnalysisDocument>("VideoAnalysis", videoAnalysisSchema);