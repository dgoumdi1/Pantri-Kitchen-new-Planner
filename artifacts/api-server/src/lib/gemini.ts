import { GoogleGenAI } from "@google/genai";

export const GEMINI_MODEL = "gemini-3.1-flash-lite";

let client: GoogleGenAI | undefined;

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY_MISSING");
  }
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export function getGeminiFailure(error: unknown): {
  status: number;
  errorCode: string;
  message: string;
} {
  const detail =
    typeof error === "object" && error !== null
      ? (error as { status?: unknown; code?: unknown; message?: unknown })
      : {};
  const status = Number(detail.status ?? detail.code ?? 0);
  const text = String(detail.message ?? error ?? "").toLowerCase();

  if (
    status === 429 ||
    text.includes("resource_exhausted") ||
    text.includes("quota") ||
    text.includes("rate limit")
  ) {
    return {
      status: 429,
      errorCode: "gemini_quota_exceeded",
      message:
        "Gemini's free-tier quota is currently exhausted. Please wait for the quota to reset and try again. Pantri will not switch to a paid service.",
    };
  }
  if (status === 401 || status === 403 || text.includes("api key")) {
    return {
      status: 503,
      errorCode: "gemini_key_invalid",
      message:
        "Gemini could not authenticate this request. Check GEMINI_API_KEY in Replit Secrets.",
    };
  }
  return {
    status: 502,
    errorCode: "gemini_unavailable",
    message:
      "Gemini is temporarily unavailable. You can retry or continue with manual entry.",
  };
}

export function getJsonText(response: { text?: string | null }): string {
  if (!response.text?.trim()) {
    throw new Error("Gemini returned an empty response.");
  }
  return response.text;
}
