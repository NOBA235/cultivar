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
import type { Recommendation } from "@/lib/types";

// POST { recommendations: Recommendation[] } (the output of /api/recommend).
// Gemini writes ONE sentence per recommendation from its Qloo signals.
// The recommendations themselves pass through unchanged: the LLM only fills
// in `explanation`.

export const maxDuration = 60;

const ExplanationSchema = z.object({ explanation: z.string().trim().min(1) });

async function explainOne(rec: Recommendation): Promise<Recommendation> {
  const { explanation } = await generateJson({
    label: `explain "${rec.name}"`,
    systemInstruction: EXPLAIN_INSTRUCTION,
    prompt: buildExplainPrompt(rec),
    jsonSchema: EXPLAIN_RESPONSE_SCHEMA,
    schema: ExplanationSchema,
  });

  const words = explanation.split(/\s+/).filter(Boolean).length;
  if (words > EXPLAIN_MAX_WORDS) {
    console.warn(`[api:explain] "${rec.name}" explanation is ${words} words (limit ${EXPLAIN_MAX_WORDS})`);
  }
  return { ...rec, explanation };
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
      const recommendations = await Promise.all(parsed.data.recommendations.map(explainOne));
      return Response.json({ recommendations });
    } catch (err) {
      console.error("[api:explain] Gemini failure:", err);
      return jsonError(502, "GEMINI_EXPLAIN_FAILED", "Gemini explain failed", errorMessage(err));
    }
  });
}
