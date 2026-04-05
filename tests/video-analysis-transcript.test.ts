import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateTranscriptSupportScore,
  finalizeTranscriptCandidate,
} from "../lib/video-analysis/transcript";

test("suppresses sparse transcript when no-speech and audio evidence disagree with dialogue", () => {
  const transcript = finalizeTranscriptCandidate(
    {
      provider: "openai",
      language: "en",
      text: "How about boys and girls like you and me! Okay, bye!",
      segments: [
        {
          startSec: 4.9,
          endSec: 5.8,
          text: "How about boys and girls like you and me! Okay, bye!",
          avgLogprob: -0.92,
          compressionRatio: 2.65,
          noSpeechProb: 0.87,
        },
      ],
    },
    {
      durationSec: 8,
      audioSpeechLikelihoodScore: 0.18,
      audioSpeechPresentLikely: false,
    }
  );

  assert.equal(transcript.status, "skipped");
  assert.equal(transcript.text, null);
  assert.ok(transcript.suppressionReason);
  assert.equal(transcript.audibleSpeechLikely, false);
});

test("keeps transcript when segment support and audio evidence suggest actual speech", () => {
  const transcript = finalizeTranscriptCandidate(
    {
      provider: "openai",
      language: "en",
      text: "Today I am going to show you what school feels like after childhood ends.",
      segments: [
        {
          startSec: 0.4,
          endSec: 2.6,
          text: "Today I am going to show you what school feels like",
          avgLogprob: -0.18,
          compressionRatio: 1.41,
          noSpeechProb: 0.04,
        },
        {
          startSec: 2.8,
          endSec: 4.1,
          text: "after childhood ends.",
          avgLogprob: -0.12,
          compressionRatio: 1.36,
          noSpeechProb: 0.03,
        },
      ],
    },
    {
      durationSec: 6,
      audioSpeechLikelihoodScore: 0.61,
      audioSpeechPresentLikely: true,
    }
  );

  assert.equal(transcript.status, "completed");
  assert.ok(transcript.text);
  assert.equal(transcript.suppressionReason, null);
  assert.equal(transcript.audibleSpeechLikely, true);
  assert.ok((transcript.confidence ?? 0) > 0.6);
});

test("support score drops for segments dominated by no-speech signals", () => {
  const support = calculateTranscriptSupportScore(
    "Short phrase",
    [
      {
        startSec: 1,
        endSec: 1.5,
        text: "Short phrase",
        avgLogprob: -0.95,
        compressionRatio: 2.7,
        noSpeechProb: 0.9,
      },
    ],
    6
  );

  assert.ok(support < 0.4);
});

test("suppresses a long low-density hallucinated segment even when audio has music energy", () => {
  const transcript = finalizeTranscriptCandidate(
    {
      provider: "openai",
      language: "english",
      text: "The Favourite",
      segments: [
        {
          startSec: 0,
          endSec: 7.92,
          text: "The Favourite",
          avgLogprob: -2.9472,
          compressionRatio: 0.619,
          noSpeechProb: 0.2799,
        },
      ],
    },
    {
      durationSec: 7.92,
      audioSpeechLikelihoodScore: 0.43,
      audioSpeechPresentLikely: false,
    }
  );

  assert.equal(transcript.status, "skipped");
  assert.equal(transcript.text, null);
  assert.equal(transcript.audibleSpeechLikely, false);
  assert.ok((transcript.confidence ?? 1) < 0.35);
});

test("suppresses a five-word low-density hallucinated segment spanning the full clip", () => {
  const transcript = finalizeTranscriptCandidate(
    {
      provider: "openai",
      language: "english",
      text: "I'm watching A Little Flip.",
      segments: [
        {
          startSec: 0,
          endSec: 10.72,
          text: "I'm watching A Little Flip.",
          avgLogprob: -3.3431,
          compressionRatio: 0.7714,
          noSpeechProb: 0.2799,
        },
      ],
    },
    {
      durationSec: 10.72,
      audioSpeechLikelihoodScore: 0.49,
      audioSpeechPresentLikely: false,
    }
  );

  assert.equal(transcript.status, "skipped");
  assert.equal(transcript.text, null);
  assert.equal(transcript.audibleSpeechLikely, false);
  assert.ok((transcript.confidence ?? 1) < 0.25);
});
