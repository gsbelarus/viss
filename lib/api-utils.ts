export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function toNonEmptyString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function getErrorMessage(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (isRecord(error)) {
    if (typeof error.error === "string" && error.error.trim()) {
      return error.error.trim();
    }

    if (typeof error.message === "string" && error.message.trim()) {
      return error.message.trim();
    }
  }

  return fallbackMessage;
}

export function createErrorResponse(error: unknown, fallbackMessage: string) {
  const status = error instanceof ApiError ? error.status : 500;
  const message = getErrorMessage(error, fallbackMessage);

  return Response.json({ error: message }, { status });
}

export async function readJsonBody<T>(request: Request) {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError(400, "Invalid JSON request body.");
  }
}