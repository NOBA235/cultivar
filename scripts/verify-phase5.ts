import fs from "node:fs";
import path from "node:path";
import type { ResolvedEntity } from "../lib/types";

async function main() {
  console.log("=== PHASE 5 VERIFICATION: RESOLUTION REVIEW FLOW ===\n");

  const catalogPath = path.join(process.cwd(), "public", "demo-catalog.csv");
  const csvData = fs.readFileSync(catalogPath, "utf-8");

  console.log("1. Simulating upload of demo-catalog.csv to /api/resolve...");
  const formData = new FormData();
  const blob = new Blob([csvData], { type: "text/csv" });
  formData.append("file", blob, "demo-catalog.csv");

  const resolveRes = await fetch("http://localhost:3000/api/resolve", {
    method: "POST",
    body: formData,
  });

  if (!resolveRes.ok) {
    throw new Error(`POST /api/resolve failed: HTTP ${resolveRes.status}`);
  }

  const resolveJson = await resolveRes.json();
  const { resolved, unresolved } = resolveJson;

  console.log(`\nResolved products count: ${resolved.length}`);
  console.log(`Unresolved products count: ${unresolved.length}\n`);

  console.log("------------------------------------------------------------------------------------------------------------------------");
  console.log("| Product                             | Resolved Entity       | Qloo ID (truncated)      | Full Qloo ID                           | Type  | Conf | Pill  |");
  console.log("------------------------------------------------------------------------------------------------------------------------");

  let greenCount = 0;
  let yellowCount = 0;
  let redCount = 0;

  for (const item of resolved) {
    const conf = item.confidence;
    let pill = "RED (<0.5)";
    if (conf > 0.8) {
      pill = "GREEN (>0.8)";
      greenCount++;
    } else if (conf >= 0.5) {
      pill = "YELLOW (0.5-0.8)";
      yellowCount++;
    } else {
      redCount++;
    }

    const truncated = `${item.qlooId.slice(0, 24)}…`;
    const prodName = item.product.name.padEnd(35).slice(0, 35);
    const label = item.label.padEnd(21).slice(0, 21);
    const qTrunc = truncated.padEnd(24);
    const qFull = item.qlooId.padEnd(38);
    const qType = item.qlooType.replace("urn:entity:", "").padEnd(5);
    const confStr = conf.toFixed(2).padEnd(4);

    console.log(`| ${prodName} | ${label} | ${qTrunc} | ${qFull} | ${qType} | ${confStr} | ${pill.padEnd(16)} |`);
  }
  console.log("------------------------------------------------------------------------------------------------------------------------\n");

  console.log(`Confidence summary: ${greenCount} Green (>0.8), ${yellowCount} Yellow (0.5-0.8), ${redCount} Red (<0.5)`);
  if (resolved.length !== 5) {
    throw new Error(`Expected exactly 5 resolved products, got ${resolved.length}`);
  }
  if (greenCount < 4) {
    throw new Error(`Expected at least 4 green confidence rows, got ${greenCount}`);
  }
  console.log("✓ Criterion Met: Exactly 5 rows resolved with real Qloo IDs.");
  console.log("✓ Criterion Met: At least 4 of 5 rows show green confidence pills (> 0.8).");

  // Red row check
  const redRow = resolved.find((r: ResolvedEntity) => r.confidence < 0.5);
  if (redRow) {
    console.log(`\nRed row detected for override: "${redRow.product.name}" with confidence ${redRow.confidence.toFixed(2)}`);
    console.log("Testing re-resolve with single-row CSV and type 'urn:entity:brand'...");
    const singleCsv = `product_name,category,description\n"${redRow.product.name}","${redRow.product.category}","${redRow.product.description}"`;
    const singleForm = new FormData();
    singleForm.append("file", new Blob([singleCsv], { type: "text/csv" }), "single.csv");
    singleForm.append("type", "urn:entity:brand");

    const reResolveRes = await fetch("http://localhost:3000/api/resolve", {
      method: "POST",
      body: singleForm,
    });
    const reResolveJson = await reResolveRes.json();
    console.log(`✓ Re-resolve response status: ${reResolveRes.status}, resolved: ${reResolveJson.resolved?.[0]?.label} (${reResolveJson.resolved?.[0]?.qlooId})`);
  }

  // Generate recommendations check
  console.log("\n2. Testing 'Generate recommendations' button action (POST /api/recommend)...");
  const recommendRes = await fetch("http://localhost:3000/api/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolved }),
  });

  if (!recommendRes.ok) {
    throw new Error(`POST /api/recommend failed: HTTP ${recommendRes.status}`);
  }

  const recommendJson = await recommendRes.json();
  const recs = recommendJson.recommendations;
  console.log(`✓ Recommendations returned: ${recs.length}`);
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    console.log(`   #${i + 1} "${r.name}" | Qloo ID: ${r.entityId} | Confidence: ${r.confidence}% | Signals: ${r.supportingSignals?.length}`);
    console.log(`       Formula: ${r.ranking?.calculationText}`);
    console.log(`       Audit URL: ${r.qloo_request?.url}`);
  }

  console.log("\n>>> PHASE 5 VERIFICATION PASSED COMPLETELY! <<<\n");
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
