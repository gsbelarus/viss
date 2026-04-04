import { createErrorResponse } from "@/lib/api-utils";
import { listLogs } from "@/lib/logs";
import type { LogsListResponse } from "@/lib/logs-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const logs = await listLogs();
    const response: LogsListResponse = { logs };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to load logs.");
  }
}