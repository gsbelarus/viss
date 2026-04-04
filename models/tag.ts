import { Model, Schema, Types, model, models } from "mongoose";

export interface TagDocument {
  name: string;
  normalizedName: string;
  createdAt: Date;
  updatedAt: Date;
}

const tagSchema = new Schema<TagDocument>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
    },
  },
  {
    timestamps: true,
  }
);

tagSchema.index({ normalizedName: 1 }, { unique: true });

export type TagReferenceDocument = TagDocument & {
  _id: Types.ObjectId;
};

export const Tag =
  (models.Tag as Model<TagDocument>) || model<TagDocument>("Tag", tagSchema);