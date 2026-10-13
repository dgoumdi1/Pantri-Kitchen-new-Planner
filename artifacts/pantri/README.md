# Pantri

Pantri is a friendly, local-first kitchen inventory and meal-planning app. Keep track of pantry, fridge, and freezer ingredients, find recipes that fit what you have, and collect the missing bits in one useful shopping list.

## Features

- **Kitchen inventory:** add, edit, and remove food, track quantity, unit, location, and expiration date. Filter by Pantry, Fridge, and Freezer, with a use-soon list on the dashboard.
- **Recipe ideas:** twelve sample recipes with ingredients, calories, dietary tags, prep time, and short instructions. Ideas are ranked by ingredient match against your inventory.
- **Dietary filters:** choose any combination of Halal, Vegan, Vegetarian, and Lactose-Free; a recipe must match every selected preference.
- **Shopping list:** add items manually or from recipe gaps, check items off into Purchased, and remove entries.
- **Preferences:** household size, unit style, dietary preferences, and expiration reminders are saved automatically.
- **Private by default:** all app data stays in this browser's local storage. No account, API, or server storage is needed.
- Responsive desktop navigation and compact mobile bottom navigation.

## Run locally

From the project root:

```sh
pnpm --filter @workspace/pantri run dev
```

To type-check and build:

```sh
pnpm --filter @workspace/pantri run typecheck
pnpm --filter @workspace/pantri run build
```

The first visit seeds a complete sample kitchen and shopping list. Use **Settings → Restore sample kitchen** to reset the local sample data.
