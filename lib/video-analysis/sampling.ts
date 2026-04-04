function asPositiveFiniteNumber(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  return value;
}

export function resolvePreferredVideoDurationSec(input: {
  videoStreamDurationSec: number | null;
  formatDurationSec: number | null;
}) {
  return (
    asPositiveFiniteNumber(input.videoStreamDurationSec) ??
    asPositiveFiniteNumber(input.formatDurationSec) ??
    0
  );
}

export function getSafeTailPaddingSec(durationSec: number) {
  const normalizedDurationSec = asPositiveFiniteNumber(durationSec) ?? 0;

  return Math.min(0.25, Math.max(0.1, normalizedDurationSec * 0.02));
}

export function clampFrameTimestamp(timestampSec: number, durationSec: number) {
  const safeTailPaddingSec = getSafeTailPaddingSec(durationSec);

  if (durationSec <= safeTailPaddingSec) {
    return 0;
  }

  return Math.max(0, Math.min(timestampSec, durationSec - safeTailPaddingSec));
}

export function getMinimumRepresentativeFrameCount(durationSec: number) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return 5;
  }

  return Math.min(10, Math.max(5, Math.ceil(durationSec / 2.5)));
}