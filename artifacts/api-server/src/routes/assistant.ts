import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { and, desc, eq } from "drizzle-orm";
import {
  AnalyzeKitchenImageBody,
  AnalyzeKitchenImageResponse,
  GenerateAssistantRecipeBody,
  GenerateAssistantRecipeResponse,
  GetAssistantHistoryResponse,
  SendAssistantMessageBody,
  SendAssistantMessageResponse,
  type AccountData,
} from "@workspace/api-zod";
import {
  db,
  pantriAccountDataTable,
  pantriAssistantMessagesTable,
} from "@workspace/db";
import {
  getGeminiClient,
  getGeminiErrorDetails,
  getGeminiFailure,
  getJsonText,
  GEMINI_MODEL,
} from "../lib/gemini";

const router: IRouter = Router();
const oneHour = 60 * 60 * 1000;
const sharedFreeTierLimit = rateLimit({
  windowMs: oneHour,
  limit: 50,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: () => "pantri-gemini-free-tier",
  skip: (req) => !getAuth(req).userId,
  handler: (_req, res) => {
    res.status(429).json({
      errorCode: "gemini_app_quota",
      error:
        "Pantri's shared Gemini free-tier request allowance is used up for now. Wait and retry, or enter items manually. Pantri will not switch to a paid service.",
    });
  },
});

function freeTierLimit(limit: number, message: string) {
  return rateLimit({
    windowMs: oneHour,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => {
      const userId = getAuth(req).userId;
      return userId ?? ipKeyGenerator(req.ip ?? "anonymous");
    },
    handler: (_req, res) => {
      res.status(429).json({
        errorCode: "app_limit",
        error: message,
      });
    },
  });
}

const chatLimit = freeTierLimit(
  20,
  "You have reached Pantri's hourly assistant limit. Please try again later.",
);
const recipeLimit = freeTierLimit(
  8,
  "You have reached Pantri's hourly recipe limit. Please try again later.",
);
const scanLimit = freeTierLimit(
  5,
  "You have reached Pantri's hourly scan limit. Please enter items manually or try again later.",
);

function getUserId(req: Parameters<typeof getAuth>[0]): string | undefined {
  return getAuth(req).userId ?? undefined;
}

async function loadAccountData(userId: string): Promise<AccountData> {
  const [row] = await db
    .select({ data: pantriAccountDataTable.data })
    .from(pantriAccountDataTable)
    .where(eq(pantriAccountDataTable.userId, userId))
    .limit(1);
  return (row?.data as AccountData | undefined) ?? {
    inventory: [],
    shopping: [],
    preferences: {
      dietaryFilters: [],
      householdSize: 2,
      units: "Metric",
      expirationReminders: true,
    },
    savedRecipes: [],
    mealPlan: [],
  };
}

function sendGeminiError(req: Parameters<typeof getAuth>[0], res: import("express").Response, error: unknown) {
  if (error instanceof Error && error.message === "GEMINI_API_KEY_MISSING") {
    res.status(503).json({
      errorCode: "gemini_key_missing",
      error: "Gemini is not configured yet. Add GEMINI_API_KEY in Replit Secrets; manual entry remains available.",
    });
    return;
  }
  const details = getGeminiErrorDetails(error);
  const mapped = getGeminiFailure(error);
  req.log.warn(
    {
      status: mapped.status,
      errorCode: mapped.errorCode,
      upstreamName: details.name,
      upstreamStatus: details.status,
      upstreamCode: details.code,
      upstreamMessage: details.message,
    },
    "Gemini request failed",
  );
  res.status(mapped.status).json({
    errorCode: mapped.errorCode,
    error: mapped.message,
  });
}

router.get("/assistant/history", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to view assistant history." });
    return;
  }

  const rows = await db
    .select()
    .from(pantriAssistantMessagesTable)
    .where(eq(pantriAssistantMessagesTable.userId, userId))
    .orderBy(desc(pantriAssistantMessagesTable.id))
    .limit(40);

  const messages = rows.reverse().map((row) => ({
    id: String(row.id),
    role: row.role === "assistant" ? "assistant" as const : "user" as const,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  }));
  res.json(GetAssistantHistoryResponse.parse({ messages }));
});

router.delete("/assistant/history", async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to clear assistant history." });
    return;
  }
  await db
    .delete(pantriAssistantMessagesTable)
    .where(eq(pantriAssistantMessagesTable.userId, userId));
  res.sendStatus(204);
});

router.post("/assistant/chat", sharedFreeTierLimit, chatLimit, async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to use the assistant." });
    return;
  }
  const parsed = SendAssistantMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a message of up to 4,000 characters." });
    return;
  }

  const data = await loadAccountData(userId);
  const history = await db
    .select()
    .from(pantriAssistantMessagesTable)
    .where(eq(pantriAssistantMessagesTable.userId, userId))
    .orderBy(desc(pantriAssistantMessagesTable.id))
    .limit(12);
  const contents = history.reverse().map((message) => ({
    role: message.role === "assistant" ? "model" as const : "user" as const,
    parts: [{ text: message.content }],
  }));
  contents.push({
    role: "user",
    parts: [{
      text: [
        "You are Pantri's kitchen assistant. Use only the supplied account data for personalized advice.",
        "Never claim to have changed data. Return only valid JSON matching the response schema.",
        "Suggest add_inventory or add_shopping actions only when the user clearly asks for an action. These are unexecuted proposals and will require user confirmation.",
        "Use an empty actions array for questions, advice, meal ideas, and recipes.",
        `Current kitchen data: ${JSON.stringify({
          inventory: data.inventory.slice(0, 100),
          shopping: data.shopping.slice(0, 100),
          preferences: data.preferences,
          savedRecipes: data.savedRecipes.slice(0, 20),
        })}`,
        `User message: ${parsed.data.message.trim()}`,
      ].join("\n\n"),
    }],
  });

  const responseSchema = {
    type: "object",
    properties: {
      answer: { type: "string" },
      actions: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["add_inventory", "add_shopping"] },
            name: { type: "string" },
            quantity: { type: "number" },
            unit: { type: "string" },
            location: {
              type: "string",
              enum: ["Pantry", "Fridge", "Freezer"],
            },
          },
          required: ["type", "name", "quantity", "unit", "location"],
        },
      },
    },
    required: ["answer", "actions"],
  };

  try {
    const result = await getGeminiClient().models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: responseSchema,
        maxOutputTokens: 2048,
      },
    });
    const raw = JSON.parse(getJsonText(result)) as unknown;
    const reply = SendAssistantMessageResponse.parse(raw);

    await db.insert(pantriAssistantMessagesTable).values([
      { userId, role: "user", content: parsed.data.message.trim() },
      { userId, role: "assistant", content: reply.answer },
    ]);
    res.json(reply);
  } catch (error) {
    sendGeminiError(req, res, error);
  }
});

router.post("/assistant/recipes", sharedFreeTierLimit, recipeLimit, async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to generate recipes." });
    return;
  }
  const parsed = GenerateAssistantRecipeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a recipe request of up to 1,000 characters." });
    return;
  }

  const data = await loadAccountData(userId);
  const recipeSchema = {
    type: "object",
    properties: {
      title: { type: "string" },
      servings: { type: "integer" },
      ingredients: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            quantity: { type: "number" },
            unit: { type: "string" },
          },
          required: ["name", "quantity", "unit"],
        },
      },
      instructions: { type: "array", items: { type: "string" } },
      minutes: { type: "integer" },
      dietaryTags: { type: "array", items: { type: "string" } },
    },
    required: ["title", "servings", "ingredients", "instructions", "minutes", "dietaryTags"],
  };

  try {
    const result = await getGeminiClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        "Create one practical recipe. Ingredient amounts must be explicit numeric quantities with units. Do not invent nutrition facts. Return JSON only.",
        `User request: ${parsed.data.prompt.trim()}`,
        `Available inventory: ${JSON.stringify(data.inventory.slice(0, 100))}`,
        `Dietary preferences: ${JSON.stringify(data.preferences.dietaryFilters)}`,
      ].join("\n\n"),
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: recipeSchema,
        maxOutputTokens: 2500,
      },
    });
    const generated = JSON.parse(getJsonText(result)) as Record<string, unknown>;
    const recipe = GenerateAssistantRecipeResponse.parse({
      ...generated,
      id: randomUUID(),
      caloriesPerServing: null,
      proteinGramsPerServing: null,
      fiberGramsPerServing: null,
    });
    res.json(recipe);
  } catch (error) {
    sendGeminiError(req, res, error);
  }
});

router.post("/assistant/scan", sharedFreeTierLimit, scanLimit, async (req, res): Promise<void> => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to scan a kitchen image." });
    return;
  }
  const parsed = AnalyzeKitchenImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Choose a JPEG, PNG, or WebP image no larger than 5 MB." });
    return;
  }

  const { imageBase64, mimeType, mode } = parsed.data;
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64) ||
    imageBase64.length > 7_000_000
  ) {
    res.status(413).json({ error: "The image exceeds Pantri's 5 MB scan limit." });
    return;
  }
  const image = Buffer.from(imageBase64, "base64");
  const validSignature =
    (mimeType === "image/jpeg" &&
      image[0] === 0xff &&
      image[1] === 0xd8 &&
      image[2] === 0xff) ||
    (mimeType === "image/png" &&
      image.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) ||
    (mimeType === "image/webp" &&
      image.subarray(0, 4).toString() === "RIFF" &&
      image.subarray(8, 12).toString() === "WEBP");
  if (!validSignature) {
    res.status(400).json({ error: "The image type does not match its file content." });
    return;
  }
  if (image.byteLength > 5 * 1024 * 1024) {
    res.status(413).json({ error: "The image exceeds Pantri's 5 MB scan limit." });
    return;
  }

  const scanSchema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        maxItems: 60,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            quantity: { type: "number" },
            unit: { type: "string" },
            location: { type: "string", enum: ["Pantry", "Fridge", "Freezer"] },
            confidence: { type: "number" },
            notes: { type: "string" },
          },
          required: ["name", "quantity", "unit", "location", "confidence", "notes"],
        },
      },
      notes: { type: "string" },
    },
    required: ["items", "notes"],
  };

  const prompt =
    mode === "receipt"
      ? "Read this grocery receipt. Extract only food products that are legible. Do not add prices or non-food items. Set conservative quantities and storage locations. Set confidence from 0 to 1 and explain uncertainty in notes. Do not guess unreadable products."
      : "Identify visible foods in this kitchen photo that could be added to a home inventory. Do not guess hidden items, quantities, or expiration dates. Use conservative quantities, storage locations, confidence from 0 to 1, and explain uncertainty in notes.";

  try {
    const result = await getGeminiClient().models.generateContent({
      model: GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: scanSchema,
        maxOutputTokens: 2500,
      },
    });
    const analysis = AnalyzeKitchenImageResponse.parse(
      JSON.parse(getJsonText(result)),
    );
    res.json(analysis);
  } catch (error) {
    sendGeminiError(req, res, error);
  }
});

export default router;
