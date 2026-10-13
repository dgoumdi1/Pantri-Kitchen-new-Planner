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
  quantity?: number;
  unit?: string;
  checked: boolean;
  sourceRecipe?: string;
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
};
