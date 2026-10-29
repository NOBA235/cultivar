import { resolveProducts } from "@/lib/agent";
import { errorMessage, jsonError, readCsvUpload, timed } from "@/lib/http";
import { MAX_CATALOG_PRODUCTS, MIN_CATALOG_PRODUCTS, parseCatalogCsv } from "@/lib/schemas";

// POST multipart/form-data, field "file" = catalog CSV
// (columns: product_name, category, description).
// Resolves each product to a Qloo entity via the live /search API.

export const maxDuration = 60;

const OVERRIDE_TYPES = new Set([
  "urn:entity:brand",
  "urn:entity:product",
  "urn:entity:restaurant",
]);

export async function POST(request: Request): Promise<Response> {
  return timed("resolve", async () => {
    const upload = await readCsvUpload(request);
    if (!upload.ok) return upload.response;

    if (upload.type && !OVERRIDE_TYPES.has(upload.type)) {
      return jsonError(
        400,
        "INVALID_TYPE",
        `Unsupported Qloo type override "${upload.type}". Use one of: ${Array.from(OVERRIDE_TYPES).join(", ")}.`,
      );
    }

    // A full catalog needs 2-50 rows; a single-row type override re-resolves one product.
    const parsed = parseCatalogCsv(upload.text, {
      minRows: upload.type ? 1 : MIN_CATALOG_PRODUCTS,
      maxRows: MAX_CATALOG_PRODUCTS,
    });
    if (!parsed.ok) {
      return jsonError(400, "INVALID_CSV", "The CSV failed validation.", parsed.issues);
    }

    try {
      const resolved = await resolveProducts(parsed.products, undefined, upload.type);
      const resolvedSet = new Set(resolved.map((r) => r.product));
      const unresolved = parsed.products.filter((p) => !resolvedSet.has(p));
      return Response.json({ resolved, unresolved });
    } catch (err) {
      console.error("[api:resolve] Qloo failure:", err);
      return jsonError(502, "QLOO_RESOLVE_FAILED", "Qloo resolve failed", errorMessage(err));
    }
  });
}
