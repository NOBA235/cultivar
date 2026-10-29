// Shared helpers for the API route handlers: typed JSON errors and
// per-request timing logs.

export interface ApiErrorBody {
  error: string;
  code: string;
  detail?: unknown;
}

export function jsonError(
  status: number,
  code: string,
  error: string,
  detail?: unknown,
): Response {
  const body: ApiErrorBody = { error, code };
  if (detail !== undefined) body.detail = detail;
  return Response.json(body, { status });
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Wraps a route handler: logs start, status and duration for every request,
 * and turns an unexpected throw into a 500 JSON error (never fake data).
 */
export async function timed(
  route: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const id = crypto.randomUUID().slice(0, 8);
  const started = performance.now();
  console.log(`[api:${route}] ${id} start`);

  let res: Response;
  try {
    res = await handler();
  } catch (err) {
    console.error(`[api:${route}] ${id} unhandled error:`, err);
    res = jsonError(500, "INTERNAL_ERROR", "Unexpected server error", errorMessage(err));
  }

  const ms = Math.round(performance.now() - started);
  console.log(`[api:${route}] ${id} -> ${res.status} in ${ms}ms`);
  return res;
}

/** Reads a JSON body, or returns a 400 Response if it is not valid JSON. */
export async function readJson(
  request: Request,
): Promise<{ ok: true; data: unknown } | { ok: false; response: Response }> {
  try {
    return { ok: true, data: await request.json() };
  } catch {
    return {
      ok: false,
      response: jsonError(400, "INVALID_JSON", "Request body must be valid JSON."),
    };
  }
}

export const MAX_CSV_UPLOAD_BYTES = 1_048_576; // 1 MB

/** Reads the uploaded CSV from multipart/form-data field "file". */
export async function readCsvUpload(
  request: Request,
): Promise<{ ok: true; text: string; type?: string } | { ok: false; response: Response }> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return {
      ok: false,
      response: jsonError(
        400,
        "INVALID_FORM_DATA",
        'Expected multipart/form-data with the CSV in a field named "file".',
      ),
    };
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return {
      ok: false,
      response: jsonError(400, "MISSING_FILE", 'No file found in form field "file".'),
    };
  }
  if (file.size === 0) {
    return {
      ok: false,
      response: jsonError(400, "EMPTY_FILE", "Uploaded CSV file is empty."),
    };
  }
  if (file.size > MAX_CSV_UPLOAD_BYTES) {
    return {
      ok: false,
      response: jsonError(
        413,
        "FILE_TOO_LARGE",
        `CSV file exceeds the 1 MB limit (${file.size.toLocaleString()} bytes uploaded).`,
      ),
    };
  }
  const typeVal = form.get("type");
  const type = typeof typeVal === "string" && typeVal.trim() ? typeVal.trim() : undefined;
  return { ok: true, text: await file.text(), type };
}
