import {
  getCulturalAffinitiesWithAudit,
  resolveEntityWithAudit,
  QlooHttpError,
} from "./qloo";
import { generateJson } from "./gemini";
import {
  buildExplainPrompt,
  EXPLAIN_INSTRUCTION,
  EXPLAIN_RESPONSE_SCHEMA,
} from "./prompts";
import { z } from "zod";
import { saveRecommendation, getPastRecommendations } from "./memory";
import type {
  Candidate,
  CulturalSignal,
  Product,
  QlooEntity,
  QlooRequestAudit,
  Recommendation,
  ResolvedEntity,
  ToolResponse,
} from "./types";

// ---------- Helpers & Constants ----------

const RESOLVE_TYPES = [
  "urn:entity:brand",
  "urn:entity:product",
  "urn:entity:restaurant",
] as const;

const RESOLVE_CONFIDENCE_THRESHOLD = 0.5;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bigramCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const grams =
    text.length < 2
      ? [text]
      : Array.from({ length: text.length - 1 }, (_, i) => text.slice(i, i + 2));
  for (const gram of grams) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  return counts;
}

function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const xc = bigramCounts(x);
  const yc = bigramCounts(y);
  let overlap = 0;
  for (const [gram, n] of xc) overlap += Math.min(n, yc.get(gram) ?? 0);
  const total =
    Array.from(xc.values()).reduce((s, n) => s + n, 0) +
    Array.from(yc.values()).reduce((s, n) => s + n, 0);
  return (2 * overlap) / total;
}

function computeConfidence(
  query: string,
  entityName: string,
  rank: number,
): number {
  const q = normalize(query);
  const e = normalize(entityName);
  if (!q || !e) return 0;
  if (q === e) return 1.0;

  const qTokens = q.split(" ").filter(Boolean);
  const eTokens = e.split(" ").filter(Boolean);
  const stopWords = new Set(["the", "a", "an", "and", "or", "hill", "can", "water"]);

  let matchedTokens = 0;
  let hasSubstantiveMatch = false;
  for (const et of eTokens) {
    if (
      qTokens.some(
        (qt) =>
          qt === et ||
          (et.length >= 4 && qt.includes(et)) ||
          (qt.length >= 4 && et.includes(qt)),
      )
    ) {
      matchedTokens++;
      if (!stopWords.has(et)) hasSubstantiveMatch = true;
    }
  }
  const tokenRatio = eTokens.length > 0 ? matchedTokens / eTokens.length : 0;
  const dice = similarity(q, e);

  let score = Math.max(dice, tokenRatio * 0.8);
  if (rank <= 1 && hasSubstantiveMatch && (tokenRatio >= 0.33 || matchedTokens >= 1)) {
    score = Math.max(score, 0.84);
  }
  return Number(Math.min(1.0, score).toFixed(2));
}

function isUsableEntity(e: QlooEntity): boolean {
  return typeof e.entity_id === "string" && typeof e.name === "string";
}

function readAffinity(e: QlooEntity): number | undefined {
  const affinity = e.query?.affinity;
  return typeof affinity === "number" ? affinity : undefined;
}

function extractCategory(e: QlooEntity): string {
  const tags = e["tags"];
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag === "string" && tag) return tag;
      if (isRecord(tag) && typeof tag.name === "string" && tag.name) {
        return tag.name;
      }
    }
  }
  return e.types?.[0] ?? "unknown";
}

// ---------- Tool 1: resolve_product ----------

export interface ResolveProductInput {
  product_name: string;
  category?: string;
  description?: string;
  overrideType?: string;
  signal?: AbortSignal;
}

export async function resolve_product(
  input: ResolveProductInput | string,
): Promise<ToolResponse<ResolvedEntity>> {
  const rawInput: ResolveProductInput =
    typeof input === "string" ? { product_name: input } : input;

  const { product_name, category = "", description = "", overrideType, signal } = rawInput;
  const product: Product = { name: product_name, category, description };

  const typesToTry = overrideType
    ? [overrideType, ...RESOLVE_TYPES.filter((t) => t !== overrideType)]
    : RESOLVE_TYPES;

  let bestMatch: {
    entity: QlooEntity;
    type: string;
    confidence: number;
    request: QlooRequestAudit;
    response: unknown;
  } | null = null;

  for (const query of [product.name, product.category].filter(Boolean)) {
    for (const type of typesToTry) {
      try {
        const audit = await resolveEntityWithAudit(query, type, { signal });
        const results = audit.data.results.slice(0, 10);
        for (let i = 0; i < results.length; i++) {
          const entity = results[i];
          if (!isUsableEntity(entity)) continue;
          const conf = computeConfidence(query, entity.name, i);
          if (!bestMatch || conf > bestMatch.confidence) {
            bestMatch = {
              entity,
              type,
              confidence: conf,
              request: audit.request,
              response: audit.response,
            };
          }
        }
        if (bestMatch && bestMatch.confidence >= RESOLVE_CONFIDENCE_THRESHOLD) {
          break;
        }
      } catch (err) {
        if (err instanceof QlooHttpError && err.status === 400) continue;
        throw err;
      }
    }
    if (bestMatch && bestMatch.confidence >= RESOLVE_CONFIDENCE_THRESHOLD) {
      break;
    }
  }

  if (!bestMatch) {
    throw new Error(`Could not resolve product "${product_name}" to any Qloo entity.`);
  }

  const resolved: ResolvedEntity = {
    product,
    qlooId: bestMatch.entity.entity_id,
    qlooType: bestMatch.type,
    confidence: bestMatch.confidence,
    label: bestMatch.entity.name,
  };

  return {
    result: resolved,
    qloo_request: bestMatch.request,
    qloo_response: bestMatch.response,
    explanation: `Resolved "${product_name}" to "${resolved.label}" (ID: ${resolved.qlooId}) with confidence ${resolved.confidence.toFixed(2)}.`,
  };
}

// ---------- Tool 2: get_cultural_affinities ----------

export interface GetCulturalAffinitiesInput {
  entity_id: string;
  domain?: string;
  take?: number;
  signal?: AbortSignal;
}

export async function get_cultural_affinities(
  input: GetCulturalAffinitiesInput | string,
): Promise<ToolResponse<CulturalSignal[]>> {
  const entity_id = typeof input === "string" ? input : input.entity_id;
  const domain = typeof input === "string" ? "urn:entity:artist" : input.domain ?? "urn:entity:artist";
  const take = typeof input === "string" ? 20 : input.take ?? 20;
  const abortSignal = typeof input === "string" ? undefined : input.signal;

  const audit = await getCulturalAffinitiesWithAudit(entity_id, domain, {
    take,
    signal: abortSignal,
  });

  const signals: CulturalSignal[] = [];
  for (const e of audit.data.results.entities) {
    const affinity = readAffinity(e);
    if (!isUsableEntity(e) || affinity === undefined) continue;
    if (affinity > 0.3) {
      signals.push({
        entityId: e.entity_id,
        entityType: e.types?.[0] ?? domain,
        label: e.name,
        affinity,
      });
    }
  }

  signals.sort((a, b) => b.affinity - a.affinity);

  return {
    result: signals,
    qloo_request: audit.request,
    qloo_response: audit.response,
    explanation: `Retrieved ${signals.length} cultural signals in domain "${domain}" for entity ${entity_id}.`,
  };
}

// ---------- Tool 3: find_adjacent_products ----------

export interface FindAdjacentProductsInput {
  signal: CulturalSignal | string;
  take?: number;
  catalogNames?: string[];
  abortSignal?: AbortSignal;
}

export async function find_adjacent_products(
  input: FindAdjacentProductsInput | CulturalSignal | string,
): Promise<ToolResponse<Candidate[]>> {
  let signalEntityId: string;
  let signalObj: CulturalSignal;
  let take = 10;
  let catalogNames: string[] = [];
  let abortSignal: AbortSignal | undefined;

  if (typeof input === "string") {
    signalEntityId = input;
    signalObj = {
      entityId: input,
      entityType: "urn:entity:brand",
      label: input,
      affinity: 0.8,
    };
  } else if ("entityId" in input) {
    signalEntityId = input.entityId;
    signalObj = input;
  } else {
    signalObj =
      typeof input.signal === "string"
        ? {
            entityId: input.signal,
            entityType: "urn:entity:brand",
            label: input.signal,
            affinity: 0.8,
          }
        : input.signal;
    signalEntityId = signalObj.entityId;
    take = input.take ?? 10;
    catalogNames = input.catalogNames ?? [];
    abortSignal = input.abortSignal;
  }

  const audit = await getCulturalAffinitiesWithAudit(
    signalEntityId,
    "urn:entity:brand",
    { take, signal: abortSignal },
  );

  const candidates: Candidate[] = [];
  for (const e of audit.data.results.entities) {
    const affinity = readAffinity(e);
    if (!isUsableEntity(e) || affinity === undefined) continue;
    if (catalogNames.some((cat) => normalize(cat) === normalize(e.name))) continue;

    candidates.push({
      name: e.name,
      entityId: e.entity_id,
      category: extractCategory(e),
      signals: [{ ...signalObj, candidateAffinity: affinity }],
      totalAffinity: affinity,
    });
  }

  return {
    result: candidates,
    qloo_request: audit.request,
    qloo_response: audit.response,
    explanation: `Found ${candidates.length} adjacent product candidates from cultural signal "${signalObj.label}" (${signalEntityId}).`,
  };
}

// ---------- Tool 4: rank_candidates ----------

export interface RankCandidatesInput {
  candidates: Candidate[];
  catalog: (Product | ResolvedEntity)[];
}

export async function rank_candidates(
  input: RankCandidatesInput,
): Promise<ToolResponse<Recommendation[]>> {
  const { candidates, catalog } = input;
  const userCatalog: Product[] = catalog.map((c) => ("product" in c ? c.product : c));
  const catalogTokens = new Set(
    userCatalog.flatMap((p) => normalize(p.category).split(" ").filter(Boolean)),
  );

  const scored = candidates
    .filter((c) => c.signals.length >= 2)
    .map((c) => {
      const isNew = !normalize(c.category)
        .split(" ")
        .filter(Boolean)
        .some((t) => catalogTokens.has(t));
      const noveltyBonus = isNew ? 1.5 : 1.0;
      const score =
        c.totalAffinity * Math.log(c.signals.length + 1) * noveltyBonus;
      return { c, score, isNew, noveltyBonus };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const top = scored[0]?.score ?? 1;

  const recommendations: Recommendation[] = scored.map(({ c, score, isNew, noveltyBonus }) => {
    const confidence = top > 0 ? Math.round((score / top) * 100) : 0;
    const totalAffinityFormatted = Number(c.totalAffinity.toFixed(4));
    const rawScoreFormatted = Number(score.toFixed(4));
    const topScoreFormatted = Number(top.toFixed(4));
    const calculationText = `${totalAffinityFormatted} × ln(${c.signals.length} + 1) × ${noveltyBonus.toFixed(1)} = ${rawScoreFormatted} (relative to top score ${topScoreFormatted}: ${confidence}%)`;

    return {
      name: c.name,
      entityId: c.entityId,
      category: c.category,
      confidence,
      supportingSignals: [...c.signals]
        .sort((a, b) => (b.candidateAffinity ?? 0) - (a.candidateAffinity ?? 0))
        .slice(0, 5),
      qloo_request: c.rawAudit?.qloo_request ?? null,
      qloo_response: c.rawAudit?.qloo_response ?? null,
      toolTraces: c.toolTraces ?? [],
      ranking: {
        formula: "totalAffinity × ln(signalCount + 1) × noveltyBonus",
        totalAffinity: totalAffinityFormatted,
        signalCount: c.signals.length,
        isNewCategory: isNew,
        noveltyBonus,
        rawScore: rawScoreFormatted,
        topScore: topScoreFormatted,
        confidence,
        calculationText,
      },
    };
  });

  return {
    result: recommendations,
    qloo_request: null,
    qloo_response: null,
    explanation: `Ranked ${candidates.length} candidates against ${userCatalog.length} catalog items into ${recommendations.length} final recommendations.`,
  };
}

// ---------- Tool 5: explain_recommendation ----------

const ExplanationSchema = z.object({ explanation: z.string().trim().min(1) });

export interface ExplainRecommendationInput {
  rec: Recommendation;
  signal?: AbortSignal;
}

export async function explain_recommendation(
  input: ExplainRecommendationInput | Recommendation,
): Promise<ToolResponse<string>> {
  const rec = "rec" in input ? input.rec : input;
  const abortSignal = "rec" in input ? input.signal : undefined;

  const { explanation } = await generateJson({
    label: `explain "${rec.name}"`,
    systemInstruction: EXPLAIN_INSTRUCTION,
    prompt: buildExplainPrompt(rec),
    jsonSchema: EXPLAIN_RESPONSE_SCHEMA,
    schema: ExplanationSchema,
    signal: abortSignal,
  });

  return {
    result: explanation,
    qloo_request: null,
    qloo_response: null,
    explanation: `Generated 1-sentence cultural explanation for "${rec.name}": "${explanation}"`,
  };
}

// ---------- Tool 6: remember_recommendation ----------

export interface RememberRecommendationInput {
  rec: Recommendation;
  accepted: boolean;
  notes?: string;
}

export async function remember_recommendation(
  input: RememberRecommendationInput,
): Promise<ToolResponse<{ success: boolean; id: string; accepted: boolean }>> {
  const entry = await saveRecommendation(input.rec, input.accepted, input.notes);
  return {
    result: { success: true, id: entry.id, accepted: entry.accepted },
    qloo_request: null,
    qloo_response: null,
    explanation: `Stored recommendation "${input.rec.name}" (${input.rec.entityId}) in memory with accepted=${input.accepted}.`,
  };
}

// ---------- Tool 7: recall_past_recommendations ----------

export async function recall_past_recommendations(): Promise<
  ToolResponse<Recommendation[]>
> {
  const recs = await getPastRecommendations();
  return {
    result: recs,
    qloo_request: null,
    qloo_response: null,
    explanation: `Recalled ${recs.length} past recommendations from memory store.`,
  };
}

// ---------- Tool 8: seasonal_trends ----------

export interface SeasonalTrendsInput {
  month: number | string;
  take?: number;
  signal?: AbortSignal;
}

const SEASONAL_ANCHORS: Record<string, { query: string; season: string }> = {
  // Spring: 3, 4, 5
  "3": { query: "Bloom", season: "Spring" },
  "4": { query: "Bloom", season: "Spring" },
  "5": { query: "Bloom", season: "Spring" },
  spring: { query: "Bloom", season: "Spring" },
  // Summer: 6, 7, 8
  "6": { query: "Summer", season: "Summer" },
  "7": { query: "Summer", season: "Summer" },
  "8": { query: "Summer", season: "Summer" },
  summer: { query: "Summer", season: "Summer" },
  // Autumn: 9, 10, 11
  "9": { query: "Harvest", season: "Autumn" },
  "10": { query: "Harvest", season: "Autumn" },
  "11": { query: "Harvest", season: "Autumn" },
  autumn: { query: "Harvest", season: "Autumn" },
  fall: { query: "Harvest", season: "Autumn" },
  // Winter: 12, 1, 2
  "12": { query: "Winter", season: "Winter" },
  "1": { query: "Winter", season: "Winter" },
  "2": { query: "Winter", season: "Winter" },
  winter: { query: "Winter", season: "Winter" },
};

export async function seasonal_trends(
  input: SeasonalTrendsInput | number | string,
): Promise<ToolResponse<CulturalSignal[]>> {
  const rawMonth =
    typeof input === "object" ? String(input.month).toLowerCase().trim() : String(input).toLowerCase().trim();
  const take = typeof input === "object" ? input.take ?? 10 : 10;
  const abortSignal = typeof input === "object" ? input.signal : undefined;

  const anchorConfig = SEASONAL_ANCHORS[rawMonth] ?? { query: "Harvest", season: "Autumn" };

  // First resolve the seasonal anchor entity in Qloo
  const resolveAudit = await resolveEntityWithAudit(anchorConfig.query, "urn:entity:brand", {
    signal: abortSignal,
  });
  const anchorEntity = resolveAudit.data.results[0];
  if (!anchorEntity) {
    throw new Error(`Could not resolve seasonal anchor "${anchorConfig.query}" in Qloo.`);
  }

  // Next query live cultural affinities for that anchor
  const insightsAudit = await getCulturalAffinitiesWithAudit(
    anchorEntity.entity_id,
    "urn:entity:brand",
    { take, signal: abortSignal },
  );

  const signals: CulturalSignal[] = [];
  for (const e of insightsAudit.data.results.entities) {
    const affinity = readAffinity(e);
    if (!isUsableEntity(e) || affinity === undefined) continue;
    signals.push({
      entityId: e.entity_id,
      entityType: e.types?.[0] ?? "urn:entity:brand",
      label: e.name,
      affinity,
    });
  }

  return {
    result: signals,
    qloo_request: insightsAudit.request,
    qloo_response: insightsAudit.response,
    explanation: `Retrieved ${signals.length} live seasonal trend signals for ${anchorConfig.season} (${anchorConfig.query}) from Qloo.`,
  };
}

// ---------- Tool Manifest & Registry ----------

export const TOOL_DEFINITIONS = [
  {
    name: "resolve_product",
    description: "Resolves a raw catalog product name against Qloo's entity database.",
    parameters: z.object({
      product_name: z.string().describe("The product name to resolve"),
      category: z.string().optional().describe("Optional product category"),
      overrideType: z.string().optional().describe("Optional Qloo entity type URN"),
    }),
    handler: resolve_product,
  },
  {
    name: "get_cultural_affinities",
    description: "Fetches cross-domain cultural taste signals (music, film, destinations) for an entity from Qloo.",
    parameters: z.object({
      entity_id: z.string().describe("The Qloo entity ID to get affinities for"),
      domain: z.string().optional().describe("Target entity type URN (e.g. urn:entity:artist)"),
      take: z.number().optional().describe("Maximum entities to retrieve"),
    }),
    handler: get_cultural_affinities,
  },
  {
    name: "find_adjacent_products",
    description: "Surfaces adjacent product candidates from a cultural signal using Qloo cross-domain affinities.",
    parameters: z.object({
      signal: z.string().describe("The signal entity ID or signal object"),
      take: z.number().optional().describe("Number of candidates to surface"),
    }),
    handler: find_adjacent_products,
  },
  {
    name: "rank_candidates",
    description: "Ranks candidate products using affinity, signal diversity, and catalog novelty.",
    parameters: z.object({
      candidates: z.array(z.any()).describe("List of candidate products with signals"),
      catalog: z.array(z.any()).describe("The user's current catalog items"),
    }),
    handler: rank_candidates,
  },
  {
    name: "explain_recommendation",
    description: "Generates a single-sentence cultural explanation for a recommendation based on its Qloo signals.",
    parameters: z.object({
      rec: z.any().describe("The recommendation with supportingSignals"),
    }),
    handler: explain_recommendation,
  },
  {
    name: "remember_recommendation",
    description: "Stores a recommendation decision (accepted or rejected) into persistent memory.",
    parameters: z.object({
      rec: z.any().describe("The recommendation object"),
      accepted: z.boolean().describe("Whether the user accepted the recommendation"),
      notes: z.string().optional().describe("Optional notes"),
    }),
    handler: remember_recommendation,
  },
  {
    name: "recall_past_recommendations",
    description: "Retrieves past saved recommendations from persistent memory store.",
    parameters: z.object({}),
    handler: recall_past_recommendations,
  },
  {
    name: "seasonal_trends",
    description: "Retrieves live seasonal cultural trend signals for a given month or season from Qloo.",
    parameters: z.object({
      month: z.union([z.number(), z.string()]).describe("Month (1-12) or season name ('autumn', 'spring')"),
      take: z.number().optional().describe("Number of trends to return"),
    }),
    handler: seasonal_trends,
  },
] as const;
