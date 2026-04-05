import { notFound } from "next/navigation";

import { ApiError } from "@/lib/api-utils";
import { getScriptDetails, listScriptSourceVideos } from "@/lib/scripts";

import ScriptEditor from "../script-editor";

export const dynamic = "force-dynamic";

async function loadScript(id: string) {
  try {
    return await getScriptDetails(id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }

    throw error;
  }
}

export default async function ScriptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [script, sourceVideos] = await Promise.all([
    loadScript(id),
    listScriptSourceVideos(),
  ]);

  return <ScriptEditor initialScript={script} sourceVideos={sourceVideos} />;
}
