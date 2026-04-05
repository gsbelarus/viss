import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import vm from "node:vm";

import { Innertube, Platform, UniversalCache } from "youtubei.js";

interface YouTubeDownloadOptions {
  type: "video+audio";
  quality: string;
  format: "mp4";
}

interface YouTubeDownloadFormat {
  content_length?: number;
}

const YOUTUBE_DOWNLOAD_OPTION_CANDIDATES = [
  {
    type: "video+audio",
    quality: "360p",
    format: "mp4",
  },
  {
    type: "video+audio",
    quality: "best",
    format: "mp4",
  },
] as const satisfies ReadonlyArray<YouTubeDownloadOptions>;

declare global {
  var __vissYouTubeClientPromise: Promise<Innertube> | undefined;
  var __vissYouTubeEvaluatorInstalled: boolean | undefined;
}

function installEvaluator() {
  const globalForYouTube = globalThis as typeof globalThis & {
    __vissYouTubeEvaluatorInstalled?: boolean;
  };

  if (globalForYouTube.__vissYouTubeEvaluatorInstalled) {
    return;
  }

  Platform.load({
    ...Platform.shim,
    eval: (data, env) =>
      vm.runInNewContext(`(function(){\n${data.output}\n})()`, { ...env }, {
        timeout: 1000,
      }),
  });

  globalForYouTube.__vissYouTubeEvaluatorInstalled = true;
}

export function getYouTubeVideoId(urlString: string) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/^www\./, "");

    if (hostname === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] ?? null;
    }

    if (!hostname.endsWith("youtube.com")) {
      return null;
    }

    if (url.pathname === "/watch") {
      return url.searchParams.get("v");
    }

    const segments = url.pathname.split("/").filter(Boolean);

    if (["shorts", "embed", "live"].includes(segments[0] ?? "")) {
      return segments[1] ?? null;
    }

    return null;
  } catch {
    return null;
  }
}

export async function getYouTubeClient() {
  installEvaluator();

  const globalForYouTube = globalThis as typeof globalThis & {
    __vissYouTubeClientPromise?: Promise<Innertube>;
  };

  if (!globalForYouTube.__vissYouTubeClientPromise) {
    globalForYouTube.__vissYouTubeClientPromise = Innertube.create({
      generate_session_locally: true,
      cache: new UniversalCache(false),
    });
  }

  return globalForYouTube.__vissYouTubeClientPromise;
}

export async function getYouTubeBasicInfo(videoId: string) {
  const client = await getYouTubeClient();
  return client.getBasicInfo(videoId);
}

function parseYouTubeDate(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  const candidate = /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)
    ? `${normalizedValue}T00:00:00.000Z`
    : normalizedValue;
  const parsedValue = new Date(candidate);

  return Number.isNaN(parsedValue.getTime()) ? null : parsedValue;
}

export function getYouTubePublishedAt(info: Awaited<ReturnType<typeof getYouTubeBasicInfo>>) {
  const playerResponse = info.page[0];
  const microformat = playerResponse?.microformat;

  if (!microformat || typeof microformat !== "object") {
    return info.basic_info.start_timestamp ?? null;
  }

  const metadata = microformat as {
    publish_date?: unknown;
    upload_date?: unknown;
    start_timestamp?: unknown;
  };

  return (
    parseYouTubeDate(metadata.publish_date) ??
    parseYouTubeDate(metadata.upload_date) ??
    parseYouTubeDate(metadata.start_timestamp) ??
    info.basic_info.start_timestamp ??
    null
  );
}

function isNoMatchingFormatError(error: unknown) {
  return error instanceof Error && /no matching formats found/i.test(error.message);
}

export async function resolveYouTubeDownloadOption(
  resolveFormat: (options: YouTubeDownloadOptions) => Promise<YouTubeDownloadFormat>
) {
  let lastFormatError: Error | null = null;

  for (const options of YOUTUBE_DOWNLOAD_OPTION_CANDIDATES) {
    try {
      const format = await resolveFormat(options);

      return {
        options,
        format,
      };
    } catch (error) {
      if (!isNoMatchingFormatError(error)) {
        throw error;
      }

      lastFormatError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastFormatError ?? new Error("No matching formats found");
}

export async function getYouTubeDownloadResources(videoId: string) {
  const client = await getYouTubeClient();
  const { format, options } = await resolveYouTubeDownloadOption((candidate) =>
    client.getStreamingData(videoId, candidate)
  );
  const stream = await client.download(videoId, options);

  return {
    stream: Readable.fromWeb(stream as unknown as WebReadableStream<Uint8Array>),
    expectedSize:
      typeof format.content_length === "number" ? format.content_length : null,
  };
}