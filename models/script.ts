import { Model, Schema, model, models } from "mongoose";

import {
  SCRIPT_LANGUAGES,
  type ScriptDocumentData,
} from "@/lib/scripts-shared";

export interface ScriptDraftDocument
  extends Omit<ScriptDocumentData, "createdAt" | "updatedAt"> {
  createdAt: Date;
  updatedAt: Date;
}

const scriptDraftSchema = new Schema<ScriptDraftDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    basedOnDownloadIds: {
      type: [
        {
          type: String,
          trim: true,
        },
      ],
      default: [],
    },
    language: {
      type: String,
      required: true,
      enum: [...SCRIPT_LANGUAGES],
      trim: true,
    },
    durationSec: {
      type: Number,
      default: null,
      min: 1,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50000,
    },
    generatedScript: {
      type: String,
      default: null,
      trim: true,
      maxlength: 120000,
    },
  },
  {
    timestamps: true,
    collection: "scripts",
  }
);

scriptDraftSchema.index({ updatedAt: -1 });

export const ScriptDraft =
  (models.ScriptDraft as Model<ScriptDraftDocument>) ||
  model<ScriptDraftDocument>("ScriptDraft", scriptDraftSchema);
