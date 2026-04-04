import { Model, Schema, Types, model, models } from "mongoose";

import type { LogLevel } from "@/lib/logs-shared";

export interface LogEntryDocument {
  scope: string;
  level: LogLevel;
  message: string;
  download: Types.ObjectId | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const logEntrySchema = new Schema<LogEntryDocument>(
  {
    scope: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    level: {
      type: String,
      required: true,
      enum: ["info", "success", "error"],
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    download: {
      type: Schema.Types.ObjectId,
      ref: "Download",
      default: null,
    },
    details: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

logEntrySchema.index({ createdAt: -1 });
logEntrySchema.index({ scope: 1, createdAt: -1 });

export type LogEntryReferenceDocument = LogEntryDocument & {
  _id: Types.ObjectId;
};

export const LogEntry =
  (models.LogEntry as Model<LogEntryDocument>) ||
  model<LogEntryDocument>("LogEntry", logEntrySchema);