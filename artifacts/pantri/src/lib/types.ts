import type { MealPlanItem, SavedRecipe } from '@workspace/api-client-react';

export type Location = 'Pantry' | 'Fridge' | 'Freezer';
export type FoodCategory = 'Fruit' | 'Vegetable' | 'Dairy' | 'Meat' | 'Seafood' | 'Grains' | 'Bakery' | 'Frozen' | 'Condiment' | 'Beverage' | 'Snack' | 'Other';

export type FoodItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  location: Location;
  expirationDate: string;
  category?: FoodCategory | null;
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
  allergyFilters: string[];
  cuisinePreferences: ('Worldwide' | 'Moroccan' | 'Italian' | 'Mexican' | 'Indian' | 'Chinese' | 'Japanese' | 'Mediterranean' | 'American' | 'Other')[];
  householdSize: number;
  units: 'Metric' | 'Imperial';
  expirationReminders: boolean;
  budgetAmount: number | null;
  budgetCurrency: 'USD' | 'EUR' | 'GBP' | 'MAD' | 'CAD';
  budgetPeriod: 'Weekly' | 'Monthly';
};

export type AppData = {
  inventory: FoodItem[];
  shopping: ShoppingItem[];
  preferences: Preferences;
  savedRecipes: SavedRecipe[];
  mealPlan: MealPlanItem[];
};
