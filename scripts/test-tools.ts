import {
  resolve_product,
  get_cultural_affinities,
  find_adjacent_products,
  rank_candidates,
  explain_recommendation,
  remember_recommendation,
  recall_past_recommendations,
  seasonal_trends,
} from "../lib/tools";
import type { Candidate, CulturalSignal, Recommendation } from "../lib/types";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function run() {
  console.log("=== Testing 8 Discrete Tools Independently ===\n");

  // 1. resolve_product
  console.log("1. Testing resolve_product('Hillside Honey')...");
  const res1 = await resolve_product({
    product_name: "Hillside Honey",
    category: "Raw Honey",
  });
  console.log("   Result:", res1.result.label, "ID:", res1.result.qlooId, "Confidence:", res1.result.confidence);
  console.log("   Explanation:", res1.explanation);
  console.log("   Qloo URL:", res1.qloo_request?.url);
  assert(Boolean(res1.result.qlooId), "resolve_product must return a valid qlooId");
  assert(Boolean(res1.qloo_request?.url), "resolve_product must include raw qloo_request URL");
  assert(Boolean(res1.qloo_response), "resolve_product must include raw qloo_response");

  // 2. get_cultural_affinities
  console.log("\n2. Testing get_cultural_affinities for resolved entity...");
  const res2 = await get_cultural_affinities({
    entity_id: res1.result.qlooId,
    domain: "urn:entity:artist",
    take: 5,
  });
  console.log("   Returned signals count:", res2.result.length);
  console.log("   Top signal:", res2.result[0]?.label, "Affinity:", res2.result[0]?.affinity);
  console.log("   Explanation:", res2.explanation);
  assert(Array.isArray(res2.result), "get_cultural_affinities must return an array");
  assert(Boolean(res2.qloo_request?.url), "get_cultural_affinities must include qloo_request");
  assert(Boolean(res2.qloo_response), "get_cultural_affinities must include qloo_response");

  // 3. find_adjacent_products
  const signalToUse: CulturalSignal = res2.result[0] ?? {
    entityId: "01725FD4-3DA1-4966-A5DF-0DECD8E77626", // Real Qloo artist (e.g. Taylor Swift / Radiohead)
    entityType: "urn:entity:artist",
    label: "Test Cultural Anchor",
    affinity: 0.85,
  };
  console.log(`\n3. Testing find_adjacent_products from signal "${signalToUse.label}" [${signalToUse.entityId}]...`);
  const res3 = await find_adjacent_products({
    signal: signalToUse,
    take: 5,
  });
  console.log("   Surfaced candidates count:", res3.result.length);
  if (res3.result.length > 0) {
    console.log("   First candidate:", res3.result[0].name, "ID:", res3.result[0].entityId);
  }
  console.log("   Explanation:", res3.explanation);
  assert(Array.isArray(res3.result), "find_adjacent_products must return an array");
  assert(Boolean(res3.qloo_request?.url), "find_adjacent_products must include qloo_request");
  assert(Boolean(res3.qloo_response), "find_adjacent_products must include qloo_response");

  // 4. rank_candidates
  console.log("\n4. Testing rank_candidates...");
  const dummyCandidates: Candidate[] = [
    {
      name: "Meadowlands Wildflower Tea",
      entityId: "TEST-ENTITY-TEA",
      category: "Herbal Infusions",
      signals: [
        { entityId: "S1", entityType: "artist", label: "Bon Iver", affinity: 0.82, candidateAffinity: 0.79 },
        { entityId: "S2", entityType: "destination", label: "Hudson Valley", affinity: 0.77, candidateAffinity: 0.75 },
      ],
      totalAffinity: 1.54,
    },
    {
      name: "Smoked Apple Butter",
      entityId: "TEST-ENTITY-BUTTER",
      category: "Fruit Spreads",
      signals: [
        { entityId: "S1", entityType: "artist", label: "Bon Iver", affinity: 0.82, candidateAffinity: 0.71 },
        { entityId: "S3", entityType: "movie", label: "First Cow", affinity: 0.80, candidateAffinity: 0.69 },
      ],
      totalAffinity: 1.40,
    },
  ];
  const res4 = await rank_candidates({
    candidates: dummyCandidates,
    catalog: [res1.result],
  });
  console.log("   Ranked recommendations count:", res4.result.length);
  console.log("   Top rec:", res4.result[0]?.name, "Confidence:", res4.result[0]?.confidence);
  console.log("   Explanation:", res4.explanation);
  assert(res4.result.length > 0, "rank_candidates should rank candidates");
  assert(res4.qloo_request === null, "rank_candidates qloo_request should be null");

  // 5. explain_recommendation
  console.log("\n5. Testing explain_recommendation via Gemini Flash...");
  const sampleRec: Recommendation = res4.result[0];
  const res5 = await explain_recommendation({ rec: sampleRec });
  console.log("   Generated explanation:", res5.result);
  console.log("   Explanation tool status:", res5.explanation);
  assert(typeof res5.result === "string" && res5.result.length > 0, "explain_recommendation must return explanation");
  const words = res5.result.split(/\s+/).filter(Boolean).length;
  console.log(`   Word count: ${words} (max 25 allowed)`);
  assert(words <= 25, "Explanation must not exceed 25 words");

  // 6. remember_recommendation
  console.log("\n6. Testing remember_recommendation...");
  const res6 = await remember_recommendation({
    rec: sampleRec,
    accepted: true,
    notes: "User approved for Fall 2026 production batch.",
  });
  console.log("   Result:", res6.result);
  console.log("   Explanation:", res6.explanation);
  assert(res6.result.success === true, "remember_recommendation must succeed");

  // 7. recall_past_recommendations
  console.log("\n7. Testing recall_past_recommendations...");
  const res7 = await recall_past_recommendations();
  console.log("   Past recommendations count:", res7.result.length);
  console.log("   Explanation:", res7.explanation);
  assert(res7.result.length >= 1, "recall_past_recommendations must return at least 1 saved item");

  // 8. seasonal_trends
  console.log("\n8. Testing seasonal_trends('autumn')...");
  const res8 = await seasonal_trends({ month: "autumn", take: 5 });
  console.log("   Returned seasonal trends count:", res8.result.length);
  if (res8.result.length > 0) {
    console.log("   Top seasonal trend:", res8.result[0].label, "Affinity:", res8.result[0].affinity);
  }
  console.log("   Explanation:", res8.explanation);
  console.log("   Qloo URL:", res8.qloo_request?.url);
  assert(res8.result.length > 0, "seasonal_trends must return seasonal signals");
  assert(Boolean(res8.qloo_request?.url), "seasonal_trends must include qloo_request URL");
  assert(Boolean(res8.qloo_response), "seasonal_trends must include qloo_response");

  console.log("\n>>> ALL 8 TOOLS TESTED SUCCESSFULLY AND RETURN VALID AUDIT TRAIL PAYLOADS! <<<\n");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

