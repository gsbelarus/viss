import { ApiError, isRecord, toNonEmptyString } from "@/lib/api-utils";
import {
  SCRIPT_LANGUAGES,
  type ScriptGenerationInput,
  type ScriptLanguage,
  type ScriptMutationInput,
} from "@/lib/scripts-shared";

interface ScriptMutationRequestBody {
  name?: unknown;
  basedOnDownloadIds?: unknown;
  language?: unknown;
  durationSec?: unknown;
  content?: unknown;
  generatedScript?: unknown;
}

interface ScriptGenerationRequestBody {
  name?: unknown;
  basedOnDownloadIds?: unknown;
  language?: unknown;
  durationSec?: unknown;
  content?: unknown;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.toLowerCase()))).map((normalized) => {
    const original = values.find((value) => value.toLowerCase() === normalized);
    return original ?? normalized;
  });
}

function parseBasedOnDownloadIds(value: unknown) {
  if (value === undefined) {
    return [] as string[];
  }

  if (!Array.isArray(value)) {
    throw new ApiError(400, "Based On must be an array of download ids.");
  }

  return uniqueStrings(value.map((entry) => toNonEmptyString(entry)).filter(Boolean));
}

function parseScriptLanguage(value: unknown): ScriptLanguage {
  const language = toNonEmptyString(value).toLowerCase() as ScriptLanguage;

  if (!SCRIPT_LANGUAGES.includes(language)) {
    throw new ApiError(400, "Language must be one of the supported script languages.");
  }

  return language;
}

function parseDurationSec(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const parsedValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    throw new ApiError(400, "Duration must be a positive number of seconds or null.");
  }

  return Math.round(parsedValue);
}

function parseRequiredText(value: unknown, label: string) {
  const parsedValue = toNonEmptyString(value);

  if (!parsedValue) {
    throw new ApiError(400, `${label} is required.`);
  }

  return parsedValue;
}

function parseOptionalText(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  const parsedValue = toNonEmptyString(value);

  return parsedValue || null;
}

export function parseScriptMutationBody(body: unknown): ScriptMutationInput {
  if (!isRecord(body)) {
    throw new ApiError(400, "Invalid JSON request body.");
  }

  const requestBody = body as ScriptMutationRequestBody;

  return {
    name: parseRequiredText(requestBody.name, "Name"),
    basedOnDownloadIds: parseBasedOnDownloadIds(requestBody.basedOnDownloadIds),
    language: parseScriptLanguage(requestBody.language),
    durationSec: parseDurationSec(requestBody.durationSec),
    content: parseRequiredText(requestBody.content, "Script Content"),
    generatedScript: parseOptionalText(requestBody.generatedScript),
  };
}

export function parseScriptGenerationBody(body: unknown): ScriptGenerationInput {
  if (!isRecord(body)) {
    throw new ApiError(400, "Invalid JSON request body.");
  }

  const requestBody = body as ScriptGenerationRequestBody;

  return {
    name: parseRequiredText(requestBody.name, "Name"),
    basedOnDownloadIds: parseBasedOnDownloadIds(requestBody.basedOnDownloadIds),
    language: parseScriptLanguage(requestBody.language),
    durationSec: parseDurationSec(requestBody.durationSec),
    content: parseRequiredText(requestBody.content, "Script Content"),
  };
}
