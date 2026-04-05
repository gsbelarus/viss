import {
  ApiError,
  createErrorResponse,
  readJsonBody,
  toNonEmptyString,
} from "@/lib/api-utils";
import { enqueueVideoAnalysis } from "@/lib/video-analysis";
import type { StartVideoAnalysisResponse } from "@/lib/video-analysis-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartAnalysisRequestBody {
  id?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<StartAnalysisRequestBody>(request);
    const id = toNonEmptyString(body.id);

    if (!id) {
      throw new ApiError(400, "A download id is required.");
    }

    const response: StartVideoAnalysisResponse = await enqueueVideoAnalysis(id);

    return Response.json(response, { status: 202 });
  } catch (error) {
    return createErrorResponse(error, "Failed to start video analysis.");
  }
}