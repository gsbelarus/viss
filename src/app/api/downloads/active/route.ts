import { createErrorResponse } from "@/lib/api-utils";
import { listActiveDownloads } from "@/lib/downloads";
import type { ActiveDownloadsResponse } from "@/lib/downloads-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jobs = await listActiveDownloads();
    const response: ActiveDownloadsResponse = { jobs };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to load active downloads.");
  }
}