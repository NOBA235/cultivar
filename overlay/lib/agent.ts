import { getCulturalAffinities, QlooHttpError, resolveEntity } from "./qloo";
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

// ---------- Helpers ----------

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

async function attemptResolve(
  query: string,
  type: string,
): Promise<ResolveAttempt | "rejected" | null> {
  let response: QlooSearchResponse;
  try {
    response = await resolveEntity(query, type);
  } catch (err) {
    // Only a 400 (Qloo not accepting this type URN) moves on to the next
    // type. Anything else, including 429 and 5xx, propagates.
    if (err instanceof QlooHttpError && err.status === 400) return "rejected";
    throw err;
  }

  let best: ResolveAttempt | null = null;
  for (const entity of response.results.slice(0, RESOLVE_RESULTS_CONSIDERED)) {
    if (!isUsableEntity(entity)) continue;
    const confidence = similarity(query, entity.name);
    if (!best || confidence > best.confidence) {
      best = { entity, type, query, confidence };
    }
  }
  return best;
}

async function resolveOne(product: Product): Promise<ResolvedEntity | null> {
  let best: ResolveAttempt | null = null;

  // Name first; if no type reaches the threshold, retry with the category.
  for (const query of [product.name, product.category]) {
    for (const type of RESOLVE_TYPES) {
      const attempt = await attemptResolve(query, type);
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
): Promise<ResolvedEntity[]> {
  const resolved: ResolvedEntity[] = [];
  for (const product of products) {
    const entity = await resolveOne(product);
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
): Promise<Map<string, CulturalSignal[]>> {
  const out = new Map<string, CulturalSignal[]>();

  for (const entity of entities) {
    const name = entity.product.name;
    const all: CulturalSignal[] = [];

    for (const domain of SIGNAL_DOMAINS) {
      const response = await getCulturalAffinities(entity.qlooId, domain, {
        take: SIGNALS_PER_DOMAIN_REQUESTED,
      });
      let skipped = 0;
      for (const e of response.results.entities) {
        const affinity = readAffinity(e);
        if (!isUsableEntity(e) || affinity === undefined) {
          skipped++;
          continue;
        }
        all.push({
          entityId: e.entity_id,
          entityType: e.types?.[0] ?? domain,
          label: e.name,
          affinity,
        });
      }
      if (skipped > 0) {
        console.log(
          `[agent:signals] "${name}" → ${domain}: skipped ${skipped} entities with no id/name/affinity`,
        );
      }
    }

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

  const byId = new Map<string, Candidate>();
  for (const signal of distinct.values()) {
    const response = await getCulturalAffinities(
      signal.entityId,
      CANDIDATE_TYPE,
      { take: CANDIDATES_PER_SIGNAL },
    );

    let added = 0;
    let inCatalog = 0;
    let unscored = 0;
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
      let candidate = byId.get(e.entity_id);
      if (!candidate) {
        candidate = {
          name: e.name,
          entityId: e.entity_id,
          category: extractCategory(e),
          signals: [],
          totalAffinity: 0,
        };
        byId.set(e.entity_id, candidate);
      }
      candidate.signals.push({ ...signal, candidateAffinity: affinity });
      candidate.totalAffinity += affinity;
      added++;
    }
    console.log(
      `[agent:candidates] "${signal.label}" [${signal.entityId}] → ${added} candidates` +
        ` (${inCatalog} matched catalog, ${unscored} unscored)`,
    );
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
      const score =
        c.totalAffinity *
        Math.log(c.signals.length + 1) *
        (isNew ? NOVELTY_BONUS : 1.0);
      return { c, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_RECOMMENDATIONS);

  if (scored.length === 0) return [];
  const top = scored[0].score;

  return scored.map(({ c, score }) => ({
    name: c.name,
    entityId: c.entityId,
    category: c.category,
    confidence: top > 0 ? Math.round((score / top) * 100) : 0,
    supportingSignals: [...c.signals]
      .sort((a, b) => (b.candidateAffinity ?? 0) - (a.candidateAffinity ?? 0))
      .slice(0, TOP_SUPPORTING_SIGNALS),
  }));
}

// ---------- Orchestration ----------

export interface AgentTrace {
  resolved: ResolvedEntity[];
  signals: Map<string, CulturalSignal[]>;
  candidates: Candidate[];
}

/**
 * Runs all four stages. Pass `trace` to receive each stage's output (used by
 * scripts/reality-check.ts). Throws if any stage comes back empty.
 */
export async function runAgent(
  products: Product[],
  trace?: Partial<AgentTrace>,
): Promise<Recommendation[]> {
  if (products.length === 0) {
    throw new Error("runAgent: no products were provided.");
  }

  console.time("agent:stage1:resolve");
  const resolved = await resolveProducts(products);
  console.timeEnd("agent:stage1:resolve");
  if (trace) trace.resolved = resolved;
  if (resolved.length === 0) {
    throw new Error(
      "Stage 1 (resolve) found no Qloo entity for any product, by name or by category.",
    );
  }

  console.time("agent:stage2:signals");
  const signals = await mapCulturalSignals(resolved);
  console.timeEnd("agent:stage2:signals");
  if (trace) trace.signals = signals;
  const signalCount = Array.from(signals.values()).reduce(
    (n, list) => n + list.length,
    0,
  );
  if (signalCount === 0) {
    throw new Error(
      `Stage 2 (signals) produced no signals above affinity ${SIGNAL_MIN_AFFINITY}. ` +
        "If the log shows entities skipped for a missing affinity, the /v2/insights response " +
        "shape differs from lib/types.ts: inspect one raw response.",
    );
  }

  console.time("agent:stage3:candidates");
  const candidates = await findAdjacentProducts(signals);
  console.timeEnd("agent:stage3:candidates");
  if (trace) trace.candidates = candidates;
  if (candidates.length === 0) {
    throw new Error(
      "Stage 3 (candidates) found no adjacent products for any signal.",
    );
  }

  console.time("agent:stage4:rank");
  const recommendations = rankAndFilter(candidates, products);
  console.timeEnd("agent:stage4:rank");
  if (recommendations.length === 0) {
    throw new Error(
      `Stage 4 (rank) left nothing: no candidate was backed by at least ${MIN_SUPPORTING_SIGNALS} distinct signals.`,
    );
  }

  return recommendations;
}
