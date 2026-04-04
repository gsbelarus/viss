import {
  ApiError,
  createErrorResponse,
  readJsonBody,
  toNonEmptyString,
} from "@/lib/api-utils";
import {
  deleteDownloads,
  enqueueDownload,
  listDownloads,
} from "@/lib/downloads";
import type {
  DownloadDeleteResponse,
  DownloadMutationResponse,
  DownloadsListResponse,
} from "@/lib/downloads-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateDownloadRequestBody {
  url?: unknown;
  name?: unknown;
  tags?: unknown;
}

interface DeleteDownloadsRequestBody {
  ids?: unknown;
}

function parseTagNames(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((entry) => toNonEmptyString(entry))
    .filter(Boolean);
}

export async function GET() {
  try {
    const downloads = await listDownloads();
    const response: DownloadsListResponse = { downloads };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to load downloads.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<CreateDownloadRequestBody>(request);
    const url = toNonEmptyString(body.url);
    const name = toNonEmptyString(body.name);
    const tags = parseTagNames(body.tags);

    if (!url) {
      throw new ApiError(400, "A video URL is required.");
    }

    const download = await enqueueDownload({
      url,
      name: name || undefined,
      tagNames: tags,
    });
    const response: DownloadMutationResponse = {
      download,
      message: "Download started.",
    };

    return Response.json(response, { status: 202 });
  } catch (error) {
    return createErrorResponse(error, "Failed to start the download.");
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await readJsonBody<DeleteDownloadsRequestBody>(request);
    const ids = Array.isArray(body.ids)
      ? body.ids.map((entry) => toNonEmptyString(entry)).filter(Boolean)
      : [];
    const deletedIds = await deleteDownloads(ids);
    const response: DownloadDeleteResponse = {
      deletedIds,
      message:
        deletedIds.length === 1
          ? "Download deleted."
          : `${deletedIds.length} downloads deleted.`,
    };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to delete the selected downloads.");
  }
}