import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { createErrorResponse } from "@/lib/api-utils";
import { getDownloadFileDetails } from "@/lib/downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DownloadFileRouteContext {
  params: Promise<{
    id: string;
  }>;
}

function buildBaseHeaders(fileName: string, contentType: string, contentLength: number) {
  return new Headers({
    "accept-ranges": "bytes",
    "content-disposition": `inline; filename="${fileName}"`,
    "content-length": String(contentLength),
    "content-type": contentType,
  });
}

function parseRangeHeader(rangeHeader: string | null, fileSize: number) {
  if (!rangeHeader) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());

  if (!match) {
    return { error: true } as const;
  }

  const [, startValue, endValue] = match;

  if (!startValue && !endValue) {
    return { error: true } as const;
  }

  let start: number;
  let end: number;

  if (!startValue) {
    const suffixLength = Number(endValue);

    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return { error: true } as const;
    }

    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number(startValue);
    end = endValue ? Number(endValue) : fileSize - 1;

    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return { error: true } as const;
    }

    if (end >= fileSize) {
      end = fileSize - 1;
    }
  }

  if (start < 0 || start >= fileSize || end < start) {
    return { error: true } as const;
  }

  return { start, end };
}

async function createFileResponse(
  request: Request,
  context: DownloadFileRouteContext,
  includeBody: boolean
) {
  try {
    const { id } = await context.params;
    const file = await getDownloadFileDetails(id);
    const range = parseRangeHeader(request.headers.get("range"), file.size);

    if (range?.error) {
      return new Response(null, {
        status: 416,
        headers: {
          "content-range": `bytes */${file.size}`,
        },
      });
    }

    if (range) {
      const contentLength = range.end - range.start + 1;
      const headers = buildBaseHeaders(
        file.fileName,
        file.contentType,
        contentLength
      );

      headers.set("content-range", `bytes ${range.start}-${range.end}/${file.size}`);

      if (!includeBody) {
        return new Response(null, {
          status: 206,
          headers,
        });
      }

      return new Response(
        Readable.toWeb(
          createReadStream(file.filePath, {
            start: range.start,
            end: range.end,
          })
        ) as ReadableStream,
        {
          status: 206,
          headers,
        }
      );
    }

    const headers = buildBaseHeaders(file.fileName, file.contentType, file.size);

    if (!includeBody) {
      return new Response(null, {
        status: 200,
        headers,
      });
    }

    return new Response(
      Readable.toWeb(createReadStream(file.filePath)) as ReadableStream,
      {
        status: 200,
        headers,
      }
    );
  } catch (error) {
    return createErrorResponse(error, "Failed to read the downloaded video.");
  }
}

export async function GET(request: Request, context: DownloadFileRouteContext) {
  return createFileResponse(request, context, true);
}

export async function HEAD(request: Request, context: DownloadFileRouteContext) {
  return createFileResponse(request, context, false);
}