import type { AppData, FoodItem, Preferences, ShoppingItem } from './types';

const KEY = 'pantri-app-data-v1';

const inDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

export const seedData: AppData = {
  inventory: [
    { id: 'seed-spinach', name: 'Baby spinach', quantity: 1, unit: 'bag', location: 'Fridge', expirationDate: inDays(2) },
    { id: 'seed-yogurt', name: 'Greek yogurt', quantity: 450, unit: 'g', location: 'Fridge', expirationDate: inDays(5) },
    { id: 'seed-tomatoes', name: 'Roma tomatoes', quantity: 5, unit: 'pieces', location: 'Fridge', expirationDate: inDays(4) },
    { id: 'seed-eggs', name: 'Eggs', quantity: 8, unit: 'pieces', location: 'Fridge', expirationDate: inDays(12) },
    { id: 'seed-pasta', name: 'Penne pasta', quantity: 340, unit: 'g', location: 'Pantry', expirationDate: inDays(180) },
    { id: 'seed-rice', name: 'Rice', quantity: 700, unit: 'g', location: 'Pantry', expirationDate: inDays(200) },
    { id: 'seed-chickpeas', name: 'Chickpeas', quantity: 2, unit: 'cans', location: 'Pantry', expirationDate: inDays(150) },
    { id: 'seed-oats', name: 'Oats', quantity: 500, unit: 'g', location: 'Pantry', expirationDate: inDays(90) },
    { id: 'seed-peas', name: 'Green peas', quantity: 300, unit: 'g', location: 'Freezer', expirationDate: inDays(75) },
    { id: 'seed-berries', name: 'Blueberries', quantity: 1, unit: 'bag', location: 'Freezer', expirationDate: inDays(60) },
    { id: 'seed-lemon', name: 'Lemons', quantity: 2, unit: 'pieces', location: 'Fridge', expirationDate: inDays(8) },
    { id: 'seed-onion', name: 'Onion', quantity: 3, unit: 'pieces', location: 'Pantry', expirationDate: inDays(30) },
    { id: 'seed-olive-oil', name: 'Olive oil', quantity: 1, unit: 'bottle', location: 'Pantry', expirationDate: inDays(365) },
  ],
  shopping: [
    { id: 'seed-shopping-1', name: 'Parmesan', quantity: 1, unit: 'wedge', checked: false, sourceRecipe: 'Creamy spinach pasta' },
    { id: 'seed-shopping-2', name: 'Cucumber', quantity: 2, unit: 'pieces', checked: false, sourceRecipe: 'Crispy chickpea bowls' },
    { id: 'seed-shopping-3', name: 'Fresh basil', quantity: 1, unit: 'bunch', checked: true },
  ],
  preferences: {
    dietaryFilters: [],
    allergyFilters: [],
    cuisinePreferences: ['Worldwide'],
    householdSize: 2,
    units: 'Metric',
    expirationReminders: true,
    budgetAmount: null,
    budgetCurrency: 'USD',
    budgetPeriod: 'Weekly',
  },
  savedRecipes: [],
  mealPlan: [],
};

export function readLegacyData(): AppData | null {
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<AppData>;
    return {
      ...seedData,
      ...parsed,
      preferences: { ...seedData.preferences, ...parsed.preferences },
      savedRecipes: parsed.savedRecipes ?? [],
      mealPlan: parsed.mealPlan ?? [],
    };
  } catch {
    return null;
  }
}

export type { FoodItem, Preferences, ShoppingItem };
