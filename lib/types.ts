// ---------- Domain types ----------

export interface Product {
  name: string;
  category: string;
  description: string;
}

export interface ResolvedEntity {
  product: Product;
  qlooId: string;
  qlooType: string;
  confidence: number;
  label: string;
}

export interface CulturalSignal {
  entityId: string;
  entityType: string;
  label: string;
  // Qloo affinity between this signal and the entity it was found for
  // (the product's Qloo entity in stage 2).
  affinity: number;
  // Set in stage 3: Qloo's affinity between this signal and the candidate
  // it helped surface (the number that explains the recommendation).
  candidateAffinity?: number;
}

export interface Recommendation {
  name: string;
  // Qloo entity ID of the recommended entity itself.
  entityId: string;
  category: string;
  confidence: number;
  supportingSignals: CulturalSignal[];
  explanation?: string;
}

// Stage 3 output: an entity Qloo surfaced from one or more cultural signals.
export interface Candidate {
  name: string;
  entityId: string;
  category: string;
  signals: CulturalSignal[];
  totalAffinity: number;
}

// ---------- Qloo response shapes ----------
// Written from third-party documentation of the live API, NOT yet verified
// against our own calls. scripts/test-qloo.ts prints the raw body so any
// mismatch is visible. Fields beyond the ones named here are kept via the
// index signatures rather than dropped.

export interface QlooEntity {
  entity_id: string;
  name: string;
  types?: string[];
  popularity?: number;
  // Affinity for insights results is expected under `query.affinity`.
  query?: { affinity?: number; [key: string]: unknown };
  [key: string]: unknown;
}

// GET /search
export interface QlooSearchResponse {
  success?: boolean;
  results: QlooEntity[];
  [key: string]: unknown;
}

// GET /v2/insights
export interface QlooInsightsResponse {
  success?: boolean;
  results: {
    entities: QlooEntity[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
