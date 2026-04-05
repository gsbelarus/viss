import {
  deleteAnalyzedVideo,
  getVideoAnalysisDetails,
  updateVideoAnalysisVerification,
} from "@/lib/analyses";
import {
  ApiError,
  createErrorResponse,
  readJsonBody,
  toNonEmptyString,
} from "@/lib/api-utils";
import type {
  VideoAnalysisDeleteResponse,
  VideoAnalysisDetailResponse,
  VideoAnalysisUpdateResponse,
} from "@/lib/video-analysis-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpdateVideoAnalysisRequestBody {
  verified?: unknown;
}

function parseVerified(value: unknown) {
  if (typeof value !== "boolean") {
    throw new ApiError(400, "Verified must be a boolean.");
  }

  return value;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const analysis = await getVideoAnalysisDetails(toNonEmptyString(id));
    const response: VideoAnalysisDetailResponse = { analysis };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to load the video analysis.");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deletion = await deleteAnalyzedVideo(toNonEmptyString(id));
    const response: VideoAnalysisDeleteResponse = deletion;

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to delete the video.");
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await readJsonBody<UpdateVideoAnalysisRequestBody>(request);
    const analysis = await updateVideoAnalysisVerification(
      toNonEmptyString(id),
      parseVerified(body.verified)
    );
    const response: VideoAnalysisUpdateResponse = {
      analysis,
      message: analysis.verified
        ? "Video analysis marked as verified."
        : "Video analysis verification cleared.",
    };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to update the video analysis.");
  }
}