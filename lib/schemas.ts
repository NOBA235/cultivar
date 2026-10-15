import Papa from "papaparse";
import { z } from "zod";
import type {
  CulturalSignal,
  Product,
  Recommendation,
  ResolvedEntity,
} from "./types";

// Zod schemas for everything that crosses an HTTP boundary, plus the shared
// catalog CSV parser (used by /api/resolve, /api/generic, reality-check.ts).
// Each schema is annotated with its TS type so the two cannot drift apart.

// ---------- Catalog CSV ----------

export const CATALOG_COLUMNS = ["product_name", "category", "description"] as const;

const CatalogRowSchema = z.object({
  product_name: z.string().trim().min(1, "product_name is empty"),
  category: z.string().trim().min(1, "category is empty"),
  description: z.string().trim().min(1, "description is empty"),
});

export interface Issue {
  row?: number; // 1-based line number in the file (header = 1)
  field?: string;
  message: string;
}

export type CatalogParseResult =
  | { ok: true; products: Product[] }
  | { ok: false; issues: Issue[] };

/** Parses and validates a catalog CSV. Never throws on bad input. */
export function parseCatalogCsv(text: string): CatalogParseResult {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  const issues: Issue[] = parsed.errors.map((e) => ({
    row: typeof e.row === "number" ? e.row + 2 : undefined,
    message: `CSV syntax: ${e.message}`,
  }));

  const fields = parsed.meta.fields ?? [];
  const missing = CATALOG_COLUMNS.filter((c) => !fields.includes(c));
  if (missing.length > 0) {
    issues.push({
      message: `Missing required column(s): ${missing.join(", ")}. Required header: ${CATALOG_COLUMNS.join(",")}`,
    });
    return { ok: false, issues };
  }

  if (parsed.data.length === 0) {
    issues.push({ message: "CSV has a header but no product rows." });
    return { ok: false, issues };
  }

  const products: Product[] = [];
  parsed.data.forEach((row, i) => {
    const result = CatalogRowSchema.safeParse(row);
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push({
          row: i + 2,
          field: issue.path.join(".") || undefined,
          message: issue.message,
        });
      }
      return;
    }
    products.push({
      name: result.data.product_name,
      category: result.data.category,
      description: result.data.description,
    });
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, products };
}

// ---------- Request bodies ----------

export const ProductSchema: z.ZodType<Product> = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string(),
});

export const ResolvedEntitySchema: z.ZodType<ResolvedEntity> = z.object({
  product: ProductSchema,
  qlooId: z.string().min(1),
  qlooType: z.string().min(1),
  confidence: z.number(),
  label: z.string().min(1),
});

export const QlooRequestAuditSchema = z.object({
  url: z.string(),
  params: z.record(z.string(), z.string()).optional(),
  method: z.string().optional(),
});

export const ToolTraceSchema = z.object({
  tool: z.string(),
  input: z.unknown(),
  qloo_request: QlooRequestAuditSchema.nullable().optional(),
  qloo_response: z.unknown().nullable().optional(),
  explanation: z.string(),
});

export const RankingBreakdownSchema = z.object({
  formula: z.string(),
  totalAffinity: z.number(),
  signalCount: z.number(),
  isNewCategory: z.boolean(),
  noveltyBonus: z.number(),
  rawScore: z.number(),
  topScore: z.number(),
  confidence: z.number(),
  calculationText: z.string(),
});

export const CulturalSignalSchema: z.ZodType<CulturalSignal> = z.object({
  entityId: z.string().min(1),
  entityType: z.string().min(1),
  label: z.string().min(1),
  affinity: z.number(),
  candidateAffinity: z.number().optional(),
  qloo_request: QlooRequestAuditSchema.nullable().optional(),
  qloo_response: z.unknown().nullable().optional(),
});

export const RecommendationSchema: z.ZodType<Recommendation> = z.object({
  name: z.string().min(1),
  entityId: z.string().min(1),
  category: z.string().min(1),
  confidence: z.number(),
  supportingSignals: z.array(CulturalSignalSchema).min(1),
  explanation: z.string().optional(),
  qloo_request: QlooRequestAuditSchema.nullable().optional(),
  qloo_response: z.unknown().nullable().optional(),
  toolTraces: z.array(ToolTraceSchema).optional(),
  ranking: RankingBreakdownSchema.optional(),
});

export const RecommendRequestSchema = z.object({
  resolved: z.array(ResolvedEntitySchema).min(1, "resolved must not be empty"),
});

export const ExplainRequestSchema = z.object({
  recommendations: z
    .array(RecommendationSchema)
    .min(1, "recommendations must not be empty")
    .max(10, "at most 10 recommendations per request"),
});

/** Flattens zod issues into the same shape the CSV parser reports. */
export function zodIssues(error: z.ZodError): Issue[] {
  return error.issues.map((i) => ({
    field: i.path.join(".") || undefined,
    message: i.message,
  }));
}
