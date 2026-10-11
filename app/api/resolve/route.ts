import { resolveProducts } from "@/lib/agent";
import { errorMessage, jsonError, readCsvUpload, timed } from "@/lib/http";
import { parseCatalogCsv } from "@/lib/schemas";

// POST multipart/form-data, field "file" = catalog CSV
// (columns: product_name, category, description).
// Resolves each product to a Qloo entity via the live /search API.

export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  return timed("resolve", async () => {
    const upload = await readCsvUpload(request);
    if (!upload.ok) return upload.response;

    const parsed = parseCatalogCsv(upload.text);
    if (!parsed.ok) {
      return jsonError(400, "INVALID_CSV", "The CSV failed validation.", parsed.issues);
    }

    try {
      const resolved = await resolveProducts(parsed.products);
      const resolvedSet = new Set(resolved.map((r) => r.product));
      const unresolved = parsed.products.filter((p) => !resolvedSet.has(p));
      return Response.json({ resolved, unresolved });
    } catch (err) {
      console.error("[api:resolve] Qloo failure:", err);
      return jsonError(502, "QLOO_RESOLVE_FAILED", "Qloo resolve failed", errorMessage(err));
    }
  });
}
