import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

import { ApiError } from "@/lib/api-utils";
import { resolvePreferredVideoDurationSec } from "@/lib/video-analysis/sampling";
import type { MediaMetadataRecord } from "@/lib/video-analysis-shared";

type CommandLogger = (message: string, details?: Record<string, unknown>) => Promise<void> | void;

interface CommandResult {
  stdout: Buffer;
  stderr: Buffer;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  duration?: string;
}

interface FfprobeFormat {
  duration?: string;
  size?: string;
  bit_rate?: string;
}

interface FfprobePayload {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

function formatCommand(command: string, args: string[]) {
  return [command, ...args.map((value) => (value.includes(" ") ? `"${value}"` : value))].join(" ");
}

async function runCommand(
  command: string,
  args: string[],
  logger?: CommandLogger
) {
  if (logger) {
    await logger("Running subprocess command.", {
      command: formatCommand(command, args),
    });
  }

  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks);

      if (code !== 0) {
        const stderrText = stderr.toString("utf8").trim();

        reject(
          new Error(
            stderrText || `${command} exited with code ${code ?? "unknown"}.`
          )
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function parseFraction(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const [numeratorText, denominatorText] = value.split("/");
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText ?? "1");

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

function parseNullableNumber(value: string | undefined) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toSecondsArg(timestampSec: number) {
  return Math.max(0, timestampSec).toFixed(3);
}

export async function probeVideo(
  filePath: string,
  logger?: CommandLogger
): Promise<MediaMetadataRecord> {
  const fileStats = await stat(filePath).catch(() => null);

  if (!fileStats || !fileStats.isFile()) {
    throw new ApiError(404, "Video file was not found.");
  }

  if (fileStats.size <= 0) {
    throw new ApiError(400, "Video file is empty.");
  }

  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ];
  const { stdout } = await runCommand("ffprobe", args, logger);
  const payload = JSON.parse(stdout.toString("utf8")) as FfprobePayload;
  const videoStream = payload.streams?.find((stream) => stream.codec_type === "video");
  const audioStream = payload.streams?.find((stream) => stream.codec_type === "audio");

  if (!videoStream) {
    throw new ApiError(400, "The supplied file does not contain a supported video stream.");
  }

  const durationSec = resolvePreferredVideoDurationSec({
    videoStreamDurationSec: parseNullableNumber(videoStream.duration),
    formatDurationSec: parseNullableNumber(payload.format?.duration),
  });

  return {
    durationSec,
    width: videoStream.width ?? 0,
    height: videoStream.height ?? 0,
    fps: parseFraction(videoStream.avg_frame_rate),
    videoCodec: videoStream.codec_name ?? null,
    audioPresent: Boolean(audioStream),
    audioCodec: audioStream?.codec_name ?? null,
    bitrate: parseNullableNumber(payload.format?.bit_rate),
    fileSizeBytes: fileStats.size,
  };
}

export async function extractAudioTrack(
  filePath: string,
  outputPath: string,
  logger?: CommandLogger
) {
  const args = [
    "-loglevel",
    "error",
    "-y",
    "-i",
    filePath,
    "-vn",
    "-acodec",
    "pcm_s16le",
    "-ar",
    "16000",
    "-ac",
    "1",
    outputPath,
  ];

  await runCommand("ffmpeg", args, logger);

  return outputPath;
}

export async function extractStillFrame(
  filePath: string,
  timestampSec: number,
  outputPath: string,
  logger?: CommandLogger
) {
  const args = [
    "-loglevel",
    "error",
    "-y",
    "-ss",
    toSecondsArg(timestampSec),
    "-i",
    filePath,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    outputPath,
  ];

  await runCommand("ffmpeg", args, logger);

  return outputPath;
}

export async function readFrameFingerprint(
  filePath: string,
  timestampSec: number,
  logger?: CommandLogger
) {
  const args = [
    "-loglevel",
    "error",
    "-ss",
    toSecondsArg(timestampSec),
    "-i",
    filePath,
    "-frames:v",
    "1",
    "-vf",
    "scale=8:8,format=gray",
    "-f",
    "rawvideo",
    "pipe:1",
  ];
  const { stdout } = await runCommand("ffmpeg", args, logger);

  if (stdout.length === 0) {
    throw new Error(`Unable to extract frame fingerprint at ${timestampSec.toFixed(2)}s.`);
  }

  return stdout;
}

export async function readFrameHistogramData(
  framePath: string,
  logger?: CommandLogger
) {
  const args = [
    "-loglevel",
    "error",
    "-i",
    framePath,
    "-frames:v",
    "1",
    "-vf",
    "scale=32:32,format=gray",
    "-f",
    "rawvideo",
    "pipe:1",
  ];
  const { stdout } = await runCommand("ffmpeg", args, logger);

  if (stdout.length === 0) {
    throw new Error(`Unable to read histogram data for ${path.basename(framePath)}.`);
  }

  return stdout;
}