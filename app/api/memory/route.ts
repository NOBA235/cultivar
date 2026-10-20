import { z } from "zod";
import {
  getAllStoredRecords,
  saveRecommendation,
  clearAllMemory,
} from "@/lib/memory";
import { errorMessage, jsonError } from "@/lib/http";
import type { Recommendation } from "@/lib/types";

const PostMemorySchema = z.object({
  recommendation: z.object({
    name: z.string(),
    entityId: z.string(),
    category: z.string(),
    confidence: z.number(),
    supportingSignals: z.array(z.any()),
  }),
  accepted: z.boolean(),
  notes: z.string().optional(),
  month: z.number().min(1).max(12).optional(),
});

export async function GET(): Promise<Response> {
  try {
    const records = await getAllStoredRecords();
    return Response.json({ records });
  } catch (err) {
    return jsonError(500, "MEMORY_READ_FAILED", "Failed to read memory file", errorMessage(err));
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const parsed = PostMemorySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(400, "INVALID_MEMORY_PAYLOAD", "Invalid recommendation payload", parsed.error.issues);
    }

    const { recommendation, accepted, notes, month } = parsed.data;
    const entry = await saveRecommendation(
      recommendation as unknown as Recommendation,
      accepted,
      notes,
      month,
    );

    return Response.json({
      success: true,
      entry,
      message: "Saved. We'll remember this for future runs.",
    });
  } catch (err) {
    return jsonError(500, "MEMORY_WRITE_FAILED", "Failed to save recommendation to memory", errorMessage(err));
  }
}

export async function DELETE(): Promise<Response> {
  try {
    await clearAllMemory();
    return Response.json({ success: true, message: "Memory cleared" });
  } catch (err) {
    return jsonError(500, "MEMORY_CLEAR_FAILED", "Failed to clear memory", errorMessage(err));
  }
}

