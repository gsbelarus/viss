import assert from "node:assert/strict";
import test from "node:test";

import {
  clampFrameTimestamp,
  getLateCoverageCandidateTimestamps,
  getMinimumRepresentativeFrameCount,
  getSafeTailPaddingSec,
  resolvePreferredVideoDurationSec,
} from "../lib/video-analysis/sampling";

test("probe duration prefers the video stream duration when it is available", () => {
  const durationSec = resolvePreferredVideoDurationSec({
    videoStreamDurationSec: 10.666667,
    formatDurationSec: 10.709333,
  });

  assert.equal(durationSec, 10.666667);
});

test("near-EOF frame timestamps are clamped away from the container tail", () => {
  const durationSec = 10.666667;
  const tailPaddingSec = getSafeTailPaddingSec(durationSec);
  const clampedTimestampSec = clampFrameTimestamp(durationSec, durationSec);

  assert.equal(tailPaddingSec, durationSec * 0.02);
  assert.equal(clampedTimestampSec, durationSec - tailPaddingSec);
  assert.ok(clampedTimestampSec < durationSec);
});

test("short videos accept fewer deduplicated representative frames", () => {
  assert.equal(getMinimumRepresentativeFrameCount(10.666667), 5);
  assert.equal(getMinimumRepresentativeFrameCount(5), 5);
  assert.equal(getMinimumRepresentativeFrameCount(30), 10);
});

test("format duration is used only when the video stream duration is unavailable", () => {
  const durationSec = resolvePreferredVideoDurationSec({
    videoStreamDurationSec: null,
    formatDurationSec: 12.4,
  });

  assert.equal(durationSec, 12.4);
});

test("late coverage targets preserve the ending reveal and a strong late-scene pivot", () => {
  const timestamps = getLateCoverageCandidateTimestamps(50, [
    { timestampSec: 21.6, score: 0.24 },
    { timestampSec: 25.8, score: 0.33 },
    { timestampSec: 33, score: 0.4 },
    { timestampSec: 40.2, score: 0.54 },
    { timestampSec: 40.8, score: 0.45 },
    { timestampSec: 49.8, score: 0.19 },
    { timestampSec: 49.95, score: 0.22 },
  ]);

  assert.ok(timestamps.some((timestampSec) => Math.abs(timestampSec - 40.2) < 0.01));
  assert.ok(timestamps.some((timestampSec) => Math.abs(timestampSec - 49.95) < 0.3));
});