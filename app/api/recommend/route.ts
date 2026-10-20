import {
  AgentEmptyStageError,
  runAgentFromResolved,
  type AgentTrace,
} from "@/lib/agent";
import { errorMessage, jsonError, readJson, timed } from "@/lib/http";
import { QlooHttpError } from "@/lib/qloo";
import { RecommendRequestSchema, zodIssues } from "@/lib/schemas";

// POST { resolved: ResolvedEntity[] } (the output of /api/resolve).
// Runs stages 2-4 against the live Qloo API and returns the top 3.

const PIPELINE_TIMEOUT_MS = 45_000;

// Above the pipeline timeout so our 504 is sent before the platform kills us.
export const maxDuration = 60;

/** What finished before the timeout, so the caller can see how far it got. */
function partialResult(trace: Partial<AgentTrace>) {
  const signals = trace.signals ? Object.fromEntries(trace.signals) : undefined;
  const topCandidates = trace.candidates
    ? [...trace.candidates]
        .sort((a, b) => b.totalAffinity - a.totalAffinity)
        .slice(0, 10)
    : undefined;
  return {
    stageReached: trace.stage ?? "signals",
    resolvedCount: trace.resolved?.length ?? 0,
    signals,
    candidateCount: trace.candidates?.length,
    topCandidates,
  };
}

export async function POST(request: Request): Promise<Response> {
  return timed("recommend", async () => {
    const body = await readJson(request);
    if (!body.ok) return body.response;

    const parsed = RecommendRequestSchema.safeParse(body.data);
    if (!parsed.success) {
      return jsonError(400, "INVALID_BODY", "Body must be { resolved: ResolvedEntity[] }.", zodIssues(parsed.error));
    }

    const trace: Partial<AgentTrace> = {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PIPELINE_TIMEOUT_MS);

    try {
      const recommendations = await runAgentFromResolved(parsed.data.resolved, {
        trace,
        signal: controller.signal,
        month: parsed.data.month,
      });
      return Response.json({ recommendations });
    } catch (err) {
      if (controller.signal.aborted) {
        return jsonError(
          504,
          "PIPELINE_TIMEOUT",
          `Recommendation pipeline exceeded ${PIPELINE_TIMEOUT_MS / 1000}s; returning the stages that completed.`,
          partialResult(trace),
        );
      }
      if (err instanceof AgentEmptyStageError) {
        return jsonError(422, "PIPELINE_EMPTY", err.message, { stage: err.stage });
      }
      console.error("[api:recommend] failure:", err);
      const qloo = err instanceof QlooHttpError;
      return jsonError(
        502,
        qloo ? "QLOO_RECOMMEND_FAILED" : "RECOMMEND_FAILED",
        qloo ? "Qloo recommend failed" : "Recommendation pipeline failed",
        errorMessage(err),
      );
    } finally {
      clearTimeout(timer);
    }
  });
}
