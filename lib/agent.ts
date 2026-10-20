import {
  getCulturalAffinitiesWithAudit,
  QlooHttpError,
  resolveEntity,
} from "./qloo";
import type {
  Candidate,
  CulturalSignal,
  Product,
  QlooEntity,
  QlooSearchResponse,
  Recommendation,
  ResolvedEntity,
} from "./types";

// Four-stage pipeline. Every entity ID and affinity score in the output comes
// from a live Qloo call. No LLM is involved, and nothing here invents data:
// when Qloo returns nothing usable, the stage throws.

// ---------- Tunables (from the Phase 2 spec unless noted) ----------

// Stage 1. Tried in this order. Qloo may reject some of these URNs with a 400;
// that is logged and the next type is tried.
const RESOLVE_TYPES = [
  "urn:entity:brand",
  "urn:entity:product",
  "urn:entity:restaurant",
] as const;
const RESOLVE_CONFIDENCE_THRESHOLD = 0.5;
const RESOLVE_RESULTS_CONSIDERED = 10; // not in spec

// Stage 2. "fashion_brands" has no verified Qloo tag, so brands are unfiltered.
const SIGNAL_DOMAINS = [
  "urn:entity:artist", // musicians
  "urn:entity:movie",
  "urn:entity:brand", // fashion brands (not fashion-restricted)
  "urn:entity:book",
  "urn:entity:destination",
] as const;
const SIGNALS_PER_DOMAIN_REQUESTED = 20; // not in spec
const SIGNALS_KEPT_PER_ENTITY = 20;
const SIGNAL_MIN_AFFINITY = 0.3;

// Stage 3. Qloo has no "product" entity type; brand is the closest. (not in spec)
const CANDIDATE_TYPE = "urn:entity:brand";
const CANDIDATES_PER_SIGNAL = 10; // not in spec
const CATALOG_NAME_SIMILARITY = 0.8; // not in spec

// Stage 4
const NOVELTY_BONUS = 1.5;
const TOP_RECOMMENDATIONS = 3;
const TOP_SUPPORTING_SIGNALS = 5;
const MIN_SUPPORTING_SIGNALS = 2; // Phase 2 acceptance: every rec has >= 2

// Max Qloo requests in flight at once (Phase 3: kept at 3 to avoid Qloo 429 rate limits).
const QLOO_CONCURRENCY = 3;

// ---------- Helpers ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Bounded-parallel map. Results keep input order, so downstream merging is
 * deterministic regardless of which request finishes first. The first
 * rejection stops new work from starting and is rethrown.
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
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

/**
 * Dice coefficient over character bigrams, 0..1. This is a LOCAL string
 * match score, not a Qloo score.
 */
export function similarity(a: string, b: string): number {
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

export function matchesCatalog(name: string, catalogNames: string[]): boolean {
  const n = normalize(name);
  return catalogNames.some((catalogName) => {
    const c = normalize(catalogName);
    if (!c || !n) return false;
    if (n === c) return true;
    if (c.length >= 5 && n.includes(c)) return true;
    if (n.length >= 5 && c.includes(n)) return true;
    return similarity(n, c) >= CATALOG_NAME_SIMILARITY;
  });
}

function isUsableEntity(e: QlooEntity): boolean {
  return typeof e.entity_id === "string" && typeof e.name === "string";
}

/** Affinity as returned by Qloo, or undefined if the entity carries none. */
function readAffinity(e: QlooEntity): number | undefined {
  const affinity = e.query?.affinity;
  return typeof affinity === "number" ? affinity : undefined;
}

/** Category taken from the Qloo entity's own tags; falls back to its type URN. */
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

function fmt(n: number): string {
  return n.toFixed(4);
}

// ---------- Stage 1: resolve ----------

interface ResolveAttempt {
  entity: QlooEntity;
  type: string;
  query: string;
  confidence: number;
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

  // Stop words that shouldn't grant high confidence by themselves
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

async function attemptResolve(
  query: string,
  type: string,
  signal?: AbortSignal,
): Promise<ResolveAttempt | "rejected" | null> {
  let response: QlooSearchResponse;
  try {
    response = await resolveEntity(query, type, { signal });
  } catch (err) {
    // Only a 400 (Qloo not accepting this type URN) moves on to the next
    // type. Anything else, including 429, 5xx and aborts, propagates.
    if (err instanceof QlooHttpError && err.status === 400) return "rejected";
    throw err;
  }

  let best: ResolveAttempt | null = null;
  const results = response.results.slice(0, RESOLVE_RESULTS_CONSIDERED);
  for (let i = 0; i < results.length; i++) {
    const entity = results[i];
    if (!isUsableEntity(entity)) continue;
    const confidence = computeConfidence(query, entity.name, i);
    if (!best || confidence > best.confidence) {
      best = { entity, type, query, confidence };
    }
  }
  return best;
}

async function resolveOne(
  product: Product,
  signal?: AbortSignal,
  overrideType?: string,
): Promise<ResolvedEntity | null> {
  let best: ResolveAttempt | null = null;
  const typesToTry = overrideType
    ? [overrideType, ...RESOLVE_TYPES.filter((t) => t !== overrideType)]
    : RESOLVE_TYPES;

  // Name first; if no type reaches the threshold, retry with the category.
  for (const query of [product.name, product.category]) {
    for (const type of typesToTry) {
      const attempt = await attemptResolve(query, type, signal);
      const tag = `[type=${type} query="${query}"]`;

      if (attempt === "rejected") {
        console.log(
          `[agent:resolve] "${product.name}" → type rejected by Qloo (400) ${tag}`,
        );
        continue;
      }
      if (attempt === null) {
        console.log(`[agent:resolve] "${product.name}" → no result ${tag}`);
        continue;
      }

      console.log(
        `[agent:resolve] "${product.name}" → ${attempt.entity.entity_id} (${attempt.confidence.toFixed(2)}) ${tag} matched="${attempt.entity.name}"`,
      );
      if (!best || attempt.confidence > best.confidence) best = attempt;
      if (attempt.confidence >= RESOLVE_CONFIDENCE_THRESHOLD) {
        return toResolved(product, attempt);
      }
    }
  }

  if (!best) return null;
  console.log(
    `[agent:resolve] "${product.name}" → LOW CONFIDENCE, keeping best attempt ${best.entity.entity_id} (${best.confidence.toFixed(2)})`,
  );
  return toResolved(product, best);
}

function toResolved(product: Product, a: ResolveAttempt): ResolvedEntity {
  return {
    product,
    qlooId: a.entity.entity_id,
    qlooType: a.type,
    confidence: a.confidence,
    label: a.entity.name,
  };
}

/**
 * Stage 1. `confidence` is a local name-similarity score (0..1) between the
 * query and the matched Qloo entity's name. Qloo's search does not supply one.
 */
export async function resolveProducts(
  products: Product[],
  signal?: AbortSignal,
  overrideType?: string,
): Promise<ResolvedEntity[]> {
  const resolved: ResolvedEntity[] = [];
  for (const product of products) {
    const entity = await resolveOne(product, signal, overrideType);
    if (entity) {
      resolved.push(entity);
    } else {
      console.log(
        `[agent:resolve] "${product.name}" → UNRESOLVED (no Qloo entity for name or category)`,
      );
    }
  }
  return resolved;
}

// ---------- Stage 2: cultural signals ----------

export async function mapCulturalSignals(
  entities: ResolvedEntity[],
  signal?: AbortSignal,
): Promise<Map<string, CulturalSignal[]>> {
  const out = new Map<string, CulturalSignal[]>();

  for (const entity of entities) {
    const name = entity.product.name;
    const domainResults = await mapLimit(
      SIGNAL_DOMAINS,
      QLOO_CONCURRENCY,
      async (domain) => {
        try {
          const auditRes = await getCulturalAffinitiesWithAudit(entity.qlooId, domain, {
            take: SIGNALS_PER_DOMAIN_REQUESTED,
            signal,
          });
          const response = auditRes.data;
          const signals: CulturalSignal[] = [];
          let skipped = 0;
          for (const e of response.results.entities) {
            const affinity = readAffinity(e);
            if (!isUsableEntity(e) || affinity === undefined) {
              skipped++;
              continue;
            }
            signals.push({
              entityId: e.entity_id,
              entityType: e.types?.[0] ?? domain,
              label: e.name,
              affinity,
              qloo_request: auditRes.request,
              qloo_response: auditRes.response,
            });
          }
          if (skipped > 0) {
            console.log(
              `[agent:signals] "${name}" → ${domain}: skipped ${skipped} entities with no id/name/affinity`,
            );
          }
          return signals;
        } catch (err) {
          if (err instanceof QlooHttpError && err.status === 400) {
            console.log(`[agent:signals] "${name}" → ${domain}: rejected by Qloo (400)`);
            return [];
          }
          throw err;
        }
      },
    );

    const all = domainResults.flat();
    const kept = all
      .filter((s) => s.affinity > SIGNAL_MIN_AFFINITY)
      .sort((a, b) => b.affinity - a.affinity)
      .slice(0, SIGNALS_KEPT_PER_ENTITY);

    if (kept.length === 0) {
      console.log(
        `[agent:signals] "${name}" → no signals above ${SIGNAL_MIN_AFFINITY} (${all.length} returned)`,
      );
    }
    for (const s of kept) {
      console.log(
        `[agent:signals] "${name}" → "${s.label}" (${fmt(s.affinity)}) [${s.entityId}]`,
      );
    }
    out.set(name, kept);
  }
  return out;
}

// ---------- Stage 3: adjacent products ----------

export async function findAdjacentProducts(
  signals: Map<string, CulturalSignal[]>,
  abortSignal?: AbortSignal,
): Promise<Candidate[]> {
  // The map keys are the user's catalog product names.
  const catalogNames = Array.from(signals.keys());

  // One query per distinct signal entity: the same signal reached from two
  // products is a single piece of evidence, not two.
  const distinct = new Map<string, CulturalSignal>();
  for (const list of signals.values()) {
    for (const s of list) {
      if (!distinct.has(s.entityId)) distinct.set(s.entityId, s);
    }
  }

  // Take the strongest distinct signals by affinity across the catalog
  const signalList = Array.from(distinct.values())
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, 12);
  const byId = new Map<string, Candidate>();

  const results = await mapLimit(
    signalList,
    QLOO_CONCURRENCY,
    async (signal) => {
      try {
        const auditRes = await getCulturalAffinitiesWithAudit(
          signal.entityId,
          CANDIDATE_TYPE,
          { take: CANDIDATES_PER_SIGNAL, signal: abortSignal },
        );
        const response = auditRes.data;
        let added = 0;
        let inCatalog = 0;
        let unscored = 0;
        const matched: { candidate: QlooEntity; affinity: number }[] = [];
        for (const e of response.results.entities) {
          const affinity = readAffinity(e);
          if (!isUsableEntity(e) || affinity === undefined) {
            unscored++;
            continue;
          }
          if (matchesCatalog(e.name, catalogNames)) {
            inCatalog++;
            continue;
          }
          matched.push({ candidate: e, affinity });
          added++;
        }
        console.log(
          `[agent:candidates] "${signal.label}" [${signal.entityId}] → ${added} candidates` +
            ` (${inCatalog} matched catalog, ${unscored} unscored)`,
        );
        return { signal, matched, request: auditRes.request, response: auditRes.response };
      } catch (err) {
        if (err instanceof QlooHttpError && err.status === 400) {
          console.log(
            `[agent:candidates] "${signal.label}" [${signal.entityId}] → rejected by Qloo as seed (400)`,
          );
          return { signal, matched: [], request: null, response: null };
        }
        throw err;
      }
    },
  );

  for (const { signal, matched, request, response } of results) {
    for (const { candidate: e, affinity } of matched) {
      let candidate = byId.get(e.entity_id);
      if (!candidate) {
        candidate = {
          name: e.name,
          entityId: e.entity_id,
          category: extractCategory(e),
          signals: [],
          totalAffinity: 0,
          rawAudit: request ? { qloo_request: request, qloo_response: response } : undefined,
          toolTraces: [],
        };
        byId.set(e.entity_id, candidate);
      }
      candidate.signals.push({ ...signal, candidateAffinity: affinity });
      candidate.totalAffinity += affinity;
      if (request) {
        candidate.toolTraces?.push({
          tool: "find_adjacent_products",
          input: { signal: signal.label, entityId: signal.entityId },
          qloo_request: request,
          qloo_response: response,
          explanation: `Surfaced candidate "${e.name}" from signal "${signal.label}" with affinity ${affinity.toFixed(4)}.`,
        });
      }
    }
  }

  return Array.from(byId.values());
}

// ---------- Stage 4: rank ----------

function tokens(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean);
}

/**
 * Score = totalAffinity x ln(signalCount + 1) x noveltyBonus.
 * noveltyBonus is 1.5 when no word of the candidate's category appears in any
 * catalog product's category. Candidates with fewer than 2 distinct signals
 * are dropped so every recommendation carries at least 2 pieces of evidence.
 * `confidence` is the score relative to the top score (top = 100), so it is
 * a relative rank signal, not an absolute probability.
 */
export function rankAndFilter(
  candidates: Candidate[],
  userCatalog: Product[],
): Recommendation[] {
  const catalogTokens = new Set(userCatalog.flatMap((p) => tokens(p.category)));

  const scored = candidates
    .filter((c) => c.signals.length >= MIN_SUPPORTING_SIGNALS)
    .map((c) => {
      const isNew = !tokens(c.category).some((t) => catalogTokens.has(t));
      const noveltyBonus = isNew ? NOVELTY_BONUS : 1.0;
      const score =
        c.totalAffinity *
        Math.log(c.signals.length + 1) *
        noveltyBonus;
      return { c, score, isNew, noveltyBonus };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_RECOMMENDATIONS);

  if (scored.length === 0) return [];
  const top = scored[0].score;

  return scored.map(({ c, score, isNew, noveltyBonus }) => {
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
        .slice(0, TOP_SUPPORTING_SIGNALS),
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
}

// ---------- Orchestration ----------

export type AgentStage = "resolve" | "signals" | "candidates" | "rank" | "done";

export interface AgentTrace {
  /** The stage currently running (or "done"). Set before each stage starts. */
  stage: AgentStage;
  resolved: ResolvedEntity[];
  signals: Map<string, CulturalSignal[]>;
  candidates: Candidate[];
}

export interface AgentOptions {
  /** Receives each stage's output as soon as that stage finishes. */
  trace?: Partial<AgentTrace>;
  /** Aborting cancels the in-flight Qloo request and stops the pipeline. */
  signal?: AbortSignal;
}

/** A stage finished without error but produced nothing usable. */
export class AgentEmptyStageError extends Error {
  constructor(
    public readonly stage: AgentStage,
    message: string,
  ) {
    super(message);
    this.name = "AgentEmptyStageError";
  }
}

function runId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/**
 * Runs all four stages from raw products. Throws if any stage comes back
 * empty. Used by scripts/reality-check.ts.
 */
export async function runAgent(
  products: Product[],
  options: AgentOptions = {},
): Promise<Recommendation[]> {
  const { trace, signal } = options;
  if (products.length === 0) {
    throw new Error("runAgent: no products were provided.");
  }

  const id = runId();
  if (trace) trace.stage = "resolve";
  console.time(`agent:${id}:stage1:resolve`);
  const resolved = await resolveProducts(products, signal);
  console.timeEnd(`agent:${id}:stage1:resolve`);
  if (trace) trace.resolved = resolved;
  if (resolved.length === 0) {
    throw new AgentEmptyStageError(
      "resolve",
      "Stage 1 (resolve) found no Qloo entity for any product, by name or by category.",
    );
  }

  return runStages2to4(id, resolved, products, options);
}

/**
 * Runs stages 2-4 from entities already resolved in Stage 1 (what
 * /api/recommend receives). The catalog used for novelty and de-duplication
 * is the resolved entities' products.
 */
export async function runAgentFromResolved(
  resolved: ResolvedEntity[],
  options: AgentOptions = {},
): Promise<Recommendation[]> {
  if (resolved.length === 0) {
    throw new Error("runAgentFromResolved: no resolved entities were provided.");
  }
  if (options.trace) options.trace.resolved = resolved;
  return runStages2to4(
    runId(),
    resolved,
    resolved.map((r) => r.product),
    options,
  );
}

async function runStages2to4(
  id: string,
  resolved: ResolvedEntity[],
  catalog: Product[],
  { trace, signal }: AgentOptions,
): Promise<Recommendation[]> {
  if (trace) trace.stage = "signals";
  console.time(`agent:${id}:stage2:signals`);
  const signals = await mapCulturalSignals(resolved, signal);
  console.timeEnd(`agent:${id}:stage2:signals`);
  if (trace) trace.signals = signals;
  const signalCount = Array.from(signals.values()).reduce(
    (n, list) => n + list.length,
    0,
  );
  if (signalCount === 0) {
    throw new AgentEmptyStageError(
      "signals",
      `Stage 2 (signals) produced no signals above affinity ${SIGNAL_MIN_AFFINITY}. ` +
        "If the log shows entities skipped for a missing affinity, the /v2/insights response " +
        "shape differs from lib/types.ts: inspect one raw response.",
    );
  }

  if (trace) trace.stage = "candidates";
  console.time(`agent:${id}:stage3:candidates`);
  const candidates = await findAdjacentProducts(signals, signal);
  console.timeEnd(`agent:${id}:stage3:candidates`);
  if (trace) trace.candidates = candidates;
  if (candidates.length === 0) {
    throw new AgentEmptyStageError(
      "candidates",
      "Stage 3 (candidates) found no adjacent products for any signal.",
    );
  }

  if (trace) trace.stage = "rank";
  console.time(`agent:${id}:stage4:rank`);
  const recommendations = rankAndFilter(candidates, catalog);
  console.timeEnd(`agent:${id}:stage4:rank`);
  if (recommendations.length === 0) {
    throw new AgentEmptyStageError(
      "rank",
      `Stage 4 (rank) left nothing: no candidate was backed by at least ${MIN_SUPPORTING_SIGNALS} distinct signals.`,
    );
  }

  if (trace) trace.stage = "done";
  return recommendations;
}
