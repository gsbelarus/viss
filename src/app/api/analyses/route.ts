import {
  ApiError,
  createErrorResponse,
  getErrorMessage,
  isRecord,
  readJsonBody,
  toNonEmptyString,
} from "@/lib/api-utils";
import { listVideoAnalyses } from "@/lib/analyses";
import { enqueueVideoAnalysis } from "@/lib/video-analysis";
import type {
  StartVideoAnalysisResponse,
  VideoAnalysesListResponse,
} from "@/lib/video-analysis-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartAnalysisRequestBody {
  id?: unknown;
  overwrite?: unknown;
}

export async function GET() {
  try {
    const analyses = await listVideoAnalyses();
    const response: VideoAnalysesListResponse = { analyses };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to load analyzed videos.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<StartAnalysisRequestBody>(request);
    const id = toNonEmptyString(body.id);
    const overwrite = body.overwrite === true;

    if (!id) {
      throw new ApiError(400, "A download id is required.");
    }

    const response: StartVideoAnalysisResponse = await enqueueVideoAnalysis(id, {
      overwrite,
    });

    return Response.json(response, { status: 202 });
  } catch (error) {
    if (error instanceof ApiError && isRecord(error.details)) {
      return Response.json(
        {
          error: getErrorMessage(error, "Failed to start video analysis."),
          ...error.details,
        },
        { status: error.status }
      );
    }

    return createErrorResponse(error, "Failed to start video analysis.");
  }
}