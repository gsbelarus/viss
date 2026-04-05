import assert from "node:assert/strict";
import test from "node:test";

import {
  clampFrameTimestamp,
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