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

export interface TimestampScoreCandidate {
  timestampSec: number;
  score: number | null;
}

function isTimestampNear(
  timestamps: number[],
  candidateTimestampSec: number,
  minimumSpacingSec: number
) {
  return timestamps.some(
    (timestampSec) => Math.abs(timestampSec - candidateTimestampSec) < minimumSpacingSec
  );
}

export function getLateCoverageCandidateTimestamps(
  durationSec: number,
  sceneCandidates: TimestampScoreCandidate[]
) {
  const normalizedDurationSec = asPositiveFiniteNumber(durationSec) ?? 0;

  if (normalizedDurationSec <= 0) {
    return [0];
  }

  const minimumSpacingSec = normalizedDurationSec <= 8 ? 0.2 : 0.35;
  const timestamps: number[] = [];
  const latestCandidate = [...sceneCandidates].sort(
    (left, right) => right.timestampSec - left.timestampSec
  )[0];

  if (latestCandidate) {
    timestamps.push(
      clampFrameTimestamp(latestCandidate.timestampSec, normalizedDurationSec)
    );
  }

  const lateCoverageCandidates = [...sceneCandidates]
    .filter((candidate) => candidate.timestampSec >= normalizedDurationSec * 0.72)
    .sort((left, right) => {
      const scoreDifference = (right.score ?? 0) - (left.score ?? 0);

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return left.timestampSec - right.timestampSec;
    });

  for (const candidate of lateCoverageCandidates) {
    const timestampSec = clampFrameTimestamp(candidate.timestampSec, normalizedDurationSec);

    if (isTimestampNear(timestamps, timestampSec, minimumSpacingSec)) {
      continue;
    }

    timestamps.push(timestampSec);

    if (timestamps.length >= 3) {
      break;
    }
  }

  if (timestamps.length === 0) {
    timestamps.push(clampFrameTimestamp(normalizedDurationSec * 0.96, normalizedDurationSec));
  }

  return timestamps.sort((left, right) => left - right);
}