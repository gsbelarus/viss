import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import {
  analyzeVideoByIdDryRun,
  getVideoAnalysisDetails,
  listVerifiedVideoAnalysisIds,
} from "@/lib/analyses";

function createJsonTextResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function getFailedStages(
  pipeline: Record<string, { status?: string } | null | undefined> | null | undefined
) {
  if (!pipeline) {
    return [] as string[];
  }

  return Object.entries(pipeline)
    .filter(([, stage]) => stage?.status === "failed")
    .map(([stageKey]) => stageKey);
}

function createComparisonPayload(
  id: string,
  storedAnalysis: Awaited<ReturnType<typeof getVideoAnalysisDetails>>,
  dryRunAnalysis: Awaited<ReturnType<typeof analyzeVideoByIdDryRun>>
) {
  return {
    id,
    comparison: {
      generatedAt: new Date().toISOString(),
      verified: storedAnalysis.verified,
      storedUpdatedAt: storedAnalysis.updatedAt,
      dryRunUpdatedAt: dryRunAnalysis.updatedAt ?? null,
      status: {
        stored: storedAnalysis.status,
        dryRun: dryRunAnalysis.status,
      },
      contentCategory: {
        stored: storedAnalysis.analysis.contentCategory,
        dryRun: dryRunAnalysis.analysis.contentCategory,
      },
      summary: {
        stored: storedAnalysis.analysis.summary,
        dryRun: dryRunAnalysis.analysis.summary,
      },
      transcriptText: {
        stored: storedAnalysis.transcript.text,
        dryRun: dryRunAnalysis.transcript.text,
      },
      sceneCandidateCount: {
        stored: storedAnalysis.scenes.candidates.length,
        dryRun: dryRunAnalysis.scenes.candidates.length,
      },
      frameCount: {
        stored: storedAnalysis.frames.length,
        dryRun: dryRunAnalysis.frames.length,
      },
      failedStages: {
        stored: getFailedStages(storedAnalysis.pipeline),
        dryRun: getFailedStages(dryRunAnalysis.pipeline),
      },
    },
    stored: storedAnalysis,
    dryRun: dryRunAnalysis,
  };
}

export function createVissMcpServer() {
  const server = new McpServer(
    {
      name: "viss-analysis-tools",
      version: "1.0.0",
    },
    {
      instructions:
        "Use these tools to inspect verified analyses and rerun the video-analysis pipeline without writing any changes back to MongoDB.",
    }
  );

  server.registerTool(
    "list_verified_analysis_ids",
    {
      title: "List Verified Analysis IDs",
      description: "Return the video ids of analyses that are currently marked as verified.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const videoIds = await listVerifiedVideoAnalysisIds();

      return createJsonTextResult({
        count: videoIds.length,
        videoIds,
      });
    }
  );

  server.registerTool(
    "get_existing_analysis",
    {
      title: "Get Existing Analysis",
      description:
        "Fetch the stored video analysis document for a given video id from the database.",
      inputSchema: {
        id: z.string().trim().min(1).describe("The video analysis id to retrieve."),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      const analysis = await getVideoAnalysisDetails(id);
      return createJsonTextResult(analysis);
    }
  );

  server.registerTool(
    "analyze_video_dry_run",
    {
      title: "Analyze Video Dry Run",
      description:
        "Run the current video-analysis pipeline for a stored video id and return the full analysis result without persisting documents, download status, or logs.",
      inputSchema: {
        id: z.string().trim().min(1).describe("The video analysis id to rerun."),
      },
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      const analysis = await analyzeVideoByIdDryRun(id);
      return createJsonTextResult(analysis);
    }
  );

  server.registerTool(
    "compare_existing_and_dry_run_analysis",
    {
      title: "Compare Existing And Dry Run Analysis",
      description:
        "Fetch the stored analysis and a non-persisted rerun for the same video id, then return them in a side-by-side comparison shape.",
      inputSchema: {
        id: z.string().trim().min(1).describe("The video analysis id to compare."),
      },
      annotations: {
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ id }) => {
      const storedAnalysis = await getVideoAnalysisDetails(id);
      const dryRunAnalysis = await analyzeVideoByIdDryRun(id);

      return createJsonTextResult(createComparisonPayload(id, storedAnalysis, dryRunAnalysis));
    }
  );

  return server;
}
