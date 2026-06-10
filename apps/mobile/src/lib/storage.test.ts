import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppState, CatalogAlias, Food, Ingredient, Intake, Recipe, RecipeItem, WeightLog } from '../types';
import {
  bmi,
  calculateKcal,
  canonicalizeStateReferences,
  catalogItems,
  dailyKcalGoal,
  dateKey,
  dayEndMs,
  dayStartMs,
  defaultState,
  findCatalogItem,
  ingredientAsFood,
  latestWeightForDay,
  loadState,
  mergeAliases,
  mergeById,
  normalizeFood,
  recipeAsFood,
  resolveCatalogId,
} from './storage';

function installLocalStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  });
}

const baseFood = (overrides: Partial<Food> = {}): Food => ({
  id: 'food-1',
  source_id: 'mobile-test',
  name: 'Apple',
  name_i18n: null,
  brand: null,
  catalog_kind: 'food',
  note: null,
  default_unit: 'g',
  serving_size_g: null,
  kcal_per_100g: 52,
  carbs_per_100g: 14,
  fat_per_100g: 0.2,
  protein_per_100g: 0.3,
  sugars_per_100g: null,
  fiber_per_100g: null,
  salt_per_100g: null,
  optional_nutrients: {},
  barcode: null,
  updated_at: 1,
  deleted_at: null,
  pending_sync: false,
  ...overrides,
});

const baseIngredient = (overrides: Partial<Ingredient> = {}): Ingredient => ({
  id: 'ingredient-1',
  source_id: 'mobile-test',
  name: 'Flour',
  name_i18n: null,
  note: null,
  default_unit: 'g',
  serving_size_g: null,
  kcal_per_100g: 364,
  carbs_per_100g: 76,
  fat_per_100g: 1,
  protein_per_100g: 10,
  sugars_per_100g: null,
  fiber_per_100g: null,
  salt_per_100g: null,
  optional_nutrients: {},
  updated_at: 1,
  deleted_at: null,
  pending_sync: false,
  ...overrides,
});

const baseRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
  id: 'recipe-1',
  source_id: 'mobile-test',
  name: 'Pancake',
  name_i18n: null,
  description: null,
  note: null,
  total_weight_g: null,
  extra_kcal: 0,
  servings_count: null,
  updated_at: 1,
  deleted_at: null,
  pending_sync: false,
  ...overrides,
});

const baseRecipeItem = (overrides: Partial<RecipeItem> = {}): RecipeItem => ({
  id: 'recipe-item-1',
  recipe_id: 'recipe-1',
  food_id: 'food-1',
  amount_g: 100,
  updated_at: 1,
  deleted_at: null,
  pending_sync: false,
  ...overrides,
});

const baseIntake = (overrides: Partial<Intake> = {}): Intake => ({
  id: 'intake-1',
  source_id: 'mobile-test',
  item_type: 'food',
  food_id: 'food-1',
  consumed_at: new Date(2026, 5, 10, 12).getTime(),
  meal_type: 'lunch',
  amount_g: 100,
  unit: 'g',
  serving_qty: null,
  food_snapshot_json: JSON.stringify(baseFood()),
  note_title: null,
  note_description: null,
  note_final: false,
  preparation_method: null,
  preparation_oil_ml: null,
  preparation_kcal: null,
  pending_sync: true,
  created_at: 1,
  updated_at: 1,
  ...overrides,
});

const baseWeight = (overrides: Partial<WeightLog> = {}): WeightLog => ({
  id: 'weight-1',
  measured_at: new Date(2026, 5, 10, 7).getTime(),
  weight_kg: 80,
  bmi: 26.1,
  source: 'manual',
  pending_sync: false,
  created_at: 1,
  updated_at: 1,
  ...overrides,
});

beforeEach(() => {
  installLocalStorage();
  vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000000' });
});

describe('storage and nutrition helpers', () => {
  it('keeps date keys and day boundaries stable for diary filtering', () => {
    const date = new Date(2026, 5, 10, 15, 30);

    expect(dateKey(date)).toBe('2026-06-10');
    expect(dayStartMs('2026-06-10')).toBe(new Date(2026, 5, 10, 0, 0, 0, 0).getTime());
    expect(dayEndMs('2026-06-10')).toBe(new Date(2026, 5, 11, 0, 0, 0, 0).getTime());
  });

  it('calculates kcal, BMI, and daily targets from the profile domain', () => {
    const profile = {
      ...defaultState().profile,
      birthday: '1990-01-01',
      gender: 'male' as const,
      height_cm: 180,
      current_weight_kg: 90,
      plan_start_weight_kg: 100,
      activity_level: 'low_active' as const,
      weekly_goal_kg: -0.5,
    };

    expect(calculateKcal(baseFood({ kcal_per_100g: 250 }), 80)).toBe(200);
    expect(bmi(90, 180)).toBe(27.8);
    expect(dailyKcalGoal(profile, 200)).toBeGreaterThan(1500);
    expect(dailyKcalGoal({ ...profile, weekly_goal_kg: -5 })).toBe(dailyKcalGoal({ ...profile, weekly_goal_kg: -1 }));
  });

  it('normalizes catalog metadata and optional nutrients', () => {
    const food = normalizeFood(
      baseFood({
        source_id: 'github:foods',
        name_i18n: { HU: ' Alma ', en: '', de: 'Apfel' } as any,
        default_unit: '',
        sugars_per_100g: '12,5' as any,
        fiber_per_100g: -1 as any,
        salt_per_100g: '' as any,
        optional_nutrients: { ' iron_mg_per_100g ': '2,1', bad: Number.NaN, empty: '' } as any,
      }),
    );

    expect(food.catalog_source_kind).toBe('github');
    expect(food.source_label).toBe('foods');
    expect(food.default_unit).toBe('g');
    expect(food.name_i18n).toEqual({ hu: 'Alma', de: 'Apfel' });
    expect(food.sugars_per_100g).toBe(12.5);
    expect(food.fiber_per_100g).toBe(0);
    expect(food.salt_per_100g).toBeNull();
    expect(food.optional_nutrients).toEqual({ iron_mg_per_100g: 2.1 });
  });

  it('converts ingredients into catalog food rows without losing nutrients', () => {
    const ingredient = baseIngredient({
      id: 'flour',
      name: 'Flour',
      sugars_per_100g: 1,
      fiber_per_100g: 3,
      optional_nutrients: { iron_mg_per_100g: 4 },
    });

    const food = ingredientAsFood(ingredient);

    expect(food.id).toBe('ingredient:flour');
    expect(food.brand).toBe('Ingredient');
    expect(food.kcal_per_100g).toBe(364);
    expect(food.optional_nutrients).toEqual({ iron_mg_per_100g: 4 });
  });

  it('calculates recipe nutrition from foods, ingredients, servings, and extra kcal', () => {
    const food = baseFood({
      id: 'food-egg',
      name: 'Egg',
      kcal_per_100g: 150,
      carbs_per_100g: 1,
      fat_per_100g: 10,
      protein_per_100g: 13,
    });
    const ingredient = baseIngredient({
      id: 'flour',
      name: 'Flour',
      kcal_per_100g: 360,
      carbs_per_100g: 76,
      fat_per_100g: 1,
      protein_per_100g: 10,
      sugars_per_100g: 2,
      optional_nutrients: { iron_mg_per_100g: 4 },
    });
    const recipe = baseRecipe({ id: 'pancake', name: 'Pancake', extra_kcal: 60, servings_count: 3 });
    const items = [
      baseRecipeItem({ id: 'item-egg', recipe_id: 'pancake', food_id: 'food-egg', amount_g: 100 }),
      baseRecipeItem({ id: 'item-flour', recipe_id: 'pancake', food_id: 'ingredient:flour', amount_g: 200 }),
    ];

    const recipeFood = recipeAsFood(recipe, items, [food], [ingredient]);

    expect(recipeFood.id).toBe('recipe:pancake');
    expect(recipeFood.default_unit).toBe('serving');
    expect(recipeFood.serving_size_g).toBe(100);
    expect(Math.round(recipeFood.kcal_per_100g)).toBe(310);
    expect(Math.round(recipeFood.carbs_per_100g)).toBe(51);
    expect(Math.round(recipeFood.protein_per_100g)).toBe(11);
    expect(recipeFood.optional_nutrients?.iron_mg_per_100g).toBeCloseTo(2.67, 2);
  });

  it('prevents recursive recipes from breaking catalog generation', () => {
    const recipe = baseRecipe({ id: 'loop', name: 'Loop recipe' });
    const item = baseRecipeItem({ recipe_id: 'loop', food_id: 'recipe:loop', amount_g: 100 });

    const recipeFood = recipeAsFood(recipe, [item], [], [], [recipe], [item]);

    expect(recipeFood.id).toBe('recipe:loop');
    expect(recipeFood.kcal_per_100g).toBe(0);
  });

  it('merges catalog arrays by id, applies deletion markers, and sorts by name', () => {
    const current = [baseFood({ id: 'banana', name: 'Banana' }), baseFood({ id: 'apple', name: 'Apple' })];
    const incoming = [
      baseFood({ id: 'banana', name: 'Banana deleted', deleted_at: 100 }),
      baseFood({ id: 'carrot', name: 'Carrot' }),
    ];

    expect(mergeById(current, incoming).map((item) => item.id)).toEqual(['apple', 'carrot']);
  });

  it('merges aliases, ignores self-aliases, and resolves alias chains', () => {
    const aliases: CatalogAlias[] = mergeAliases(
      [{ kind: 'food', alias_id: 'old', canonical_id: 'middle', updated_at: 1 }],
      [
        { kind: 'food', alias_id: 'middle', canonical_id: 'new', updated_at: 2 },
        { kind: 'food', alias_id: 'same', canonical_id: 'same', updated_at: 3 },
      ],
    );
    const state: AppState = { ...defaultState(), catalogAliases: aliases };

    expect(aliases.map((alias) => alias.alias_id)).toEqual(['middle', 'old']);
    expect(resolveCatalogId(state, 'food', 'old')).toBe('new');
  });

  it('canonicalizes diary and recipe references while keeping notes local-only', () => {
    const state: AppState = {
      ...defaultState(),
      catalogAliases: [
        { kind: 'food', alias_id: 'food-old', canonical_id: 'food-new', updated_at: 1 },
        { kind: 'ingredient', alias_id: 'ingredient-old', canonical_id: 'ingredient-new', updated_at: 1 },
        { kind: 'recipe', alias_id: 'recipe-old', canonical_id: 'recipe-new', updated_at: 1 },
        { kind: 'activity', alias_id: 'activity-old', canonical_id: 'activity-new', updated_at: 1 },
      ],
      recipeItems: [
        baseRecipeItem({ recipe_id: 'recipe-old', food_id: 'ingredient:ingredient-old' }),
        baseRecipeItem({ id: 'recipe-item-2', recipe_id: 'recipe-old', food_id: 'food-old' }),
      ],
      intakes: [
        baseIntake({ id: 'food-intake', food_id: 'food-old', item_type: 'food' }),
        baseIntake({ id: 'recipe-intake', food_id: 'recipe:recipe-old', item_type: 'recipe' }),
        baseIntake({
          id: 'note-intake',
          item_type: 'note',
          food_id: '',
          note_title: 'Dinner note',
          pending_sync: true,
        }),
      ],
      activityLogs: [
        {
          id: 'activity-log-1',
          activity_id: 'activity-old',
          activity_name: 'Walk',
          performed_at: 1,
          duration_min: 20,
          kcal: 100,
          source: 'activity_catalog',
          pending_sync: true,
          created_at: 1,
          updated_at: 1,
        },
      ],
    };

    const next = canonicalizeStateReferences(state);

    expect(next.recipeItems.map((item) => item.recipe_id)).toEqual(['recipe-new', 'recipe-new']);
    expect(next.recipeItems.map((item) => item.food_id)).toEqual(['ingredient:ingredient-new', 'food-new']);
    expect(next.intakes.find((entry) => entry.id === 'food-intake')?.food_id).toBe('food-new');
    expect(next.intakes.find((entry) => entry.id === 'recipe-intake')?.food_id).toBe('recipe:recipe-new');
    expect(next.intakes.find((entry) => entry.id === 'note-intake')?.pending_sync).toBe(false);
    expect(next.activityLogs[0].activity_id).toBe('activity-new');
  });

  it('builds a unified catalog and finds canonical foods, ingredients, and recipes', () => {
    const state: AppState = {
      ...defaultState(),
      foods: [baseFood({ id: 'food-apple', name: 'Apple' })],
      ingredients: [baseIngredient({ id: 'flour', name: 'Flour' })],
      recipes: [baseRecipe({ id: 'pancake', name: 'Pancake' })],
      recipeItems: [baseRecipeItem({ recipe_id: 'pancake', food_id: 'food-apple', amount_g: 100 })],
    };

    expect(catalogItems(state).map((item) => item.id)).toEqual(['food-apple', 'ingredient:flour', 'recipe:pancake']);
    expect(findCatalogItem(state, 'ingredient:flour')?.name).toBe('Flour');
    expect(findCatalogItem(state, 'recipe:pancake')?.name).toBe('Pancake');
  });

  it('returns the latest weight available for the selected day', () => {
    const logs = [
      baseWeight({ id: 'old', measured_at: new Date(2026, 5, 8, 7).getTime(), weight_kg: 81 }),
      baseWeight({ id: 'current', measured_at: new Date(2026, 5, 10, 7).getTime(), weight_kg: 80 }),
      baseWeight({ id: 'future', measured_at: new Date(2026, 5, 12, 7).getTime(), weight_kg: 79 }),
    ];

    expect(latestWeightForDay(logs, '2026-06-10')?.id).toBe('current');
  });

  it('loads older state safely and normalizes persisted fluid logs', () => {
    localStorage.setItem(
      'nutrino.mobile.v3.state',
      JSON.stringify({
        settings: {
          desktop_api_enabled: false,
          micronutrient_limits: { sugars_per_100g: '45', salt_per_100g: -2, broken: 'nope' },
        },
        foods: [baseFood({ id: 'ingredient-from-old-food', catalog_kind: 'ingredient' })],
        fluidLogs: [
          { id: 'water', amount_dl: 2.26, is_alcohol: false, consumed_at: 100, created_at: 100, updated_at: 100 },
          { id: 'broken', amount_dl: -1, consumed_at: 100 },
        ],
      }),
    );

    const state = loadState();

    expect(state.settings.desktop_api_enabled).toBe(false);
    expect(state.settings.github_csv_enabled).toBe(true);
    expect(state.settings.micronutrient_limits.sugars_per_100g).toBe(45);
    expect(state.settings.micronutrient_limits.salt_per_100g).toBe(0);
    expect(state.ingredients.map((item) => item.id)).toContain('ingredient-from-old-food');
    expect(state.fluidLogs).toHaveLength(1);
    expect(state.fluidLogs[0].amount_dl).toBe(2.3);
  });
});
