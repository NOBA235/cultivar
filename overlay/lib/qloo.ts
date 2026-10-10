import type { QlooInsightsResponse, QlooSearchResponse } from "./types";

// Live Qloo API client. Every function here makes a real network call.
// There is no mock, fixture, or fallback path in this file.

const QLOO_BASE_URL = "https://hackathon.api.qloo.com";

/** Thrown for any non-2xx response, so callers can branch on the status. */
export class QlooHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
    statusText: string,
  ) {
    super(
      `Qloo request failed: ${status} ${statusText}\nURL: ${url}\nBody: ${body}`,
    );
    this.name = "QlooHttpError";
  }
}

function getApiKey(): string {
  const key = process.env.QLOO_API_KEY;
  if (!key) {
    throw new Error(
      "QLOO_API_KEY is not set. Copy .env.local.example to .env.local and add your Qloo hackathon key.",
    );
  }
  return key;
}

async function qlooGet(
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const apiKey = getApiKey();

  const url = new URL(path, QLOO_BASE_URL);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  // The key travels in a header, so the URL is safe to log.
  console.log(`[qloo] -> GET ${url.toString()}`);
  const res = await fetch(url, { headers: { "X-Api-Key": apiKey } });
  console.log(`[qloo] <- ${res.status} ${res.statusText}`);

  const body = await res.text();
  if (!res.ok) {
    throw new QlooHttpError(res.status, url.toString(), body, res.statusText);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(
      `Qloo returned a non-JSON body for ${url.toString()}:\n${body}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * GET /search: resolve a name to Qloo entities.
 * `type` is a Qloo entity URN, e.g. "urn:entity:brand".
 * Sent as the `types` query parameter.
 */
export async function resolveEntity(
  query: string,
  type: string,
): Promise<QlooSearchResponse> {
  const json = await qlooGet("/search", { query, types: type });

  if (!isRecord(json) || !Array.isArray(json.results)) {
    throw new Error(
      `Unexpected /search response shape (expected a "results" array):\n${JSON.stringify(json, null, 2)}`,
    );
  }
  return json as QlooSearchResponse;
}

/**
 * GET /v2/insights: entities culturally adjacent to a seed entity.
 * `entityId` is the seed (signal.interests.entities).
 * `entityType` is the TARGET domain to return (filter.type),
 * e.g. "urn:entity:artist", "urn:entity:movie", "urn:entity:place".
 * `options.take` caps the number of entities returned.
 */
export async function getCulturalAffinities(
  entityId: string,
  entityType: string,
  options: { take?: number } = {},
): Promise<QlooInsightsResponse> {
  const params: Record<string, string> = {
    "filter.type": entityType,
    "signal.interests.entities": entityId,
  };
  if (options.take !== undefined) params.take = String(options.take);

  const json = await qlooGet("/v2/insights", params);

  if (
    !isRecord(json) ||
    !isRecord(json.results) ||
    !Array.isArray(json.results.entities)
  ) {
    throw new Error(
      `Unexpected /v2/insights response shape (expected results.entities array):\n${JSON.stringify(json, null, 2)}`,
    );
  }
  return json as QlooInsightsResponse;
}
