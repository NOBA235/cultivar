import type { Recommendation } from "./types";
import type { StoredRecommendation } from "./memory";

// Prompts and response schemas for the two Gemini calls.
// The LLM never chooses what to recommend: /api/explain only narrates a
// recommendation Qloo already produced, and /api/generic is the deliberately
// Qloo-free baseline shown on /compare.

// ---------- /api/explain ----------

export const EXPLAIN_INSTRUCTION =
  "You are writing for an independent coffee roaster. The recommendation is an EXISTING brand found in Qloo's taste graph, " +
  "offered as a cultural or brand inspiration (positioning, partnership, or flavor/packaging cue), not a new product and not a sales forecast. " +
  "Write ONE sentence explaining the cultural link using only the signals and Qloo affinity scores provided. " +
  "Qloo affinity measures audience taste overlap; never describe it as demand, sales, market size, or probability of success. " +
  "If the producer has accepted or rejected similar recommendations before, you may briefly note how this one compares. Maximum 35 words.";

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
      `signal-to-"${rec.name}" affinity = ${score(s.candidateAffinity)}; ` +
      `catalog-to-signal affinity = ${score(s.affinity)}` +
      (s.sourceProduct ? ` (via catalog item "${s.sourceProduct}")` : ""),
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
    `Brand inspiration: "${rec.name}" (Qloo category tag: ${rec.category}, Qloo ID ${rec.entityId}, relative rank score ${rec.confidence}/100 where #1 = 100; not a probability)`,
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
