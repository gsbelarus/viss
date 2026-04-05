import assert from "node:assert/strict";
import test from "node:test";

import { getYouTubePublishedAt } from "../lib/youtube";

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