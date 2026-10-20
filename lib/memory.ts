import fs from "node:fs/promises";
import path from "node:path";
import type { Recommendation } from "./types";

export interface StoredRecommendation {
  id: string;
  recommendation: Recommendation;
  accepted: boolean;
  notes?: string;
  month?: number;
  savedAt: string;
}

const STORAGE_FILE = path.join(process.cwd(), "data", "memory.json");

export async function readMemoryFile(): Promise<StoredRecommendation[]> {
  try {
    const raw = await fs.readFile(STORAGE_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch {
    return [];
  }
}

async function writeMemoryFile(entries: StoredRecommendation[]): Promise<void> {
  const dir = path.dirname(STORAGE_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(STORAGE_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

export async function saveRecommendation(
  recommendation: Recommendation,
  accepted: boolean,
  notes?: string,
  month?: number,
): Promise<StoredRecommendation> {
  const current = await readMemoryFile();
  const entryId = `mem-${recommendation.entityId.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const entry: StoredRecommendation = {
    id: entryId,
    recommendation,
    accepted,
    notes,
    month,
    savedAt: new Date().toISOString(),
  };

  current.push(entry);
  await writeMemoryFile(current);
  return entry;
}

export async function getPastRecommendations(): Promise<Recommendation[]> {
  const current = await readMemoryFile();
  return current.map((entry) => entry.recommendation);
}

export async function getAllStoredRecords(): Promise<StoredRecommendation[]> {
  return readMemoryFile();
}

export async function clearAllMemory(): Promise<void> {
  await writeMemoryFile([]);
}
