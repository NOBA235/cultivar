import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";

// Gemini client. Used ONLY to write explanations (/api/explain) and the
// Qloo-free baseline (/api/generic). It never decides what CropSignal
// recommends. Failures throw; callers turn them into 5xx responses.

export const GEMINI_MODEL = "gemini-2.5-flash";

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Copy .env.example to .env.local and add your Gemini API key.",
    );
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

/**
 * One structured-output call: Gemini must return JSON matching `jsonSchema`,
 * and the parsed result is re-validated with `schema` before it is returned.
 */
export async function generateJson<T>(opts: {
  label: string;
  systemInstruction: string;
  prompt: string;
  jsonSchema: unknown;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
}): Promise<T> {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const started = performance.now();
    console.log(`[gemini] -> ${GEMINI_MODEL} ${opts.label} (attempt ${attempt + 1})`);

    let response;
    try {
      response = await getClient().models.generateContent({
        model: GEMINI_MODEL,
        contents: opts.prompt,
        config: {
          systemInstruction: opts.systemInstruction,
          responseMimeType: "application/json",
          responseJsonSchema: opts.jsonSchema,
          abortSignal: opts.signal,
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if ((msg.includes("503") || msg.includes("429")) && attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        console.warn(`[gemini] temporary error (${msg}), retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }

    const ms = Math.round(performance.now() - started);
    const finish = response.candidates?.[0]?.finishReason ?? "unknown";
    console.log(`[gemini] <- ${opts.label} in ${ms}ms (finishReason=${finish})`);

  const text = response.text;
  if (!text) {
    throw new Error(`Gemini returned no text for ${opts.label} (finishReason=${finish}).`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON for ${opts.label}:\n${text}`);
  }

  const parsed = opts.schema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `Gemini output for ${opts.label} failed validation: ${parsed.error.message}\nRaw: ${text}`,
    );
  }
  return parsed.data;
}

