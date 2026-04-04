import {
  ApiError,
  createErrorResponse,
  readJsonBody,
  toNonEmptyString,
} from "@/lib/api-utils";
import { getDownloadMetadata } from "@/lib/downloads";
import type { DownloadMetadataResponse } from "@/lib/downloads-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MetadataRequestBody {
  url?: unknown;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<MetadataRequestBody>(request);
    const url = toNonEmptyString(body.url);

    if (!url) {
      throw new ApiError(400, "A video URL is required.");
    }

    const metadata = await getDownloadMetadata(url);
    const response: DownloadMetadataResponse = metadata;

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to load metadata for the supplied URL.");
  }
}