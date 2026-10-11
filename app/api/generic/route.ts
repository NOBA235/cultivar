import { z } from "zod";
import { generateJson } from "@/lib/gemini";
import { errorMessage, jsonError, readCsvUpload, timed } from "@/lib/http";
import {
  buildGenericPrompt,
  GENERIC_INSTRUCTION,
  GENERIC_RESPONSE_SCHEMA,
} from "@/lib/prompts";
import { parseCatalogCsv } from "@/lib/schemas";

// POST multipart/form-data, same CSV as /api/resolve.
// The deliberately Qloo-free baseline for /compare: Gemini sees only product
// names and categories. No Qloo call is made in this route.

export const maxDuration = 60;

const GenericSchema = z.object({
  suggestions: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        category: z.string().trim().min(1),
        description: z.string().trim().min(1),
      }),
    )
    .length(3),
});

export async function POST(request: Request): Promise<Response> {
  return timed("generic", async () => {
    const upload = await readCsvUpload(request);
    if (!upload.ok) return upload.response;

    const parsed = parseCatalogCsv(upload.text);
    if (!parsed.ok) {
      return jsonError(400, "INVALID_CSV", "The CSV failed validation.", parsed.issues);
    }

    try {
      const { suggestions } = await generateJson({
        label: "generic baseline",
        systemInstruction: GENERIC_INSTRUCTION,
        prompt: buildGenericPrompt(parsed.products),
        jsonSchema: GENERIC_RESPONSE_SCHEMA,
        schema: GenericSchema,
      });
      return Response.json({ suggestions });
    } catch (err) {
      console.error("[api:generic] Gemini failure:", err);
      return jsonError(502, "GEMINI_GENERIC_FAILED", "Gemini generic suggestions failed", errorMessage(err));
    }
  });
}
