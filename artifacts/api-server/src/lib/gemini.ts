import { GoogleGenAI } from "@google/genai";

export const GEMINI_MODEL = "gemini-3.5-flash-lite";

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
  const details = getGeminiErrorDetails(error);
  const status = details.status;
  const text = details.message.toLowerCase();
  const code = details.code.toLowerCase();

  if (
    status === 429 ||
    code.includes("resource_exhausted") ||
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
  if (
    status === 401 ||
    status === 403 ||
    code.includes("unauthenticated") ||
    code.includes("permission_denied") ||
    text.includes("api key")
  ) {
    return {
      status: 503,
      errorCode: "gemini_key_invalid",
      message:
        "Gemini could not authenticate this request. Check GEMINI_API_KEY in Replit Secrets.",
    };
  }
  if (status === 400 || status === 404 || code.includes("invalid_argument")) {
    return {
      status: 502,
      errorCode: "gemini_request_rejected",
      message:
        "Google rejected this scan request. Try another JPEG, PNG, or WebP image, or use manual entry.",
    };
  }
  return {
    status: 502,
    errorCode: "gemini_unavailable",
    message:
      "Gemini is temporarily unavailable. You can retry or continue with manual entry.",
  };
}

export function getGeminiErrorDetails(error: unknown): {
  name: string;
  status: number;
  code: string;
  message: string;
} {
  const detail =
    typeof error === "object" && error !== null
      ? (error as {
          name?: unknown;
          status?: unknown;
          statusCode?: unknown;
          code?: unknown;
          message?: unknown;
          response?: {
            status?: unknown;
            data?: { error?: { status?: unknown; message?: unknown } };
          };
        })
      : {};
  const statusValue =
    detail.status ?? detail.statusCode ?? detail.response?.status ?? 0;
  const status = Number(statusValue) || 0;
  const code = String(
    detail.code ?? detail.response?.data?.error?.status ?? "",
  ).slice(0, 80);
  const message = String(
    detail.message ?? detail.response?.data?.error?.message ?? "",
  )
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(api[_ -]?key\s*[:=]\s*)\S+/gi, "$1[redacted]")
    .slice(0, 300);
  return {
    name: String(detail.name ?? "UnknownError").slice(0, 80),
    status,
    code,
    message,
  };
}

export function getJsonText(response: { text?: string | null }): string {
  if (!response.text?.trim()) {
    throw new Error("Gemini returned an empty response.");
  }
  return response.text;
}

export async function generateWithTransientRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const details = getGeminiErrorDetails(error);
      const text = `${details.code} ${details.message}`.toLowerCase();
      const authenticationFailure =
        details.status === 401 ||
        details.status === 403 ||
        text.includes("api key") ||
        text.includes("unauthenticated") ||
        text.includes("permission_denied");
      const schemaOrValidationFailure =
        text.includes("invalid_argument") ||
        text.includes("invalid input") ||
        text.includes("validation");
      const transient =
        !authenticationFailure &&
        !schemaOrValidationFailure &&
        (details.status === 503 ||
          details.status === 502 ||
          details.status === 504 ||
          text.includes("overload") ||
          text.includes("unavailable") ||
          text.includes("temporarily"));
      if (!transient || attempt === 2) break;
      const jitter = Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 500 + jitter));
    }
  }
  throw lastError;
}
