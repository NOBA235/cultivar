import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../lib/mcp";

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] CropSignal MCP server running on stdio");
}

main().catch((err) => {
  console.error("[mcp] Fatal error running MCP server:", err);
  process.exit(1);
});

