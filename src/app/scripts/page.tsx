import { listScripts } from "@/lib/scripts";

import ScriptsPageClient from "./scripts-page-client";

export const dynamic = "force-dynamic";

export default async function ScriptsPage() {
  const scripts = await listScripts();

  return <ScriptsPageClient initialScripts={scripts} />;
}
