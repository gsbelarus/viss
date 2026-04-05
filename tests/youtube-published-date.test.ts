import assert from "node:assert/strict";
import test from "node:test";

import { getYouTubePublishedAt, resolveYouTubeDownloadOption } from "../lib/youtube";

test("published date prefers microformat publish_date", () => {
  const publishedAt = getYouTubePublishedAt({
    basic_info: {
      start_timestamp: null,
    },
    page: [
      {
        microformat: {
          publish_date: "2024-01-15",
          upload_date: "2024-01-10",
        },
      },
    ],
  } as Awaited<ReturnType<typeof import("../lib/youtube").getYouTubeBasicInfo>>);

  assert.equal(publishedAt?.toISOString(), "2024-01-15T00:00:00.000Z");
});

test("published date falls back to upload_date when publish_date is missing", () => {
  const publishedAt = getYouTubePublishedAt({
    basic_info: {
      start_timestamp: null,
    },
    page: [
      {
        microformat: {
          upload_date: "2024-02-03",
        },
      },
    ],
  } as Awaited<ReturnType<typeof import("../lib/youtube").getYouTubeBasicInfo>>);

  assert.equal(publishedAt?.toISOString(), "2024-02-03T00:00:00.000Z");
});

test("published date falls back to start_timestamp when date strings are unavailable", () => {
  const startTimestamp = new Date("2024-03-04T05:06:07.000Z");
  const publishedAt = getYouTubePublishedAt({
    basic_info: {
      start_timestamp: startTimestamp,
    },
    page: [
      {
        microformat: {},
      },
    ],
  } as Awaited<ReturnType<typeof import("../lib/youtube").getYouTubeBasicInfo>>);

  assert.equal(publishedAt?.toISOString(), startTimestamp.toISOString());
});

test("download format resolution falls back when 360p mp4 is unavailable", async () => {
  const seenQualities: string[] = [];

  const result = await resolveYouTubeDownloadOption(async (options) => {
    seenQualities.push(options.quality ?? "unknown");

    if (options.quality === "360p") {
      throw new Error("No matching formats found");
    }

    return {
      itag: 18,
      quality_label: "480p",
      mime_type: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"',
      content_length: 123,
    } as never;
  });

  assert.deepEqual(seenQualities, ["360p", "best"]);
  assert.equal(result.options.quality, "best");
  assert.equal((result.format as { quality_label?: string }).quality_label, "480p");
});

test("download format resolution rethrows non-format errors", async () => {
  await assert.rejects(
    () =>
      resolveYouTubeDownloadOption(async () => {
        throw new Error("This video is unavailable");
      }),
    /This video is unavailable/
  );
});