import { rm, stat } from "node:fs/promises";
import path from "node:path";

import { Types } from "mongoose";

import { ApiError, toNonEmptyString } from "@/lib/api-utils";
import { deleteDownloads } from "@/lib/downloads";
import { createLogEntry } from "@/lib/logs";
import { connectToDatabase } from "@/lib/mongodb";
import { deleteVideoAnalysisArtifacts, processVideo } from "@/lib/video-analysis";
import type {
  VideoAnalysisDetailRecord,
  VideoAnalysisListRecord,
} from "@/lib/video-analysis-shared";
import { Download, type DownloadReferenceDocument } from "@/models/download";
import {
  VideoAnalysis,
  type VideoAnalysisDocument,
} from "@/models/video-analysis";

type StoredVideoAnalysis = VideoAnalysisDocument & {
  _id?: unknown;
};

function normalizeVideoAnalysisId(value: string) {
  const videoId = toNonEmptyString(value);

  if (!videoId) {
    throw new ApiError(400, "A video analysis id is required.");
  }

  return videoId;
}

function buildAnalysisName(
  analysis: StoredVideoAnalysis,
  download: DownloadReferenceDocument | null
) {
  if (download?.name?.trim()) {
    return download.name.trim();
  }

  const fileName = download?.fileName?.trim() || path.basename(analysis.filePath);
  return fileName || analysis.videoId;
}

function buildAnalysisFileName(
  analysis: StoredVideoAnalysis,
  download: DownloadReferenceDocument | null
) {
  const fileName = download?.fileName?.trim() || path.basename(analysis.filePath);
  return fileName || null;
}

function serializeAnalysisListRecord(
  analysis: StoredVideoAnalysis,
  download: DownloadReferenceDocument | null
): VideoAnalysisListRecord {
  return {
    id: analysis.videoId,
    videoId: analysis.videoId,
    downloadId: analysis.downloadId ?? null,
    verified: analysis.verified === true,
    name: buildAnalysisName(analysis, download),
    fileName: buildAnalysisFileName(analysis, download),
    published: download?.published?.toISOString() ?? null,
    platform: download?.provider ?? analysis.platform ?? null,
    sourceUrl: download?.url ?? analysis.sourceUrl ?? null,
    status: analysis.status,
    contentCategory: analysis.analysis.contentCategory,
    summary: analysis.analysis.summary,
    durationSec: analysis.mediaMetadata.durationSec,
    analyzedAt: analysis.updatedAt?.toISOString() ?? null,
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
  };
}

function serializeAnalysisDetailRecord(
  analysis: StoredVideoAnalysis,
  download: DownloadReferenceDocument | null
): VideoAnalysisDetailRecord {
  return {
    ...analysis,
    id: analysis.videoId,
    verified: analysis.verified === true,
    name: buildAnalysisName(analysis, download),
    fileName: buildAnalysisFileName(analysis, download),
    sourceUrl: download?.url ?? analysis.sourceUrl ?? null,
    platform: download?.provider ?? analysis.platform ?? null,
    published: download?.published?.toISOString() ?? null,
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
  };
}

async function loadDownloadMap(downloadIds: string[]) {
  const validDownloadIds = downloadIds.filter((downloadId) => Types.ObjectId.isValid(downloadId));

  if (validDownloadIds.length === 0) {
    return new Map<string, DownloadReferenceDocument>();
  }

  const downloads = await Download.find({
    _id: { $in: validDownloadIds.map((downloadId) => new Types.ObjectId(downloadId)) },
  }).exec();

  return new Map(
    downloads.map((download) => [download._id.toString(), download as DownloadReferenceDocument])
  );
}

function buildStoredDownloadFilePath(fileName: string) {
  return path.join(
    /*turbopackIgnore: true*/ process.cwd(),
    "storage",
    "downloads",
    path.basename(fileName)
  );
}

type VideoAnalysisExecutionTarget = {
  videoId: string;
  downloadId: string | null;
  filePath: string;
  sourceUrl: string | null;
  platform: string | null;
};

async function resolveVideoAnalysisExecutionTarget(
  videoId: string
): Promise<VideoAnalysisExecutionTarget> {
  const analysis = (await VideoAnalysis.findOne({ videoId }).lean().exec()) as StoredVideoAnalysis | null;
  const download = Types.ObjectId.isValid(videoId)
    ? ((await Download.findById(videoId).exec()) as DownloadReferenceDocument | null)
    : null;

  if (download?.status === "completed" && download.fileName?.trim()) {
    return {
      videoId,
      downloadId: download._id.toString(),
      filePath: buildStoredDownloadFilePath(download.fileName),
      sourceUrl: download.url ?? analysis?.sourceUrl ?? null,
      platform: download.provider ?? analysis?.platform ?? null,
    };
  }

  if (analysis) {
    return {
      videoId: analysis.videoId,
      downloadId: analysis.downloadId ?? download?._id.toString() ?? null,
      filePath: analysis.filePath,
      sourceUrl: download?.url ?? analysis.sourceUrl ?? null,
      platform: download?.provider ?? analysis.platform ?? null,
    };
  }

  if (download) {
    throw new ApiError(409, "The download exists but is not ready for analysis.");
  }

  throw new ApiError(404, "Video analysis was not found.");
}

export async function listVideoAnalyses() {
  await connectToDatabase();

  const analyses = (await VideoAnalysis.find({})
    .sort({ updatedAt: -1 })
    .lean()
    .exec()) as StoredVideoAnalysis[];
  const downloadById = await loadDownloadMap(
    analyses
      .map((analysis) => analysis.downloadId)
      .filter((downloadId): downloadId is string => typeof downloadId === "string" && downloadId.length > 0)
  );

  return analyses.map((analysis) =>
    serializeAnalysisListRecord(
      analysis,
      analysis.downloadId ? downloadById.get(analysis.downloadId) ?? null : null
    )
  );
}

export async function listVerifiedVideoAnalysisIds() {
  await connectToDatabase();

  const analyses = (await VideoAnalysis.find(
    { verified: true },
    { _id: 0, videoId: 1 }
  )
    .sort({ updatedAt: -1, videoId: 1 })
    .lean()
    .exec()) as Array<{ videoId: string }>;

  return analyses.map((analysis) => analysis.videoId);
}

export async function getVideoAnalysisDetails(videoIdValue: string) {
  await connectToDatabase();

  const videoId = normalizeVideoAnalysisId(videoIdValue);
  const analysis = (await VideoAnalysis.findOne({ videoId }).lean().exec()) as StoredVideoAnalysis | null;

  if (!analysis) {
    throw new ApiError(404, "Video analysis was not found.");
  }

  const downloadById = await loadDownloadMap(
    analysis.downloadId ? [analysis.downloadId] : []
  );
  const download = analysis.downloadId ? downloadById.get(analysis.downloadId) ?? null : null;

  return serializeAnalysisDetailRecord(analysis, download);
}

export async function analyzeVideoByIdDryRun(videoIdValue: string) {
  await connectToDatabase();

  const videoId = normalizeVideoAnalysisId(videoIdValue);
  const target = await resolveVideoAnalysisExecutionTarget(videoId);
  const fileInfo = await stat(target.filePath).catch(() => null);

  if (!fileInfo?.isFile()) {
    throw new ApiError(404, "Video file was not found in storage.");
  }

  return processVideo(
    target.videoId,
    target.filePath,
    target.sourceUrl ?? undefined,
    target.platform ?? undefined,
    {
      downloadId: target.downloadId,
      persistDocument: false,
      updateDownloadState: false,
      writeLogs: false,
    }
  );
}

export async function updateVideoAnalysisVerification(
  videoIdValue: string,
  verified: boolean
) {
  await connectToDatabase();

  const videoId = normalizeVideoAnalysisId(videoIdValue);
  const analysis = (await VideoAnalysis.findOneAndUpdate(
    { videoId },
    {
      $set: {
        verified,
      },
    },
    {
      returnDocument: "after",
    }
  )
    .lean()
    .exec()) as StoredVideoAnalysis | null;

  if (!analysis) {
    throw new ApiError(404, "Video analysis was not found.");
  }

  const downloadById = await loadDownloadMap(
    analysis.downloadId ? [analysis.downloadId] : []
  );
  const download = analysis.downloadId ? downloadById.get(analysis.downloadId) ?? null : null;

  await createLogEntry({
    scope: "video_analysis",
    level: "info",
    message: verified
      ? "Video analysis marked as verified."
      : "Video analysis verification cleared.",
    downloadId: analysis.downloadId ?? videoId,
    details: {
      videoId,
      verified,
    },
  });

  return serializeAnalysisDetailRecord(analysis, download);
}

export async function deleteAnalyzedVideo(videoIdValue: string) {
  await connectToDatabase();

  const videoId = normalizeVideoAnalysisId(videoIdValue);
  const analysis = (await VideoAnalysis.findOne({ videoId }).lean().exec()) as StoredVideoAnalysis | null;

  if (!analysis) {
    throw new ApiError(404, "Video analysis was not found.");
  }

  if (analysis.downloadId && Types.ObjectId.isValid(analysis.downloadId)) {
    const deletedDownloadIds = await deleteDownloads([analysis.downloadId]);

    if (deletedDownloadIds.length > 0) {
      return {
        deletedId: videoId,
        message: "Video deleted.",
      };
    }
  }

  await rm(analysis.filePath, { force: true }).catch(() => undefined);
  await deleteVideoAnalysisArtifacts(videoId);

  await createLogEntry({
    scope: "video_analysis",
    level: "info",
    message: "Analyzed video deleted.",
    downloadId: analysis.downloadId ?? videoId,
    details: {
      videoId,
      filePath: analysis.filePath,
      sourceUrl: analysis.sourceUrl,
    },
  });

  return {
    deletedId: videoId,
    message: "Video deleted.",
  };
}