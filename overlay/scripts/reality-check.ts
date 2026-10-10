import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import { runAgent, type AgentTrace } from "../lib/agent";
import type { Product } from "../lib/types";

// End-to-end run against the LIVE Qloo API. No LLM is called.
//   npx tsx scripts/reality-check.ts
// Run it from the project root so .env.local and public/ resolve.

// tsx does not load .env.local by itself, so load it here (Node 20.12+).
if (!process.env.QLOO_API_KEY && existsSync(".env.local")) {
  const loadEnvFile = (process as unknown as { loadEnvFile?: (p: string) => void })
    .loadEnvFile;
  if (typeof loadEnvFile === "function") loadEnvFile.call(process, ".env.local");
}

function loadCatalog(): Product[] {
  const path = join(process.cwd(), "public", "demo-catalog.csv");
  const parsed = Papa.parse<Record<string, string>>(readFileSync(path, "utf8"), {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    throw new Error(`demo-catalog.csv parse errors: ${JSON.stringify(parsed.errors)}`);
  }
  return parsed.data.map((row, i) => {
    const { name, category, description } = row;
    if (!name || !category || !description) {
      throw new Error(`demo-catalog.csv row ${i + 2} is missing name, category or description`);
    }
    return { name, category, description };
  });
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function main(): Promise<void> {
  const products = loadCatalog();

  section("INPUT");
  products.forEach((p, i) =>
    console.log(`${i + 1}. ${p.name} | ${p.category} | ${p.description}`),
  );

  console.log("\n--- live run (Qloo call log + stage logs) ---");
  const trace: Partial<AgentTrace> = {};
  const recommendations = await runAgent(products, trace);
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
