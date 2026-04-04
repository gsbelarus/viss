import { Types } from "mongoose";

import type { LogLevel, LogRecord } from "@/lib/logs-shared";
import { connectToDatabase } from "@/lib/mongodb";
import { LogEntry } from "@/models/log-entry";

interface CreateLogEntryInput {
  scope: string;
  level: LogLevel;
  message: string;
  downloadId?: string | null;
  details?: Record<string, unknown> | null;
}

function serializeLogEntry(entry: {
  _id: Types.ObjectId;
  scope: string;
  level: LogLevel;
  message: string;
  details: Record<string, unknown> | null;
  download: Types.ObjectId | null;
  createdAt: Date;
}) {
  const record: LogRecord = {
    id: entry._id.toString(),
    scope: entry.scope,
    level: entry.level,
    message: entry.message,
    details: entry.details,
    downloadId: entry.download ? entry.download.toString() : null,
    createdAt: entry.createdAt.toISOString(),
  };

  return record;
}

export async function createLogEntry(input: CreateLogEntryInput) {
  await connectToDatabase();

  await LogEntry.create({
    scope: input.scope,
    level: input.level,
    message: input.message,
    download: input.downloadId ? new Types.ObjectId(input.downloadId) : null,
    details: input.details ?? null,
  });
}

export async function listLogs() {
  await connectToDatabase();

  const entries = await LogEntry.find()
    .sort({ createdAt: -1 })
    .limit(250)
    .lean()
    .exec();

  return entries.map((entry) =>
    serializeLogEntry({
      _id: entry._id,
      scope: entry.scope,
      level: entry.level,
      message: entry.message,
      details: entry.details as Record<string, unknown> | null,
      download: (entry.download as Types.ObjectId | null) ?? null,
      createdAt: entry.createdAt,
    })
  );
}