# VISS

VISS is a local Next.js application for reviewing downloaded videos, running the video-analysis pipeline, inspecting stored analyses, and generating scripts from those results. Analysis metadata is stored in MongoDB, while downloaded media and derived artifacts live under `storage/`.

## Development

Install dependencies and start the app:

```bash
pnpm install
pnpm dev
```

Useful commands:

- `pnpm lint`
- `pnpm test`
- `pnpm build`

Make sure the repository's usual environment variables for MongoDB, OpenAI, and any other local services are configured before starting the app.

## Embedded MCP Server

While the app is running, it also exposes an MCP endpoint at `http://127.0.0.1:3000/api/mcp`.

Available tools:

- `list_verified_analysis_ids`: returns the ids of analyses currently marked as verified.
- `get_existing_analysis`: fetches the stored analysis document for a given id.
- `analyze_video_dry_run`: reruns the current analysis pipeline for a stored video and returns the full result without writing analysis documents, download status updates, or log entries.
- `compare_existing_and_dry_run_analysis`: returns the stored analysis, the dry-run analysis, and a compact comparison block with key fields side by side.

Notes:

- The MCP endpoint is stateless and intended for local development use.
- `analyze_video_dry_run` still reads the stored media file and calls the live analysis pipeline, so it can take time and consume API quota.

## Connect From VS Code

Create `.vscode/mcp.json` in this workspace with the following content:

```json
{
	"servers": {
		"viss": {
			"type": "http",
			"url": "http://127.0.0.1:3000/api/mcp"
		}
	}
}
```

Then:

1. Start the app with `pnpm dev`.
2. Let VS Code trust and enable the workspace MCP server when prompted.
3. Use the MCP tools from Copilot Chat to list verified ids, fetch stored analyses, and run side-by-side dry-run comparisons against your current analysis changes.

If you prefer user-scoped MCP configuration, add the same server entry to your user MCP config instead of the workspace file.
