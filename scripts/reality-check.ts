import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runAgent, type AgentTrace } from "../lib/agent";
import { parseCatalogCsv } from "../lib/schemas";
import type { Product, Recommendation, ResolvedEntity } from "../lib/types";

// End-to-end run against the LIVE Qloo API or against a deployed BASE_URL.
//   npx tsx scripts/reality-check.ts
//   BASE_URL=https://cultivar.vercel.app npx tsx scripts/reality-check.ts

if (!process.env.QLOO_API_KEY && existsSync(".env.local")) {
  const loadEnvFile = (process as unknown as { loadEnvFile?: (p: string) => void })
    .loadEnvFile;
  if (typeof loadEnvFile === "function") loadEnvFile.call(process, ".env.local");
}

function loadCatalog(): Product[] {
  const path = join(process.cwd(), "public", "demo-catalog.csv");
  const result = parseCatalogCsv(readFileSync(path, "utf8"));
  if (!result.ok) {
    throw new Error(`demo-catalog.csv is invalid: ${JSON.stringify(result.issues, null, 2)}`);
  }
  return result.products;
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function runAgainstBaseUrl(baseUrl: string): Promise<void> {
  console.log(`Running reality-check against HTTP endpoint: ${baseUrl}`);
  const catalogPath = join(process.cwd(), "public", "demo-catalog.csv");
  const csvData = readFileSync(catalogPath, "utf-8");
  const formData = new FormData();
  formData.append("file", new Blob([csvData], { type: "text/csv" }), "demo-catalog.csv");

  section("STAGE 1: RESOLVE VIA HTTP");
  const resolveRes = await fetch(`${baseUrl}/api/resolve`, {
    method: "POST",
    body: formData,
  });
  if (!resolveRes.ok) throw new Error(`Resolve failed: HTTP ${resolveRes.status}`);
  const { resolved }: { resolved: ResolvedEntity[] } = await resolveRes.json();
  console.log(`Resolved ${resolved.length} products`);
  for (const r of resolved) {
    console.log(`"${r.product.name}" → ${r.qlooId} | type=${r.qlooType} | confidence=${r.confidence.toFixed(2)}`);
  }

  section("STAGE 2-4: RECOMMEND VIA HTTP");
  const recommendRes = await fetch(`${baseUrl}/api/recommend`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resolved }),
  });
  if (!recommendRes.ok) throw new Error(`Recommend failed: HTTP ${recommendRes.status}`);
  const { recommendations }: { recommendations: Recommendation[] } = await recommendRes.json();

  section("RECOMMENDATIONS");
  recommendations.forEach((rec, i) => {
    console.log(`#${i + 1} "${rec.name}" | ${rec.entityId} | category="${rec.category}" | confidence=${rec.confidence}/100`);
    for (const s of rec.supportingSignals) {
      console.log(`    signal ${s.entityId} | ${s.entityType} | "${s.label}" | affinity=${s.affinity.toFixed(4)}`);
    }
  });

  section("CHECKS");
  const ids = new Set<string>([
    ...resolved.map((r) => r.qlooId),
    ...recommendations.flatMap((r) => r.supportingSignals.map((s) => s.entityId)),
    ...recommendations.map((r) => r.entityId),
  ]);
  const thinRecs = recommendations.filter((r) => r.supportingSignals.length < 2);

  console.log(`distinct Qloo entity IDs seen: ${ids.size}`);
  console.log(`recommendations: ${recommendations.length}`);
  console.log(`recommendations with < 2 supporting signals: ${thinRecs.length}`);

  const failures: string[] = [];
  if (ids.size < 5) failures.push(`only ${ids.size} distinct entity IDs (need at least 5)`);
  if (thinRecs.length > 0) failures.push(`${thinRecs.length} recommendation(s) have < 2 supporting signals`);
  if (failures.length > 0) {
    console.error(`CHECKS FAILED: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("CHECKS PASSED (HTTP)");
}

async function main(): Promise<void> {
  const products = loadCatalog();
  const baseUrl = process.env.BASE_URL?.trim();

  if (baseUrl) {
    await runAgainstBaseUrl(baseUrl);
    return;
  }

  section("INPUT");
  products.forEach((p, i) =>
    console.log(`${i + 1}. ${p.name} | ${p.category} | ${p.description}`),
  );

  console.log("\n--- live run (Qloo call log + stage logs) ---");
  const trace: Partial<AgentTrace> = {};
  const recommendations = await runAgent(products, { trace });
  console.log("--- end of run log ---");

  const { resolved, signals, candidates } = trace;
  if (!resolved || !signals || !candidates) {
    throw new Error("runAgent returned without populating the trace.");
  }

  section("STAGE 1: RESOLVED");
  for (const r of resolved) {
    console.log(
      `"${r.product.name}" → ${r.qlooId} | type=${r.qlooType} | name-match confidence=${r.confidence.toFixed(2)} | matched "${r.label}"`,
    );
  }
  const resolvedNames = new Set(resolved.map((r) => r.product.name));
  for (const p of products) {
    if (!resolvedNames.has(p.name)) console.log(`"${p.name}" → UNRESOLVED`);
  }

  section("STAGE 2: CULTURAL SIGNALS");
  for (const [productName, list] of signals) {
    console.log(`"${productName}" (${list.length} signals kept; top 5):`);
    for (const s of list.slice(0, 5)) {
      console.log(
        `  ${s.entityId} | ${s.entityType} | "${s.label}" | affinity=${s.affinity.toFixed(4)}`,
      );
    }
  }

  section("STAGE 3: CANDIDATES");
  const sorted = [...candidates].sort((a, b) => b.totalAffinity - a.totalAffinity);
  console.log(`${sorted.length} candidates`);
  for (const c of sorted) {
    console.log(
      `"${c.name}" | ${c.entityId} | category="${c.category}" | signals=${c.signals.length} | totalAffinity=${c.totalAffinity.toFixed(4)}`,
    );
  }

  section("STAGE 4: FINAL RECOMMENDATIONS");
  recommendations.forEach((rec, i) => {
    console.log(
      `#${i + 1} "${rec.name}" | ${rec.entityId} | category="${rec.category}" | confidence=${rec.confidence}/100`,
    );
    for (const s of rec.supportingSignals) {
      console.log(
        `    signal ${s.entityId} | ${s.entityType} | "${s.label}" | signal→candidate affinity=${(s.candidateAffinity ?? NaN).toFixed(4)} | signal→product affinity=${s.affinity.toFixed(4)}`,
      );
    }
  });

  section("CHECKS");
  const ids = new Set<string>([
    ...resolved.map((r) => r.qlooId),
    ...Array.from(signals.values()).flatMap((l) => l.map((s) => s.entityId)),
    ...candidates.map((c) => c.entityId),
    ...recommendations.map((r) => r.entityId),
  ]);
  const urnPrefixed = Array.from(ids).filter((id) => id.startsWith("urn:entity:"));
  const sample = Array.from(ids).slice(0, 5);
  const thinRecs = recommendations.filter((r) => r.supportingSignals.length < 2);

  console.log(`distinct Qloo entity IDs seen: ${ids.size}`);
  console.log(`  of which start with "urn:entity:": ${urnPrefixed.length}`);
  console.log(`  sample: ${sample.join(", ")}`);
  console.log(`recommendations: ${recommendations.length}`);
  console.log(`recommendations with < 2 supporting signals: ${thinRecs.length}`);

  const failures: string[] = [];
  if (ids.size < 5) failures.push(`only ${ids.size} distinct entity IDs (need at least 5)`);
  if (thinRecs.length > 0) failures.push(`${thinRecs.length} recommendation(s) have < 2 supporting signals`);
  if (failures.length > 0) {
    console.error(`CHECKS FAILED: ${failures.join("; ")}`);
    process.exit(1);
  }
  console.log("CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
