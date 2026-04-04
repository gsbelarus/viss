export type VideoProvider = "youtube";

import type { DownloadAnalysisStatus } from "@/lib/video-analysis-shared";

export type DownloadStatus =
  | "queued"
  | "downloading"
  | "completed"
  | "failed";

export interface TagReference {
  id: string;
  name: string;
}

export interface DownloadRecord {
  id: string;
  provider: VideoProvider;
  url: string;
  fileName: string | null;
  size: number | null;
  downloaded: string | null;
  name: string | null;
  tags: TagReference[];
  status: DownloadStatus;
  bytesReceived: number;
  expectedSize: number | null;
  errorMessage: string | null;
  analysisStatus: DownloadAnalysisStatus;
  analysisProgressPercent: number | null;
  analysisStage: string | null;
  analysisErrorMessage: string | null;
  analyzed: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DownloadsListResponse {
  downloads: DownloadRecord[];
}

export interface DownloadMutationResponse {
  download: DownloadRecord;
  message: string;
}

export interface DownloadDeleteResponse {
  deletedIds: string[];
  message: string;
}

export interface DownloadMetadataResponse {
  provider: VideoProvider;
  name: string | null;
  tags: string[];
}

export interface ActiveDownloadRecord {
  id: string;
  provider: VideoProvider;
  name: string | null;
  status: Extract<DownloadStatus, "queued" | "downloading">;
  bytesReceived: number;
  expectedSize: number | null;
  progressPercent: number | null;
}

export interface ActiveDownloadsResponse {
  jobs: ActiveDownloadRecord[];
}