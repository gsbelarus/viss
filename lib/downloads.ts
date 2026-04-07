import { createWriteStream } from "node:fs";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { Types } from "mongoose";

import { ApiError, getErrorMessage } from "@/lib/api-utils";
import type {
  DownloadMetadataResponse,
  DownloadRecord,
  VideoProvider,
} from "@/lib/downloads-shared";
import { createLogEntry } from "@/lib/logs";
import { connectToDatabase } from "@/lib/mongodb";
import type { ActiveProcessRecord } from "@/lib/processes-shared";
import {
  deleteVideoAnalysisArtifacts,
  startQueuedVideoAnalysis,
} from "@/lib/video-analysis";
import {
  getYouTubeBasicInfo,
  getYouTubeDownloadResources,
  getYouTubePublishedAt,
  getYouTubeVideoId,
} from "@/lib/youtube";
import { Download } from "@/models/download";
import { Tag } from "@/models/tag";

const DOWNLOAD_SCOPE = "downloads";
const DOWNLOADS_DIRECTORY = path.join(process.cwd(), "storage", "downloads");
const ACTIVE_STATUSES = ["queued", "downloading"] as const;
const ACTIVE_ANALYSIS_STATUSES = ["queued", "analyzing"] as const;

declare global {
  var __vissDownloadJobs: Map<string, Promise<void>> | undefined;
}

type PopulatedTag = {
  _id: Types.ObjectId;
  name: string;
};

type YouTubeBasicInfo = Awaited<ReturnType<typeof getYouTubeBasicInfo>>;

const globalForJobs = globalThis as typeof globalThis & {
  __vissDownloadJobs?: Map<string, Promise<void>>;
};

const jobRegistry = globalForJobs.__vissDownloadJobs ?? new Map<string, Promise<void>>();

globalForJobs.__vissDownloadJobs = jobRegistry;

function assertSupportedProvider(url: string): {
  provider: VideoProvider;
  videoId: string;
} {
  const videoId = getYouTubeVideoId(url);

  if (videoId) {
    return {
      provider: "youtube",
      videoId,
    };
  }

  throw new ApiError(400, "Only YouTube video URLs are supported right now.");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanTagName(value: string) {
  return normalizeWhitespace(value).slice(0, 80);
}

function parsePublishedTimestamp(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalizedValue = normalizeWhitespace(value);

  if (!normalizedValue) {
    return null;
  }

  const parsedValue = new Date(normalizedValue);

  if (Number.isNaN(parsedValue.getTime())) {
    throw new ApiError(400, "Published timestamp is invalid.");
  }

  return parsedValue;
}

function normalizeTagName(value: string) {
  return cleanTagName(value).toLowerCase();
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.toLowerCase();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(value);
  }

  return result;
}

function extractSuggestedTags(info: YouTubeBasicInfo) {
  const keywords = info.basic_info.keywords ?? [];

  return uniqueStrings(
    keywords
      .map((keyword) => cleanTagName(keyword))
      .filter(Boolean)
      .slice(0, 8)
  );
}

function resolvePublishedAt(info: YouTubeBasicInfo) {
  return getYouTubePublishedAt(info);
}

function sanitizeFileStem(value: string) {
  const sanitized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .trim()
    .replace(/[-\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return sanitized || "video";
}

async function ensureDirectoryExists(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

async function fileExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveUniqueFileName(baseName: string, extension: string) {
  let candidate = `${baseName}.${extension}`;
  let suffix = 1;

  while (await fileExists(path.join(DOWNLOADS_DIRECTORY, candidate))) {
    candidate = `${baseName}-${suffix}.${extension}`;
    suffix += 1;
  }

  return candidate;
}

async function resolveTagIds(tagNames: string[]) {
  const cleanedPairs = uniqueStrings(
    tagNames.map((tagName) => cleanTagName(tagName)).filter(Boolean)
  ).map((tagName) => ({
    name: tagName,
    normalizedName: normalizeTagName(tagName),
  }));

  if (cleanedPairs.length === 0) {
    return [] as Types.ObjectId[];
  }

  const normalizedNames = cleanedPairs.map((pair) => pair.normalizedName);
  const existingTags = await Tag.find({ normalizedName: { $in: normalizedNames } }).exec();
  const tagByNormalizedName = new Map(
    existingTags.map((tag) => [tag.normalizedName, tag])
  );

  for (const pair of cleanedPairs) {
    if (tagByNormalizedName.has(pair.normalizedName)) {
      continue;
    }

    const tag = await Tag.findOneAndUpdate(
      { normalizedName: pair.normalizedName },
      {
        $setOnInsert: {
          name: pair.name,
          normalizedName: pair.normalizedName,
        },
      },
      {
        upsert: true,
        returnDocument: "after",
      }
    ).exec();

    if (tag) {
      tagByNormalizedName.set(pair.normalizedName, tag);
    }
  }

  return cleanedPairs
    .map((pair) => tagByNormalizedName.get(pair.normalizedName)?._id)
    .filter((tagId): tagId is Types.ObjectId => Boolean(tagId));
}

function serializeTags(tags: Array<Types.ObjectId | PopulatedTag>) {
  return tags
    .map((tag) => {
      if (tag instanceof Types.ObjectId) {
        return null;
      }

      return {
        id: tag._id.toString(),
        name: tag.name,
      };
    })
    .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag));
}

function serializeDownload(download: {
  _id: Types.ObjectId;
  provider: VideoProvider;
  url: string;
  fileName: string | null;
  size: number | null;
  published: Date | null;
  downloaded: Date | null;
  name: string | null;
  tags: Array<Types.ObjectId | PopulatedTag>;
  status: DownloadRecord["status"];
  bytesReceived: number;
  expectedSize: number | null;
  errorMessage: string | null;
  analysisStatus: DownloadRecord["analysisStatus"];
  analysisProgressPercent: number | null;
  analysisStage: string | null;
  analysisErrorMessage: string | null;
  analyzed: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const analysisStatus = download.analysisStatus ?? "not_started";

  const record: DownloadRecord = {
    id: download._id.toString(),
    provider: download.provider,
    url: download.url,
    fileName: download.fileName,
    size: download.size,
    published: download.published ? download.published.toISOString() : null,
    downloaded: download.downloaded ? download.downloaded.toISOString() : null,
    name: download.name,
    tags: serializeTags(download.tags),
    status: download.status,
    bytesReceived: download.bytesReceived,
    expectedSize: download.expectedSize,
    errorMessage: download.errorMessage,
    analysisStatus,
    analysisProgressPercent: download.analysisProgressPercent ?? null,
    analysisStage: download.analysisStage ?? null,
    analysisErrorMessage: download.analysisErrorMessage ?? null,
    analyzed: download.analyzed ? download.analyzed.toISOString() : null,
    createdAt: download.createdAt.toISOString(),
    updatedAt: download.updatedAt.toISOString(),
  };

  return record;
}

function getDownloadContentType(fileName: string) {
  const extension = path.extname(fileName).toLowerCase();

  if (extension === ".mp4") {
    return "video/mp4";
  }

  return "application/octet-stream";
}

async function fetchDownloadRecord(downloadId: string) {
  const download = await Download.findById(downloadId)
    .populate("tags", "name")
    .exec();

  if (!download) {
    throw new ApiError(404, "Download record was not found.");
  }

  return serializeDownload({
    _id: download._id,
    provider: download.provider,
    url: download.url,
    fileName: download.fileName,
    size: download.size,
    published: download.published,
    downloaded: download.downloaded,
    name: download.name,
    tags: download.tags as Array<Types.ObjectId | PopulatedTag>,
    status: download.status,
    bytesReceived: download.bytesReceived,
    expectedSize: download.expectedSize,
    errorMessage: download.errorMessage,
    analysisStatus: download.analysisStatus,
    analysisProgressPercent: download.analysisProgressPercent,
    analysisStage: download.analysisStage,
    analysisErrorMessage: download.analysisErrorMessage,
    analyzed: download.analyzed,
    createdAt: download.createdAt,
    updatedAt: download.updatedAt,
  });
}

async function tryGetYouTubeMetadata(url: string) {
  try {
    const videoId = getYouTubeVideoId(url);

    if (!videoId) {
      return null;
    }

    const info = await getYouTubeBasicInfo(videoId);

    return {
      provider: "youtube" as const,
      name: normalizeWhitespace(info.basic_info.title ?? ""),
      published: resolvePublishedAt(info),
      tags: extractSuggestedTags(info),
    };
  } catch {
    return null;
  }
}

async function updateDownloadProgress(
  downloadId: string,
  bytesReceived: number,
  expectedSize: number | null
) {
  await Download.findByIdAndUpdate(downloadId, {
    $set: {
      status: "downloading",
      bytesReceived,
      expectedSize,
      errorMessage: null,
    },
  }).exec();
}

async function runQueuedDownload(downloadId: string) {
  await connectToDatabase();

  const download = await Download.findById(downloadId).exec();

  if (!download) {
    return;
  }

  let tempFilePath: string | null = null;
  let fileName = download.fileName;
  let bytesReceived = download.bytesReceived;
  let expectedSize = download.expectedSize;

  try {
    const { videoId } = assertSupportedProvider(download.url);
    const info = await getYouTubeBasicInfo(videoId);
    const metadataName = normalizeWhitespace(info.basic_info.title ?? "");
    const metadataPublished = resolvePublishedAt(info);
    const metadataTags = extractSuggestedTags(info);
    const resolvedName = download.name?.trim() || metadataName || null;
    const resolvedTagIds =
      download.tags.length > 0 ? download.tags : await resolveTagIds(metadataTags);
    const { stream, expectedSize: resolvedExpectedSize } =
      await getYouTubeDownloadResources(videoId);
    const extension = "mp4";
    const baseName = sanitizeFileStem(resolvedName || videoId);

    await ensureDirectoryExists(DOWNLOADS_DIRECTORY);
    fileName = await resolveUniqueFileName(baseName, extension);
    tempFilePath = path.join(DOWNLOADS_DIRECTORY, `${fileName}.part`);
    expectedSize = resolvedExpectedSize;

    download.name = resolvedName;
    download.tags = resolvedTagIds;
    download.fileName = fileName;
    download.published = metadataPublished ?? download.published;
    download.status = "downloading";
    download.bytesReceived = 0;
    download.expectedSize = expectedSize;
    download.errorMessage = null;
    await download.save();

    await createLogEntry({
      scope: DOWNLOAD_SCOPE,
      level: "info",
      message: "Download started.",
      downloadId,
      details: {
        provider: download.provider,
        url: download.url,
        fileName,
      },
    });

    const writeStream = createWriteStream(tempFilePath);
    let lastPersistedAt = 0;
    let lastProgressWrite = Promise.resolve();

    stream.on("data", (chunk: Uint8Array) => {
      const downloadedBytes = bytesReceived + chunk.length;
      const now = Date.now();

      bytesReceived = downloadedBytes;

      if (now - lastPersistedAt < 800 && (!expectedSize || downloadedBytes < expectedSize)) {
        return;
      }

      lastPersistedAt = now;
      lastProgressWrite = lastProgressWrite
        .catch(() => undefined)
        .then(() => updateDownloadProgress(downloadId, downloadedBytes, expectedSize));
    });

    await pipeline(stream, writeStream);
    await lastProgressWrite;

    const finalPath = path.join(DOWNLOADS_DIRECTORY, fileName);
    await rename(tempFilePath, finalPath);

    const fileStats = await stat(finalPath);
    download.size = fileStats.size;
    download.downloaded = new Date();
    download.status = "completed";
    download.bytesReceived = fileStats.size;
    download.expectedSize = fileStats.size;
    download.errorMessage = null;
    download.analysisStatus = "queued";
    download.analysisProgressPercent = 0;
    download.analysisStage = "Queued";
    download.analysisErrorMessage = null;
    download.analyzed = null;
    await download.save();

    await createLogEntry({
      scope: DOWNLOAD_SCOPE,
      level: "success",
      message: "Download completed.",
      downloadId,
      details: {
        provider: download.provider,
        url: download.url,
        fileName,
        size: fileStats.size,
      },
    });

    try {
      await startQueuedVideoAnalysis(
        downloadId,
        finalPath,
        download.url,
        download.provider
      );
    } catch (error) {
      const errorMessage = getErrorMessage(
        error,
        "Automatic video analysis could not be started."
      );
      const analysisAlreadyRunning =
        error instanceof ApiError && error.status === 409;

      if (!analysisAlreadyRunning) {
        await Download.findByIdAndUpdate(downloadId, {
          $set: {
            analysisStatus: "failed",
            analysisProgressPercent: null,
            analysisStage: "Analysis failed",
            analysisErrorMessage: errorMessage,
            analyzed: null,
          },
        })
          .exec()
          .catch(() => undefined);
      }

      await createLogEntry({
        scope: "video_analysis",
        level: analysisAlreadyRunning ? "info" : "error",
        message: analysisAlreadyRunning
          ? "Automatic video analysis was already queued."
          : "Automatic video analysis could not be started.",
        downloadId,
        details: {
          filePath: finalPath,
          error: errorMessage,
          automatic: true,
        },
      }).catch(() => undefined);
    }
  } catch (error) {
    if (tempFilePath) {
      await rm(tempFilePath, { force: true }).catch(() => undefined);
    }

    const errorMessage = getErrorMessage(error, "Download failed.");

    await Download.findByIdAndUpdate(downloadId, {
      $set: {
        status: "failed",
        fileName,
        bytesReceived,
        expectedSize,
        errorMessage,
      },
    }).exec();

    await createLogEntry({
      scope: DOWNLOAD_SCOPE,
      level: "error",
      message: errorMessage,
      downloadId,
      details: {
        provider: download.provider,
        url: download.url,
        fileName,
        bytesReceived,
        expectedSize,
        error: errorMessage,
      },
    });
  }
}

function startQueuedDownload(downloadId: string) {
  if (jobRegistry.has(downloadId)) {
    return;
  }

  const job = runQueuedDownload(downloadId).finally(() => {
    jobRegistry.delete(downloadId);
  });

  jobRegistry.set(downloadId, job);
}

export async function listDownloads() {
  await connectToDatabase();

  const downloads = await Download.find()
    .sort({ createdAt: -1 })
    .populate("tags", "name")
    .exec();

  return downloads.map((download) =>
    serializeDownload({
      _id: download._id,
      provider: download.provider,
      url: download.url,
      fileName: download.fileName,
      size: download.size,
      published: download.published,
      downloaded: download.downloaded,
      name: download.name,
      tags: download.tags as Array<Types.ObjectId | PopulatedTag>,
      status: download.status,
      bytesReceived: download.bytesReceived,
      expectedSize: download.expectedSize,
      errorMessage: download.errorMessage,
      analysisStatus: download.analysisStatus,
      analysisProgressPercent: download.analysisProgressPercent,
      analysisStage: download.analysisStage,
      analysisErrorMessage: download.analysisErrorMessage,
      analyzed: download.analyzed,
      createdAt: download.createdAt,
      updatedAt: download.updatedAt,
    })
  );
}

function formatProcessBytes(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "Calculating";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

export async function listActiveProcesses() {
  await connectToDatabase();

  const downloads = await Download.find({
    $or: [
      { status: { $in: ACTIVE_STATUSES } },
      { analysisStatus: { $in: ACTIVE_ANALYSIS_STATUSES } },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(10)
    .exec();

  const jobs: ActiveProcessRecord[] = [];

  for (const download of downloads) {
    const analysisStatus = download.analysisStatus ?? "not_started";

    if (ACTIVE_STATUSES.includes(download.status as (typeof ACTIVE_STATUSES)[number])) {
      const progressPercent =
        download.expectedSize && download.expectedSize > 0
          ? Math.min(
            100,
            Math.round((download.bytesReceived / download.expectedSize) * 100)
          )
          : null;

      jobs.push({
        id: download._id.toString(),
        kind: "download",
        name: download.name,
        status: download.status === "queued" ? "queued" : "running",
        progressPercent,
        statusLabel: download.status === "queued" ? "Download queued" : "Downloading",
        detailText: `${formatProcessBytes(download.bytesReceived)}${download.expectedSize ? ` / ${formatProcessBytes(download.expectedSize)}` : ""}`,
      });
    }

    if (
      ACTIVE_ANALYSIS_STATUSES.includes(
        analysisStatus as (typeof ACTIVE_ANALYSIS_STATUSES)[number]
      )
    ) {
      jobs.push({
        id: download._id.toString(),
        kind: "analysis",
        name: download.name,
        status: analysisStatus === "queued" ? "queued" : "running",
        progressPercent: download.analysisProgressPercent ?? null,
        statusLabel:
          analysisStatus === "queued"
            ? "Analysis queued"
            : download.analysisStage || "Analyzing video",
        detailText:
          analysisStatus === "queued"
            ? "Waiting for the analysis worker."
            : "Video analysis pipeline",
      });
    }
  }

  return jobs;
}

export async function getDownloadMetadata(url: string) {
  const normalizedUrl = normalizeWhitespace(url);

  if (!normalizedUrl) {
    throw new ApiError(400, "A video URL is required.");
  }

  const { videoId } = assertSupportedProvider(normalizedUrl);

  try {
    const info = await getYouTubeBasicInfo(videoId);
    const metadata: DownloadMetadataResponse = {
      provider: "youtube",
      name: normalizeWhitespace(info.basic_info.title ?? "") || null,
      tags: extractSuggestedTags(info),
    };

    return metadata;
  } catch (error) {
    throw new ApiError(
      400,
      getErrorMessage(error, "Unable to fetch metadata for this YouTube video.")
    );
  }
}

export async function enqueueDownload(input: {
  url: string;
  name?: string;
  tagNames?: string[];
}) {
  await connectToDatabase();

  const url = normalizeWhitespace(input.url);
  const suppliedName = input.name ? normalizeWhitespace(input.name) : "";
  const suppliedTagNames = (input.tagNames ?? []).map(cleanTagName).filter(Boolean);

  if (!url) {
    throw new ApiError(400, "A video URL is required.");
  }

  const { provider } = assertSupportedProvider(url);
  const metadata = await tryGetYouTubeMetadata(url);
  const resolvedName = suppliedName || metadata?.name || null;
  const resolvedTagNames =
    suppliedTagNames.length > 0 ? suppliedTagNames : metadata?.tags ?? [];
  const tagIds = await resolveTagIds(resolvedTagNames);

  const download = await Download.create({
    provider,
    url,
    name: resolvedName,
    tags: tagIds,
    status: "queued",
    fileName: null,
    size: null,
    published: metadata?.published ?? null,
    downloaded: null,
    bytesReceived: 0,
    expectedSize: null,
    errorMessage: null,
  });

  await createLogEntry({
    scope: DOWNLOAD_SCOPE,
    level: "info",
    message: "Download queued.",
    downloadId: download._id.toString(),
    details: {
      provider,
      url,
      name: resolvedName,
      tags: resolvedTagNames,
    },
  });

  startQueuedDownload(download._id.toString());

  return fetchDownloadRecord(download._id.toString());
}

export async function updateDownload(
  downloadId: string,
  input: {
    tagNames?: string[];
    published?: string | null;
  }
) {
  await connectToDatabase();

  if (!Types.ObjectId.isValid(downloadId)) {
    throw new ApiError(400, "Invalid download id.");
  }

  const download = await Download.findById(downloadId).exec();

  if (!download) {
    throw new ApiError(404, "Download record was not found.");
  }

  if (input.tagNames !== undefined) {
    download.tags = await resolveTagIds(input.tagNames);
  }

  if (input.published !== undefined) {
    download.published = parsePublishedTimestamp(input.published) ?? null;
  }

  await download.save();

  return fetchDownloadRecord(downloadId);
}

export async function deleteDownloads(ids: string[]) {
  await connectToDatabase();

  const validIds = ids.filter((id) => Types.ObjectId.isValid(id));

  if (validIds.length === 0) {
    throw new ApiError(400, "Select at least one download to delete.");
  }

  const downloads = await Download.find({
    _id: { $in: validIds.map((id) => new Types.ObjectId(id)) },
  }).exec();

  if (downloads.length === 0) {
    return [] as string[];
  }

  const activeDownloads = downloads.filter((download) =>
    ACTIVE_STATUSES.includes(download.status as (typeof ACTIVE_STATUSES)[number])
  );
  const activeAnalyses = downloads.filter((download) =>
    ACTIVE_ANALYSIS_STATUSES.includes(
      (download.analysisStatus ?? "not_started") as (typeof ACTIVE_ANALYSIS_STATUSES)[number]
    )
  );

  if (activeDownloads.length > 0) {
    throw new ApiError(
      409,
      "Active downloads cannot be deleted while they are still running."
    );
  }

  if (activeAnalyses.length > 0) {
    throw new ApiError(
      409,
      "Active analyses cannot be deleted while they are still running."
    );
  }

  for (const download of downloads) {
    if (download.fileName) {
      const localFilePath = path.join(
        DOWNLOADS_DIRECTORY,
        path.basename(download.fileName)
      );

      await rm(localFilePath, { force: true }).catch(() => undefined);
    }

    await deleteVideoAnalysisArtifacts(download._id.toString());

    await createLogEntry({
      scope: DOWNLOAD_SCOPE,
      level: "info",
      message: "Download deleted.",
      downloadId: download._id.toString(),
      details: {
        provider: download.provider,
        url: download.url,
        fileName: download.fileName,
      },
    });
  }

  await Download.deleteMany({
    _id: { $in: downloads.map((download) => download._id) },
  }).exec();

  return downloads.map((download) => download._id.toString());
}

export async function getDownloadFileDetails(downloadId: string) {
  await connectToDatabase();

  if (!Types.ObjectId.isValid(downloadId)) {
    throw new ApiError(400, "Invalid download id.");
  }

  const download = await Download.findById(downloadId).exec();

  if (!download) {
    throw new ApiError(404, "Download record was not found.");
  }

  if (download.status !== "completed" || !download.fileName) {
    throw new ApiError(409, "This download is not ready to play yet.");
  }

  const filePath = path.join(
    DOWNLOADS_DIRECTORY,
    path.basename(download.fileName)
  );

  let fileStats;

  try {
    fileStats = await stat(filePath);
  } catch {
    throw new ApiError(404, "Downloaded file was not found in storage.");
  }

  return {
    filePath,
    fileName: download.fileName,
    contentType: getDownloadContentType(download.fileName),
    size: fileStats.size,
  };
}