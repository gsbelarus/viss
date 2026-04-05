import { createErrorResponse, readJsonBody } from "@/lib/api-utils";
import { generateScriptFromInput } from "@/lib/scripts";
import type { ScriptGenerateResponse } from "@/lib/scripts-shared";

import { parseScriptGenerationBody } from "../validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request);
    const generatedScript = await generateScriptFromInput(
      parseScriptGenerationBody(body)
    );
    const response: ScriptGenerateResponse = {
      generatedScript,
      message: "Script generated.",
    };

    return Response.json(response);
  } catch (error) {
    return createErrorResponse(error, "Failed to generate the script.");
  }
}
