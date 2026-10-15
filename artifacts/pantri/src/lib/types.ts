import type { MealPlanItem, SavedRecipe } from '@workspace/api-client-react';

export type Location = 'Pantry' | 'Fridge' | 'Freezer';

export type FoodItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  location: Location;
  expirationDate: string;
};

export type Recipe = {
  id: string;
  title: string;
  ingredients: string[];
  calories: number;
  dietaryTags: string[];
  instructions: string[];
  foodIcon: string;
  minutes: number;
};

export type ShoppingItem = {
  id: string;
  name: string;
  quantity?: number | null;
  unit?: string | null;
  checked: boolean;
  sourceRecipe?: string | null;
};

export type Preferences = {
  dietaryFilters: string[];
  householdSize: number;
  units: 'Metric' | 'Imperial';
  expirationReminders: boolean;
};

export type AppData = {
  inventory: FoodItem[];
  shopping: ShoppingItem[];
  preferences: Preferences;
  savedRecipes: SavedRecipe[];
  mealPlan: MealPlanItem[];
};
