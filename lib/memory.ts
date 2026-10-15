import fs from "node:fs/promises";
import path from "node:path";
import type { Recommendation } from "./types";

export interface StoredRecommendation {
  id: string;
  recommendation: Recommendation;
  accepted: boolean;
  notes?: string;
  savedAt: string;
}

const memoryStore: StoredRecommendation[] = [];
const STORAGE_FILE = path.join(process.cwd(), "data", "past_recommendations.json");

async function ensureFileLoaded() {
  if (memoryStore.length > 0) return;
  try {
    const raw = await fs.readFile(STORAGE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      memoryStore.push(...parsed);
    }
  } catch {
    // If file does not exist yet or fails to parse, start fresh in memory
  }
}

async function persistToFile() {
  try {
    const dir = path.dirname(STORAGE_FILE);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(STORAGE_FILE, JSON.stringify(memoryStore, null, 2), "utf-8");
  } catch (err) {
    console.warn("[memory] Warning: could not persist recommendations to disk:", err);
  }
}

export async function saveRecommendation(
  recommendation: Recommendation,
  accepted: boolean,
  notes?: string,
): Promise<StoredRecommendation> {
  await ensureFileLoaded();
  const existingIdx = memoryStore.findIndex(
    (item) => item.recommendation.entityId === recommendation.entityId,
  );

  const entry: StoredRecommendation = {
    id: recommendation.entityId,
    recommendation,
    accepted,
    notes,
    savedAt: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    memoryStore[existingIdx] = entry;
  } else {
    memoryStore.push(entry);
  }

  await persistToFile();
  return entry;
}

export async function getPastRecommendations(): Promise<Recommendation[]> {
  await ensureFileLoaded();
  return memoryStore.map((entry) => entry.recommendation);
}

export async function getAllStoredRecords(): Promise<StoredRecommendation[]> {
  await ensureFileLoaded();
  return [...memoryStore];
}
