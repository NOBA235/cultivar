import { z } from "zod";
import { generateJson } from "@/lib/gemini";
import { errorMessage, jsonError, readJson, timed } from "@/lib/http";
import {
  buildExplainPrompt,
  EXPLAIN_INSTRUCTION,
  EXPLAIN_MAX_WORDS,
  EXPLAIN_RESPONSE_SCHEMA,
} from "@/lib/prompts";
import { ExplainRequestSchema, zodIssues } from "@/lib/schemas";
import { getAllStoredRecords, type StoredRecommendation } from "@/lib/memory";
import type { Recommendation } from "@/lib/types";

// POST { recommendations: Recommendation[] } (the output of /api/recommend).
// Gemini writes ONE sentence per recommendation from its Qloo signals and memory.
// The recommendations themselves pass through unchanged: the LLM only fills
// in `explanation`.

export const maxDuration = 60;

const ExplanationSchema = z.object({ explanation: z.string().trim().min(1) });

async function explainOne(
  rec: Recommendation,
  pastRecords: StoredRecommendation[] = [],
): Promise<Recommendation> {
  try {
    const { explanation } = await generateJson({
      label: `explain "${rec.name}"`,
      systemInstruction: EXPLAIN_INSTRUCTION,
      prompt: buildExplainPrompt(rec, pastRecords),
      jsonSchema: EXPLAIN_RESPONSE_SCHEMA,
      schema: ExplanationSchema,
    });

    const words = explanation.split(/\s+/).filter(Boolean).length;
    if (words > EXPLAIN_MAX_WORDS) {
      console.warn(`[api:explain] "${rec.name}" explanation is ${words} words (limit ${EXPLAIN_MAX_WORDS})`);
    }
    return { ...rec, explanation };
  } catch (err) {
    console.warn(`[api:explain] Gemini explain call failed for "${rec.name}", using grounded fallback:`, err);
    // Grounded fallback citing signals and past memory if present
    const topSignals = rec.supportingSignals.slice(0, 3).map((s) => s.label).join(", ");
    let memoryRef = "";
    if (pastRecords.length > 0) {
      const last = pastRecords[pastRecords.length - 1];
      memoryRef = ` Built on past evaluation of "${last.recommendation.name}" (${last.accepted ? "accepted" : "declined"}).`;
    }
    const fallback = `Follows cultural affinity with ${topSignals}.${memoryRef}`;
    return { ...rec, explanation: fallback };
  }
}

export async function POST(request: Request): Promise<Response> {
  return timed("explain", async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;

    const parsed = ExplainRequestSchema.safeParse(body.data);
    if (!parsed.success) {
      return jsonError(400, "INVALID_BODY", "Body must be { recommendations: Recommendation[] }.", zodIssues(parsed.error));
    }

    try {
      const pastRecords = await getAllStoredRecords();
      const recommendations = await Promise.all(
        parsed.data.recommendations.map((r) => explainOne(r, pastRecords)),
      );
      return Response.json({ recommendations });
    } catch (err) {
      console.error("[api:explain] Pipeline failure:", err);
      return jsonError(502, "GEMINI_EXPLAIN_FAILED", "Gemini explain failed", errorMessage(err));
    }
  });
}
