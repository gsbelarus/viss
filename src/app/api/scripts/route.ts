import { createErrorResponse, readJsonBody } from "@/lib/api-utils";
import { createScript, listScripts } from "@/lib/scripts";
import type {
  ScriptMutationResponse,
  ScriptsListResponse,
} from "@/lib/scripts-shared";

import { parseScriptMutationBody } from "./validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scripts = await listScripts();
    const response: ScriptsListResponse = { scripts };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to load scripts.");
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const script = await createScript(parseScriptMutationBody(body));
    const response: ScriptMutationResponse = {
      script,
      message: "Script saved.",
    };

    return Response.json(response, { status: 201 });
  } catch (error) {
    return createErrorResponse(error, "Failed to save the script.");
  }
}
