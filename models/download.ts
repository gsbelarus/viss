import { Model, Schema, Types, model, models } from "mongoose";

import type { DownloadStatus, VideoProvider } from "@/lib/downloads-shared";
import type { DownloadAnalysisStatus } from "@/lib/video-analysis-shared";

export interface DownloadDocument {
  provider: VideoProvider;
  url: string;
  fileName: string | null;
  size: number | null;
  downloaded: Date | null;
  name: string | null;
  tags: Types.ObjectId[];
  status: DownloadStatus;
  bytesReceived: number;
  expectedSize: number | null;
  errorMessage: string | null;
  analysisStatus: DownloadAnalysisStatus;
  analysisProgressPercent: number | null;
  analysisStage: string | null;
  analysisErrorMessage: string | null;
  analyzed: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const downloadSchema = new Schema<DownloadDocument>(
  {
    provider: {
      type: String,
      required: true,
      enum: ["youtube"],
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    fileName: {
      type: String,
      default: null,
      trim: true,
    },
    size: {
      type: Number,
      default: null,
      min: 0,
    },
    downloaded: {
      type: Date,
      default: null,
    },
    name: {
      type: String,
      default: null,
      trim: true,
      maxlength: 200,
    },
    tags: {
      type: [Schema.Types.ObjectId],
      ref: "Tag",
      default: [],
    },
    status: {
      type: String,
      required: true,
      enum: ["queued", "downloading", "completed", "failed"],
      default: "queued",
    },
    bytesReceived: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    expectedSize: {
      type: Number,
      default: null,
      min: 0,
    },
    errorMessage: {
      type: String,
      default: null,
      trim: true,
    },
    analysisStatus: {
      type: String,
      required: true,
      enum: ["not_started", "queued", "analyzing", "completed", "partial", "failed"],
      default: "not_started",
    },
    analysisProgressPercent: {
      type: Number,
      default: null,
      min: 0,
      max: 100,
    },
    analysisStage: {
      type: String,
      default: null,
      trim: true,
      maxlength: 120,
    },
    analysisErrorMessage: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },
    analyzed: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

downloadSchema.index({ status: 1, updatedAt: -1 });
downloadSchema.index({ downloaded: -1, createdAt: -1 });

export type DownloadReferenceDocument = DownloadDocument & {
  _id: Types.ObjectId;
};

export const Download =
  (models.Download as Model<DownloadDocument>) ||
  model<DownloadDocument>("Download", downloadSchema);