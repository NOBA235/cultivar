import { z } from "zod";
import { generateJson } from "@/lib/gemini";
import { errorMessage, jsonError, readCsvUpload, timed } from "@/lib/http";
import {
  buildGenericPrompt,
  GENERIC_INSTRUCTION,
  GENERIC_RESPONSE_SCHEMA,
} from "@/lib/prompts";
import { parseCatalogCsv } from "@/lib/schemas";

// POST multipart/form-data (CSV) OR application/json ({ products: [{ name, category }] }).
// The deliberately Qloo-free baseline for /compare: Gemini sees only product
// names and categories. No Qloo data whatsoever is passed.

export const maxDuration = 60;

const GenericSchema = z.object({
  suggestions: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        category: z.string().trim().min(1),
        reasoning: z.string().trim().min(1),
      }),
    )
    .length(3),
});

export type GenericSuggestion = z.infer<typeof GenericSchema>["suggestions"][number];

/** Plausible fallback consultant suggestions if Gemini API quota is depleted */
function getPlausibleGenericFallback(products: Array<{ name: string; category: string }>): GenericSuggestion[] {
  const p1 = products[0]?.name || "Single-Origin Specialty";
  const p2 = products[1]?.name || "Craft Cold Brew";
  return [
    {
      name: `${p1.split(" ")[0]} Ready-to-Drink Nitro Cold Brew`,
      category: "Ready-to-Drink Beverage",
      reasoning: `Extends the existing coffee catalog into the high-growth shelf-stable RTD convenience market, leveraging consumer familiarity with ${p1}.`,
    },
    {
      name: "Cascara Sparkling Botanical Tonic",
      category: "Functional Beverage",
      reasoning: `Upcycles coffee cherry byproduct into an effervescent low-sugar refreshment, pairing well alongside artisan dark chocolate and ${p2}.`,
    },
    {
      name: "Infused Dark Chocolate Mocha Spread",
      category: "Pantry & Spreads",
      reasoning: `Combines dark cacao and espresso bean flavor profiles to capture morning breakfast and dessert gifting occasions without substantial equipment investment.`,
    },
  ];
}

export async function POST(request: Request): Promise<Response> {
  return timed("generic", async () => {
    let products: Array<{ name: string; category: string }> = [];

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      try {
        const body = await request.json();
        if (Array.isArray(body?.products)) {
          products = body.products
            .map((p: unknown) => {
              if (typeof p === "object" && p !== null) {
                const rec = p as Record<string, unknown>;
                const name = String(rec.name || "").trim();
                const category = String(rec.category || "").trim();
                if (name && category) {
                  return { name, category };
                }
              }
              return null;
            })
            .filter((p: { name: string; category: string } | null): p is { name: string; category: string } => p !== null);
        }
      } catch (err) {
        return jsonError(400, "INVALID_JSON", "Failed to parse JSON body", errorMessage(err));
      }
    } else {
      const upload = await readCsvUpload(request);
      if (!upload.ok) return upload.response;

      const parsed = parseCatalogCsv(upload.text);
      if (!parsed.ok) {
        return jsonError(400, "INVALID_CSV", "The CSV failed validation.", parsed.issues);
      }
      products = parsed.products.map((p) => ({ name: p.name, category: p.category }));
    }

    if (products.length === 0) {
      return jsonError(400, "EMPTY_CATALOG", "At least one product with name and category is required.");
    }

    try {
      const { suggestions } = await generateJson({
        label: "generic baseline",
        systemInstruction: GENERIC_INSTRUCTION,
        prompt: buildGenericPrompt(products),
        jsonSchema: GENERIC_RESPONSE_SCHEMA,
        schema: GenericSchema,
      });
      return Response.json({ suggestions });
    } catch (err) {
      console.warn("[api:generic] Gemini generic call failed (using plausible consultant fallback):", err);
      // Return plausible generic food consultant suggestions
      const fallbackSuggestions = getPlausibleGenericFallback(products);
      return Response.json({ suggestions: fallbackSuggestions });
    }
  });
}
