import type { StoredRecommendation } from "./memory";
import type { Recommendation } from "./types";

// Browser-local decision memory. This is single-browser demo state stored in
// localStorage: it is not synced, not private across users of the same
// browser profile, and is lost if site data is cleared.

export const LOCAL_MEMORY_KEY = "cultivar:memory";

/** Drops raw Qloo payloads so saved decisions stay small enough for localStorage. */
export function slimRecommendation(rec: Recommendation): Recommendation {
  return {
    name: rec.name,
    entityId: rec.entityId,
    category: rec.category,
    confidence: rec.confidence,
    explanation: rec.explanation,
    explanationFallback: rec.explanationFallback,
    ranking: rec.ranking,
    supportingSignals: rec.supportingSignals.map((s) => ({
      entityId: s.entityId,
      entityType: s.entityType,
      label: s.label,
      affinity: s.affinity,
      candidateAffinity: s.candidateAffinity,
      sourceProduct: s.sourceProduct,
      sourceEntityId: s.sourceEntityId,
      seasonalMultiplier: s.seasonalMultiplier,
      qloo_request: s.qloo_request ?? null,
    })),
  };
}

function isStoredRecord(value: unknown): value is StoredRecommendation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.accepted === "boolean" &&
    typeof v.savedAt === "string" &&
    typeof v.recommendation === "object" &&
    v.recommendation !== null
  );
}

export function readLocalMemory(): StoredRecommendation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_MEMORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStoredRecord) : [];
  } catch {
    return [];
  }
}

function writeLocalMemory(records: StoredRecommendation[]): void {
  window.localStorage.setItem(LOCAL_MEMORY_KEY, JSON.stringify(records));
}

export function saveLocalDecision(
  rec: Recommendation,
  accepted: boolean,
  month?: number,
): StoredRecommendation {
  const entry: StoredRecommendation = {
    id: `local-${rec.entityId.slice(0, 8)}-${Date.now()}`,
    recommendation: slimRecommendation(rec),
    accepted,
    month,
    savedAt: new Date().toISOString(),
  };
  writeLocalMemory([...readLocalMemory(), entry]);
  return entry;
}

export function clearLocalMemory(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LOCAL_MEMORY_KEY);
}

/**
 * Merges browser-local and local-demo-file records. Decisions saved through
 * the UI are written to both, so duplicates (same entity, decision, and
 * timestamp within a few seconds) are collapsed. Newest first.
 */
export function mergeMemory(
  local: StoredRecommendation[],
  server: StoredRecommendation[],
): StoredRecommendation[] {
  const merged = [...local];
  for (const s of server) {
    const dup = merged.some(
      (l) =>
        l.recommendation.entityId === s.recommendation.entityId &&
        l.accepted === s.accepted &&
        Math.abs(new Date(l.savedAt).getTime() - new Date(s.savedAt).getTime()) < 10_000,
    );
    if (!dup) merged.push(s);
  }
  return merged.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

