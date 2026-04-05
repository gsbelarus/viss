import { listScriptSourceVideos } from "@/lib/scripts";

import ScriptEditor from "../script-editor";

export const dynamic = "force-dynamic";

export default async function NewScriptPage() {
  const sourceVideos = await listScriptSourceVideos();

  return <ScriptEditor initialScript={null} sourceVideos={sourceVideos} />;
}
