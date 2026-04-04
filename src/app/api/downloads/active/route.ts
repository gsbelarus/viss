import { createErrorResponse } from "@/lib/api-utils";
import { listActiveProcesses } from "@/lib/downloads";
import type { ActiveProcessesResponse } from "@/lib/processes-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jobs = await listActiveProcesses();
    const response: ActiveProcessesResponse = { jobs };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to load active downloads.");
  }
}