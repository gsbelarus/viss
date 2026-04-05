import {
  createErrorResponse,
  readJsonBody,
  toNonEmptyString,
} from "@/lib/api-utils";
import {
  deleteScript,
  getScriptDetails,
  updateScript,
} from "@/lib/scripts";
import type {
  ScriptDeleteResponse,
  ScriptDetailResponse,
  ScriptMutationResponse,
} from "@/lib/scripts-shared";

import { parseScriptMutationBody } from "../validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ScriptRouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(
  _request: Request,
  { params }: ScriptRouteContext
) {
  try {
    const { id } = await params;
    const script = await getScriptDetails(toNonEmptyString(id));
    const response: ScriptDetailResponse = { script };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to load the script.");
  }
}

export async function PATCH(
  request: Request,
  { params }: ScriptRouteContext
) {
  try {
    const { id } = await params;
    const body = await readJsonBody(request);
    const script = await updateScript(
      toNonEmptyString(id),
      parseScriptMutationBody(body)
    );
    const response: ScriptMutationResponse = {
      script,
      message: "Script saved.",
    };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to save the script.");
  }
}

export async function DELETE(
  _request: Request,
  { params }: ScriptRouteContext
) {
  try {
    const { id } = await params;
    const result = await deleteScript(toNonEmptyString(id));
    const response: ScriptDeleteResponse = result;

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to delete the script.");
  }
}
