import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import {
  db,
  pantriAccountDataTable,
  pantriAssistantMessagesTable,
  pantriImportsTable,
} from "@workspace/db";
import {
  GetMyDataResponse,
  ImportMyDataBody,
  SaveMyDataBody,
  type AccountData,
} from "@workspace/api-zod";

const router: IRouter = Router();

const emptyData = (): AccountData => ({
  inventory: [],
  shopping: [],
  preferences: {
    dietaryFilters: [],
    allergyFilters: [],
    cuisinePreferences: ["Worldwide"],
    householdSize: 2,
    units: "Metric",
    expirationReminders: true,
    budgetAmount: null,
    budgetCurrency: "USD",
    budgetPeriod: "Weekly",
  },
  savedRecipes: [],
  mealPlan: [],
});

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function normalizePreferences(preferences: AccountData["preferences"] | undefined): AccountData["preferences"] {
  const cuisinePreferences = Array.isArray(preferences?.cuisinePreferences)
    ? preferences.cuisinePreferences
    : [];
  return {
    dietaryFilters: preferences?.dietaryFilters ?? [],
    allergyFilters: preferences?.allergyFilters ?? [],
    cuisinePreferences: cuisinePreferences.includes("Worldwide") || cuisinePreferences.length === 0
      ? ["Worldwide"]
      : cuisinePreferences,
    householdSize: preferences?.householdSize ?? 2,
    units: preferences?.units ?? "Metric",
    expirationReminders: preferences?.expirationReminders ?? true,
    budgetAmount: preferences?.budgetAmount ?? null,
    budgetCurrency: preferences?.budgetCurrency ?? "USD",
    budgetPeriod: preferences?.budgetPeriod ?? "Weekly",
  };
}

function mergeImport(current: AccountData, incoming: AccountData): AccountData {
  const inventory = [...current.inventory];
  for (const item of incoming.inventory) {
    const existing = inventory.find(
      (candidate) =>
        normalize(candidate.name) === normalize(item.name) &&
        candidate.location === item.location,
    );
    if (!existing) inventory.push(item);
    else if (
      normalize(existing.unit) === normalize(item.unit) &&
      existing.quantity !== item.quantity
    ) {
      existing.quantity += item.quantity;
    }
  }

  const shopping = [...current.shopping];
  for (const item of incoming.shopping) {
    const exists = shopping.some(
      (candidate) =>
        normalize(candidate.name) === normalize(item.name) &&
        candidate.checked === item.checked,
    );
    if (!exists) shopping.push(item);
  }

  const savedRecipes = [...current.savedRecipes];
  for (const recipe of incoming.savedRecipes) {
    if (
      !savedRecipes.some(
        (candidate) => normalize(candidate.title) === normalize(recipe.title),
      )
    ) {
      savedRecipes.push(recipe);
    }
  }

  const mealPlan = [...current.mealPlan];
  for (const meal of incoming.mealPlan) {
    if (
      !mealPlan.some(
        (candidate) =>
          candidate.date === meal.date &&
          candidate.meal === meal.meal &&
          normalize(candidate.title) === normalize(meal.title),
      )
    ) {
      mealPlan.push(meal);
    }
  }

  return {
    inventory,
    shopping,
    preferences: incoming.preferences,
    savedRecipes,
    mealPlan,
  };
}

async function readOrCreateData(userId: string): Promise<AccountData> {
  await db
    .insert(pantriAccountDataTable)
    .values({ userId, data: emptyData() })
    .onConflictDoNothing();
  const [row] = await db
    .select({ data: pantriAccountDataTable.data })
    .from(pantriAccountDataTable)
    .where(eq(pantriAccountDataTable.userId, userId))
    .limit(1);
  const stored = row?.data as AccountData | undefined;
  if (!stored) return emptyData();
  return {
    ...stored,
    preferences: normalizePreferences(stored.preferences),
  };
}

router.get("/me/data", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to access your kitchen." });
    return;
  }

  const data = await readOrCreateData(userId);
  res.json(GetMyDataResponse.parse(data));
});

router.put("/me/data", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to save your kitchen." });
    return;
  }

  const parsed = SaveMyDataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Kitchen data is invalid." });
    return;
  }

  const data = JSON.parse(JSON.stringify(parsed.data)) as AccountData;
  data.preferences = normalizePreferences(data.preferences);
  await db
    .insert(pantriAccountDataTable)
    .values({ userId, data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: pantriAccountDataTable.userId,
      set: { data, updatedAt: new Date() },
    });
  res.json(GetMyDataResponse.parse(data));
});

router.post("/me/import", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in before importing browser data." });
    return;
  }

  const parsed = ImportMyDataBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The browser data could not be imported." });
    return;
  }

  const importedData = JSON.parse(
    JSON.stringify(parsed.data.data),
  ) as AccountData;
  const merged = await db.transaction(async (tx) => {
    const [alreadyImported] = await tx
      .insert(pantriImportsTable)
      .values({ userId, requestId: parsed.data.requestId })
      .onConflictDoNothing()
      .returning({ requestId: pantriImportsTable.requestId });

    if (!alreadyImported) return readOrCreateData(userId);

    await tx
      .insert(pantriAccountDataTable)
      .values({ userId, data: emptyData() })
      .onConflictDoNothing();
    const [row] = await tx
      .select({ data: pantriAccountDataTable.data })
      .from(pantriAccountDataTable)
      .where(eq(pantriAccountDataTable.userId, userId))
      .limit(1);
    const data = mergeImport(
      (row?.data as AccountData | undefined) ?? emptyData(),
      importedData,
    );
    await tx
      .insert(pantriAccountDataTable)
      .values({ userId, data, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: pantriAccountDataTable.userId,
        set: { data, updatedAt: new Date() },
      });
    return data;
  });

  res.json(GetMyDataResponse.parse(merged));
});

router.delete("/me/account", async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in before deleting your data." });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(pantriAssistantMessagesTable)
      .where(eq(pantriAssistantMessagesTable.userId, userId));
    await tx.delete(pantriImportsTable).where(eq(pantriImportsTable.userId, userId));
    await tx
      .delete(pantriAccountDataTable)
      .where(eq(pantriAccountDataTable.userId, userId));
  });
  res.sendStatus(204);
});

export default router;
