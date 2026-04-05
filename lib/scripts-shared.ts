import type { DownloadAnalysisStatus } from "@/lib/video-analysis-shared";

export const SCRIPT_LANGUAGES = [
  "english",
  "spanish",
  "portuguese",
  "french",
  "german",
  "italian",
  "polish",
  "russian",
  "turkish",
  "ukrainian",
] as const;

export type ScriptLanguage = (typeof SCRIPT_LANGUAGES)[number];

export const SCRIPT_LANGUAGE_LABELS: Record<ScriptLanguage, string> = {
  english: "English",
  spanish: "Spanish",
  portuguese: "Portuguese",
  french: "French",
  german: "German",
  italian: "Italian",
  polish: "Polish",
  russian: "Russian",
  turkish: "Turkish",
  ukrainian: "Ukrainian",
};

export interface ScriptDocumentData {
  name: string;
  basedOnDownloadIds: string[];
  language: ScriptLanguage;
  durationSec: number | null;
  content: string;
  generatedScript: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type ScriptMutationInput = Omit<ScriptDocumentData, "createdAt" | "updatedAt">;

export type ScriptGenerationInput = Omit<ScriptMutationInput, "generatedScript">;

export interface ScriptSourceVideoRecord {
  id: string;
  name: string;
  description: string | null;
  fileName: string | null;
  published: string | null;
  analysisStatus: DownloadAnalysisStatus;
  analysisReady: boolean;
}

export interface ScriptListRecord {
  id: string;
  name: string;
  basedOn: ScriptSourceVideoRecord[];
  language: ScriptLanguage;
  durationSec: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptDetailRecord extends ScriptListRecord {
  content: string;
  generatedScript: string | null;
}

export interface ScriptsListResponse {
  scripts: ScriptListRecord[];
}

export interface ScriptDetailResponse {
  script: ScriptDetailRecord;
}

export interface ScriptMutationResponse {
  script: ScriptDetailRecord;
  message: string;
}

export interface ScriptDeleteResponse {
  deletedId: string;
  message: string;
}

export interface ScriptGenerateResponse {
  generatedScript: string;
  message: string;
}
