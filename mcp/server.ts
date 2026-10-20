import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "../lib/mcp";

/**
 * Cultivar MCP Server
 * Exposes Cultivar's 8 Qloo agentic tools over Model Context Protocol (stdio transport)
 */
async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] Cultivar MCP server running on stdio transport");
}

main().catch((err) => {
  console.error("[mcp] Fatal error starting Cultivar MCP server:", err);
  process.exit(1);
});

