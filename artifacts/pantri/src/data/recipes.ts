import type { Recipe, FoodItem } from '../lib/types';

export const recipes: Recipe[] = [
  { id: 'spinach-pasta', title: 'Creamy spinach pasta', ingredients: ['Penne pasta', 'Baby spinach', 'Greek yogurt', 'Parmesan'], calories: 420, dietaryTags: ['Vegetarian'], instructions: ['Boil pasta until just tender, reserving a mug of the cooking water.', 'Wilt spinach in a warm pan, then stir in yogurt and a splash of pasta water.', 'Toss with pasta, season, and finish with Parmesan.'], foodIcon: 'salad', minutes: 25 },
  { id: 'tomato-eggs', title: 'Tomato egg skillet', ingredients: ['Roma tomatoes', 'Eggs', 'Onion', 'Olive oil'], calories: 310, dietaryTags: ['Vegetarian', 'Halal', 'Lactose-Free'], instructions: ['Soften sliced onion in olive oil.', 'Add chopped tomatoes and simmer until jammy.', 'Make little wells, add eggs, cover and cook until set.'], foodIcon: 'tomato', minutes: 20 },
  { id: 'chickpea-bowl', title: 'Crispy chickpea bowls', ingredients: ['Chickpeas', 'Cucumber', 'Lemon', 'Tahini'], calories: 385, dietaryTags: ['Vegan', 'Vegetarian', 'Halal', 'Lactose-Free'], instructions: ['Roast chickpeas with olive oil and a pinch of paprika.', 'Whisk tahini with lemon and a little warm water.', 'Serve over cucumber with the tahini dressing.'], foodIcon: 'bowl', minutes: 30 },
  { id: 'fried-rice', title: 'Garden vegetable fried rice', ingredients: ['Rice', 'Eggs', 'Carrots', 'Soy sauce'], calories: 390, dietaryTags: ['Vegetarian', 'Halal', 'Lactose-Free'], instructions: ['Cook carrots in a hot pan until tender.', 'Add cold rice and stir-fry until lightly crisp.', 'Push aside, scramble eggs, then fold through with soy sauce.'], foodIcon: 'rice', minutes: 18 },
  { id: 'lentil-soup', title: 'Lemony lentil soup', ingredients: ['Red lentils', 'Carrots', 'Onion', 'Lemon'], calories: 330, dietaryTags: ['Vegan', 'Vegetarian', 'Halal', 'Lactose-Free'], instructions: ['Soften onion and carrots in a pot.', 'Add lentils and water; simmer until the lentils soften.', 'Finish with lemon juice and black pepper.'], foodIcon: 'soup', minutes: 35 },
  { id: 'avocado-toast', title: 'Avocado & tomato toast', ingredients: ['Avocado', 'Sourdough bread', 'Roma tomatoes', 'Lemon'], calories: 290, dietaryTags: ['Vegan', 'Vegetarian', 'Halal', 'Lactose-Free'], instructions: ['Toast the sourdough until golden.', 'Mash avocado with lemon and a little salt.', 'Pile onto toast and top with sliced tomatoes.'], foodIcon: 'toast', minutes: 10 },
  { id: 'coconut-curry', title: 'Coconut chickpea curry', ingredients: ['Chickpeas', 'Coconut milk', 'Spinach', 'Rice'], calories: 460, dietaryTags: ['Vegan', 'Vegetarian', 'Halal', 'Lactose-Free'], instructions: ['Warm curry spices in a little oil.', 'Add chickpeas and coconut milk; simmer for 15 minutes.', 'Fold in spinach and serve with rice.'], foodIcon: 'curry', minutes: 25 },
  { id: 'potato-hash', title: 'Herby potato hash', ingredients: ['Potatoes', 'Eggs', 'Onion', 'Parsley'], calories: 355, dietaryTags: ['Vegetarian', 'Halal', 'Lactose-Free'], instructions: ['Dice and pan-fry potatoes until crisp and tender.', 'Add onion and cook until soft.', 'Top with fried eggs and chopped parsley.'], foodIcon: 'potato', minutes: 28 },
  { id: 'yogurt-bowl', title: 'Honey yogurt breakfast bowl', ingredients: ['Greek yogurt', 'Oats', 'Honey', 'Blueberries'], calories: 340, dietaryTags: ['Vegetarian', 'Halal'], instructions: ['Spoon yogurt into a bowl.', 'Scatter over oats and blueberries.', 'Drizzle with honey just before serving.'], foodIcon: 'bowl', minutes: 5 },
  { id: 'bean-tacos', title: 'Smoky bean tacos', ingredients: ['Black beans', 'Tortillas', 'Roma tomatoes', 'Avocado'], calories: 410, dietaryTags: ['Vegan', 'Vegetarian', 'Halal', 'Lactose-Free'], instructions: ['Warm beans with smoked paprika and a splash of water.', 'Dice tomato and avocado for a quick salsa.', 'Fill warm tortillas and finish with salsa.'], foodIcon: 'taco', minutes: 20 },
  { id: 'salmon-tray', title: 'Lemon salmon tray bake', ingredients: ['Salmon', 'Potatoes', 'Lemon', 'Green beans'], calories: 485, dietaryTags: ['Halal', 'Lactose-Free'], instructions: ['Roast potato wedges until nearly tender.', 'Add salmon and green beans to the tray.', 'Bake until salmon flakes easily; finish with lemon.'], foodIcon: 'fish', minutes: 35 },
  { id: 'apple-oats', title: 'Warm apple cinnamon oats', ingredients: ['Oats', 'Apples', 'Milk', 'Cinnamon'], calories: 315, dietaryTags: ['Vegetarian', 'Halal'], instructions: ['Simmer oats with milk until creamy.', 'Fold through diced apple and cinnamon.', 'Serve warm with a splash of milk.'], foodIcon: 'oats', minutes: 12 },
];

export function normalizeIngredient(value: string) {
  return value.toLowerCase().trim().replace(/s$/, '').replace(/[^a-z0-9 ]/g, '');
}

export function matchesInventory(ingredient: string, inventory: FoodItem[]) {
  const target = normalizeIngredient(ingredient);
  return inventory.some((item) => {
    const name = normalizeIngredient(item.name);
    return name === target || name.includes(target) || target.includes(name);
  });
}
