import type { Recommendation } from "./types";
import type { StoredRecommendation } from "./memory";

// Prompts and response schemas for the two Gemini calls.
// The LLM never chooses what to recommend: /api/explain only narrates a
// recommendation Qloo already produced, and /api/generic is the deliberately
// Qloo-free baseline shown on /compare.

// ---------- /api/explain ----------

export const EXPLAIN_INSTRUCTION =
  "Write ONE sentence explaining why this recommendation follows from the cultural signals. " +
  "When making a recommendation, check if the producer has accepted or rejected similar recommendations before. " +
  "If so, explain why this one is different or similar, citing the past recommendation in your sentence. Maximum 35 words.";

export const EXPLAIN_MAX_WORDS = 35;

/** JSON schema (Gemini responseJsonSchema) enforcing { explanation: string }. */
export const EXPLAIN_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    explanation: { type: "string" },
  },
  required: ["explanation"],
  propertyOrdering: ["explanation"],
} as const;

function score(n: number | undefined): string {
  return typeof n === "number" ? n.toFixed(3) : "n/a";
}

/** The data block: the recommendation plus every supporting Qloo signal and memory context. */
export function buildExplainPrompt(
  rec: Recommendation,
  pastRecords: StoredRecommendation[] = [],
): string {
  const signals = rec.supportingSignals.map(
    (s) =>
      `- "${s.label}" (${s.entityType}, Qloo ID ${s.entityId}): ` +
      `affinity with "${rec.name}" = ${score(s.candidateAffinity)}; ` +
      `affinity with the producer's catalog = ${score(s.affinity)}`,
  );

  const memoryContext: string[] = [];
  if (pastRecords.length > 0) {
    memoryContext.push(
      "",
      "Producer's historical memory of past recommendations (MUST reference or compare if relevant):",
      ...pastRecords.slice(-5).map(
        (m) =>
          `- ${m.recommendation.name} (${m.recommendation.category}): ${m.accepted ? "ACCEPTED ('I'll try this')" : "REJECTED ('Not for us')"}${m.notes ? ` [Notes: ${m.notes}]` : ""}`,
      ),
    );
  }

  return [
    `Recommendation: "${rec.name}" (category: ${rec.category}, Qloo ID ${rec.entityId}, relative confidence ${rec.confidence}/100)`,
    "",
    "Cultural signals from Qloo's taste graph (affinity scores are Qloo's, higher = stronger audience overlap):",
    ...signals,
    ...memoryContext,
  ].join("\n");
}

// ---------- /api/generic (baseline, no Qloo) ----------

export const GENERIC_INSTRUCTION =
  "You are a food product consultant. Given these existing products, suggest 3 new product ideas. Be specific. Return JSON: { suggestions: [{ name, category, reasoning }] }";

export const GENERIC_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          category: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["name", "category", "reasoning"],
        propertyOrdering: ["name", "category", "reasoning"],
      },
    },
  },
  required: ["suggestions"],
} as const;

/** Only names and categories go in: no descriptions, no Qloo data whatsoever. */
export function buildGenericPrompt(products: Array<{ name: string; category: string }>): string {
  return [
    "Current products (name | category):",
    ...products.map((p) => `- ${p.name} | ${p.category}`),
  ].join("\n");
}
