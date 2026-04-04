export type LogLevel = "info" | "success" | "error";

export interface LogRecord {
  id: string;
  scope: string;
  level: LogLevel;
  message: string;
  details: Record<string, unknown> | null;
  downloadId: string | null;
  createdAt: string;
}

export interface LogsListResponse {
  logs: LogRecord[];
}