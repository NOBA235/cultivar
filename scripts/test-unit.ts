import assert from "node:assert/strict";
import { parseCatalogCsv } from "../lib/schemas";
import { rankAndFilter } from "../lib/agent";
import { rank_candidates } from "../lib/tools";
import { applySeasonalMultipliers } from "../lib/seasonal";
import { mergeMemory, slimRecommendation } from "../lib/localMemory";
import type { Candidate, CulturalSignal, Product, Recommendation } from "../lib/types";
import type { StoredRecommendation } from "../lib/memory";

async function runAllTests() {
  console.log("=== Running Cultivar Offline Unit Tests ===\n");

// -------------------------------------------------------------
// Test 1: parseCatalogCsv
// -------------------------------------------------------------
console.log("Test 1: CSV parsing and row-count limits");

// 1.1 Valid catalog
const validCsv = `product_name,category,description
Alder Street Yirgacheffe,single-origin beans,Bright and floral
Foggy Ferry Cold Brew,cold brew,Smooth dark concentrate
Night Shift Espresso,espresso roast,Rich chocolate notes`;
const validResult = parseCatalogCsv(validCsv);
assert.equal(validResult.ok, true, "Valid CSV should parse successfully");
if (validResult.ok) {
  assert.equal(validResult.products.length, 3);
  assert.equal(validResult.products[0].name, "Alder Street Yirgacheffe");
}

// 1.2 Under min rows (< 2)
const singleRowCsv = `product_name,category,description
Alder Street Yirgacheffe,single-origin beans,Bright and floral`;
const minResult = parseCatalogCsv(singleRowCsv);
assert.equal(minResult.ok, false, "Single row CSV should fail default minRows check");
if (!minResult.ok) {
  assert.match(minResult.issues[0].message, /at least 2/i);
}

// 1.3 Single row allowed with override option (for type re-resolution)
const overrideResult = parseCatalogCsv(singleRowCsv, { minRows: 1 });
assert.equal(overrideResult.ok, true, "Single row CSV should pass with minRows: 1");

// 1.4 Over max rows (> 50)
const manyRows = [
  "product_name,category,description",
  ...Array.from({ length: 55 }, (_, i) => `Product ${i + 1},category,desc`),
].join("\n");
const maxResult = parseCatalogCsv(manyRows);
assert.equal(maxResult.ok, false, "55 rows CSV should fail maxRows check");
if (!maxResult.ok) {
  assert.match(maxResult.issues[0].message, /maximum of 50/i);
}

// 1.5 Missing columns
const badHeaderCsv = `item_name,category,description
Alder Street Yirgacheffe,single-origin beans,Bright and floral
Foggy Ferry Cold Brew,cold brew,Smooth dark concentrate`;
const badHeaderResult = parseCatalogCsv(badHeaderCsv);
assert.equal(badHeaderResult.ok, false, "CSV with missing product_name header should fail");

console.log("✓ CSV parser enforces row limits (2..50) and required headers correctly.\n");

// -------------------------------------------------------------
// Test 2: rankAndFilter and rank_candidates mathematical honesty
// -------------------------------------------------------------
console.log("Test 2: Deterministic ranking formula and evidence honesty");

const userCatalog: Product[] = [
  { name: "Alder Street Yirgacheffe", category: "single-origin beans", description: "coffee" },
  { name: "Foggy Ferry Cold Brew", category: "cold brew", description: "coffee" },
];

const signalA: CulturalSignal = {
  entityId: "sig-artist-1",
  entityType: "urn:entity:artist",
  label: "The Postal Service",
  affinity: 0.88,
  sourceProduct: "Alder Street Yirgacheffe",
};

const signalB: CulturalSignal = {
  entityId: "sig-book-1",
  entityType: "urn:entity:book",
  label: "The Third Plate",
  affinity: 0.76,
  sourceProduct: "Foggy Ferry Cold Brew",
};

const signalC: CulturalSignal = {
  entityId: "sig-movie-1",
  entityType: "urn:entity:movie",
  label: "Jiro Dreams of Sushi",
  affinity: 0.82,
  sourceProduct: "Alder Street Yirgacheffe",
};

// Candidate 1: 3 signals, new category (noveltyBonus = 1.5)
const cand1Signals: CulturalSignal[] = [
  { ...signalA, candidateAffinity: 0.90 },
  { ...signalB, candidateAffinity: 0.80 },
  { ...signalC, candidateAffinity: 0.70 },
];
const cand1TotalAffinity = 0.90 + 0.80 + 0.70; // 2.40
const cand1: Candidate = {
  name: "Valrhona Artisan Cacao",
  entityId: "cand-1",
  category: "artisan chocolate", // new category -> novelty bonus 1.5
  signals: cand1Signals,
  totalAffinity: cand1TotalAffinity,
};

// Candidate 2: 2 signals, overlapping category ("cold brew" in category -> noveltyBonus = 1.0)
const cand2Signals: CulturalSignal[] = [
  { ...signalA, candidateAffinity: 0.85 },
  { ...signalB, candidateAffinity: 0.75 },
];
const cand2TotalAffinity = 0.85 + 0.75; // 1.60
const cand2: Candidate = {
  name: "Stumptown Nitro",
  entityId: "cand-2",
  category: "cold brew beverage", // overlaps "cold brew"
  signals: cand2Signals,
  totalAffinity: cand2TotalAffinity,
};

// Candidate 3: only 1 signal -> must be dropped by MIN_SUPPORTING_SIGNALS (2)
const cand3: Candidate = {
  name: "Single Signal Brand",
  entityId: "cand-3",
  category: "tea infusion",
  signals: [{ ...signalA, candidateAffinity: 0.99 }],
  totalAffinity: 0.99,
};

const recommendations = rankAndFilter([cand1, cand2, cand3], userCatalog);

// Verify candidate 3 was filtered out
assert.equal(recommendations.length, 2, "Candidate with only 1 signal must be dropped");

// Verify candidate 1 formula
const expectedScore1 = cand1TotalAffinity * Math.log(3 + 1) * 1.5; // 2.4 * ln(4) * 1.5
const expectedScore2 = cand2TotalAffinity * Math.log(2 + 1) * 1.0; // 1.6 * ln(3) * 1.0

assert.equal(recommendations[0].name, "Valrhona Artisan Cacao");
assert.equal(recommendations[0].confidence, 100, "Top candidate relative rank score must be 100");
assert.equal(recommendations[0].ranking?.noveltyBonus, 1.5);
assert.equal(recommendations[0].ranking?.signalCount, 3);
assert.ok(
  Math.abs((recommendations[0].ranking?.rawScore ?? 0) - expectedScore1) < 0.001,
  "Candidate 1 raw score must match formula totalAffinity * ln(signalCount + 1) * 1.5",
);

// Verify candidate 2 relative score
const expectedRelative2 = Math.round((expectedScore2 / expectedScore1) * 100);
assert.equal(
  recommendations[1].confidence,
  expectedRelative2,
  `Candidate 2 relative rank score should match expected index ${expectedRelative2}`,
);

// Verify NO fabricated signals:
// supportingSignals must ONLY contain the real signals from cand1 (3 signals), no extra signals with 0.95!
assert.equal(recommendations[0].supportingSignals.length, 3);
for (const sig of recommendations[0].supportingSignals) {
  assert.ok(sig.candidateAffinity !== undefined, "Every supporting signal must have candidateAffinity");
  assert.notEqual(
    Number((sig.affinity * 0.95).toFixed(4)),
    sig.candidateAffinity,
    "Signals must not carry synthetic 0.95 multiplied affinities",
  );
}

// Test tool wrapper rank_candidates
const toolResult = await rank_candidates({
  candidates: [cand1, cand2, cand3],
  catalog: userCatalog,
});
assert.equal(toolResult.result.length, 2);
assert.equal(toolResult.result[0].confidence, 100);
assert.match(toolResult.explanation, /relative rank score/i);

console.log("✓ Deterministic ranking formula and relative rank score verified.\n");
console.log("✓ Zero synthetic 0.95 affinities injected into supporting signals.\n");

// -------------------------------------------------------------
// Test 3: Seasonal keyword weighting honesty
// -------------------------------------------------------------
console.log("Test 3: Illustrative seasonal keyword weighting");

const testSignals: CulturalSignal[] = [
  {
    entityId: "sig-winter",
    entityType: "urn:entity:book",
    label: "Winter Dark Roasts",
    affinity: 0.85,
  },
  {
    entityId: "sig-neutral",
    entityType: "urn:entity:artist",
    label: "Neutral Artist",
    affinity: 0.70,
  },
];

// Month 1 (January, Q1 Winter)
const adjusted = applySeasonalMultipliers(testSignals, 1);
assert.equal(adjusted[0].affinity, 0.85, "Qloo raw affinity must remain unchanged!");
assert.equal(adjusted[0].seasonalMultiplier, 1.25, "Boosted winter keyword should receive 1.25 multiplier");
assert.equal(adjusted[1].affinity, 0.70, "Raw affinity must remain unchanged for neutral signal");

console.log("✓ Seasonal multipliers leave Qloo affinities untouched and only tag seasonalMultiplier.\n");

// -------------------------------------------------------------
// Test 4: Local memory and deduplication
// -------------------------------------------------------------
console.log("Test 4: Memory deduplication and slim records");

const rec: Recommendation = {
  name: "Valrhona Cacao",
  entityId: "valrhona-123",
  category: "artisan chocolate",
  confidence: 100,
  supportingSignals: [signalA],
  qloo_request: { url: "https://hackathon.api.qloo.com/test" },
  qloo_response: { huge_raw_data: "x".repeat(1000) },
};

const slim = slimRecommendation(rec);
assert.equal(slim.qloo_response, undefined, "Slim recommendation drops large raw Qloo response");
assert.equal(slim.name, "Valrhona Cacao");

const nowIso = new Date().toISOString();
const localRecords: StoredRecommendation[] = [
  {
    id: "local-1",
    recommendation: slim,
    accepted: true,
    savedAt: nowIso,
  },
];

const serverRecords: StoredRecommendation[] = [
  {
    id: "server-1",
    recommendation: slim,
    accepted: true,
    savedAt: nowIso, // Duplicate within 10s
  },
  {
    id: "server-2",
    recommendation: { ...slim, name: "Other Record", entityId: "other-456" },
    accepted: false,
    savedAt: new Date(Date.now() - 60000).toISOString(),
  },
];

const merged = mergeMemory(localRecords, serverRecords);
assert.equal(merged.length, 2, "Duplicate recommendation within 10s should be collapsed");
assert.equal(merged[0].recommendation.name, "Valrhona Cacao", "Newest record should be first");

console.log("✓ Memory merging collapses duplicates and slims stored records.\n");

  console.log("=== All Unit Tests Passed Successfully! ===");
}

runAllTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
