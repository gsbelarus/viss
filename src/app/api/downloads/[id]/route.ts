import {
  ApiError,
  createErrorResponse,
  readJsonBody,
  toNonEmptyString,
} from "@/lib/api-utils";
import { updateDownload } from "@/lib/downloads";
import type { DownloadUpdateResponse } from "@/lib/downloads-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpdateDownloadRequestBody {
  tags?: unknown;
  published?: unknown;
}

interface DownloadRouteContext {
  params: Promise<{
    id: string;
  }>;
}

function parseTagNames(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new ApiError(400, "Tags must be an array.");
  }

  return value
    .map((entry) => toNonEmptyString(entry))
    .filter(Boolean);
}

function parsePublished(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  throw new ApiError(400, "Published timestamp must be a string or null.");
}

export async function PATCH(
  request: Request,
  { params }: DownloadRouteContext
) {
  try {
    const { id } = await params;
    const body = await readJsonBody<UpdateDownloadRequestBody>(request);
    const updateInput: {
      tagNames?: string[];
      published?: string | null;
    } = {};

    if (body.tags !== undefined) {
      updateInput.tagNames = parseTagNames(body.tags);
    }

    if (body.published !== undefined) {
      updateInput.published = parsePublished(body.published);
    }

    const download = await updateDownload(toNonEmptyString(id), updateInput);
    const response: DownloadUpdateResponse = {
      download,
      message: "Download updated.",
    };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to update the download.");
  }
}