import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolve_product,
  get_cultural_affinities,
  find_adjacent_products,
  rank_candidates,
  explain_recommendation,
  remember_recommendation,
  recall_past_recommendations,
  seasonal_trends,
} from "./tools";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "cropsignal-mcp",
    version: "1.0.0",
  });

  // Tool 1: resolve_product
  server.tool(
    "resolve_product",
    "Resolves a raw catalog product name against Qloo's live entity taste database. Returns { result, qloo_request, qloo_response, explanation }.",
    {
      product_name: z.string().describe("The name of the catalog product to resolve"),
      category: z.string().optional().describe("Optional product category"),
      overrideType: z.string().optional().describe("Optional Qloo entity type URN"),
    },
    async ({ product_name, category, overrideType }) => {
      const response = await resolve_product({ product_name, category, overrideType });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // Tool 2: get_cultural_affinities
  server.tool(
    "get_cultural_affinities",
    "Fetches live cross-domain cultural taste signals (music, film, destinations) for an entity from Qloo. Returns { result, qloo_request, qloo_response, explanation }.",
    {
      entity_id: z.string().describe("The Qloo entity ID to get affinities for"),
      domain: z.string().optional().describe("Target entity type URN (e.g. urn:entity:artist)"),
      take: z.number().optional().describe("Maximum entities to retrieve (default: 20)"),
    },
    async ({ entity_id, domain, take }) => {
      const response = await get_cultural_affinities({ entity_id, domain, take });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // Tool 3: find_adjacent_products
  server.tool(
    "find_adjacent_products",
    "Surfaces adjacent product candidates from a cultural taste signal using Qloo cross-domain affinities. Returns { result, qloo_request, qloo_response, explanation }.",
    {
      signal: z.string().describe("The signal entity ID or label"),
      take: z.number().optional().describe("Number of candidates to surface (default: 10)"),
    },
    async ({ signal, take }) => {
      const response = await find_adjacent_products({ signal, take });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // Tool 4: rank_candidates
  server.tool(
    "rank_candidates",
    "Ranks candidate products using affinity, signal diversity, and catalog novelty. Returns { result, qloo_request: null, qloo_response: null, explanation }.",
    {
      candidates: z.array(z.any()).describe("List of candidate products with signals"),
      catalog: z.array(z.any()).describe("The user's current catalog items"),
    },
    async ({ candidates, catalog }) => {
      const response = await rank_candidates({ candidates, catalog });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // Tool 5: explain_recommendation
  server.tool(
    "explain_recommendation",
    "Generates a single-sentence cultural explanation for a recommendation based on its Qloo signals using Gemini Flash. Returns { result, qloo_request: null, qloo_response: null, explanation }.",
    {
      rec: z.any().describe("The recommendation object containing name and supportingSignals"),
    },
    async ({ rec }) => {
      const response = await explain_recommendation({ rec });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // Tool 6: remember_recommendation
  server.tool(
    "remember_recommendation",
    "Stores a recommendation decision (accepted or rejected) into persistent memory. Returns { result, qloo_request: null, qloo_response: null, explanation }.",
    {
      rec: z.any().describe("The recommendation object"),
      accepted: z.boolean().describe("Whether the user accepted the recommendation"),
      notes: z.string().optional().describe("Optional notes"),
    },
    async ({ rec, accepted, notes }) => {
      const response = await remember_recommendation({ rec, accepted, notes });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // Tool 7: recall_past_recommendations
  server.tool(
    "recall_past_recommendations",
    "Retrieves past saved recommendations from persistent memory store. Returns { result, qloo_request: null, qloo_response: null, explanation }.",
    {},
    async () => {
      const response = await recall_past_recommendations();
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  // Tool 8: seasonal_trends
  server.tool(
    "seasonal_trends",
    "Retrieves live seasonal cultural trend signals for a given month or season from Qloo. Returns { result, qloo_request, qloo_response, explanation }.",
    {
      month: z.union([z.number(), z.string()]).describe("Month (1-12) or season name ('autumn', 'spring')"),
      take: z.number().optional().describe("Number of trends to return (default: 10)"),
    },
    async ({ month, take }) => {
      const response = await seasonal_trends({ month, take });
      return {
        content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
      };
    },
  );

  return server;
}
