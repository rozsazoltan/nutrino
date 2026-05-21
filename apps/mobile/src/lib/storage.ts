import type {
  ActivityDefinition,
  ActivityLevel,
  ActivityLog,
  AppState,
  AppSettings,
  Food,
  Gender,
  Intake,
  PairingConfig,
  Recipe,
  RecipeItem,
  UserProfile,
  WeightLog,
} from '../types';

const STORAGE_KEY = 'nutrino.mobile.v3.state';
const KCAL_PER_KG_PER_WEEK_DAILY = 1100;

const fallbackActivities: ActivityDefinition[] = [
  { id: 'activity-walking', code: '17190', name: 'walking', description: 'general, moderate pace', type: 'conditioning', met: 3.5, kcal_per_min: 4.4, updated_at: 0 },
  { id: 'activity-cycling', code: '01015', name: 'bicycling', description: 'general', type: 'bicycling', met: 7.5, kcal_per_min: 9.4, updated_at: 0 },
  { id: 'activity-running', code: '12150', name: 'running', description: 'general', type: 'running', met: 8.3, kcal_per_min: 10.4, updated_at: 0 },
  { id: 'activity-yoga', code: '02160', name: 'yoga', description: 'general, hatha', type: 'conditioning', met: 3.0, kcal_per_min: 3.8, updated_at: 0 },
  { id: 'activity-strength', code: '02050', name: 'resistance training', description: 'weight lifting', type: 'conditioning', met: 6.0, kcal_per_min: 7.5, updated_at: 0 },
];

export function inferDevBaseUrl(): string {
  if (!import.meta.env.DEV) return '';

  const explicit = import.meta.env.VITE_NUTRINO_API_BASE_URL;
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim().replace(/\/+$/, '');
  }

  if (typeof __NUTRINO_DEV_API_BASE_URL__ === 'string' && __NUTRINO_DEV_API_BASE_URL__.trim()) {
    return __NUTRINO_DEV_API_BASE_URL__.trim().replace(/\/+$/, '');
  }

  if (typeof __NUTRINO_DEV_HOST__ === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(__NUTRINO_DEV_HOST__)) {
    return `http://${__NUTRINO_DEV_HOST__}:8090/api/v1`;
  }

  return 'http://192.168.1.202:8090/api/v1';
}

export function isDevMode(): boolean {
  return Boolean(import.meta.env.DEV);
}

export function defaultPairing(): PairingConfig {
  return {
    baseUrl: inferDevBaseUrl(),
    token: '',
    sourceId: generateId('mobile'),
    lastSyncAt: 0,
    catalogRevision: 0,
    lastHealthCheckAt: 0,
  };
}


export function defaultSettings(): AppSettings {
  return {
    language: 'system',
    theme: 'system',
    units: 'metric',
    show_activity_tracking: true,
    show_meal_macros: true,
    show_micronutrients: false,
    daily_reminder: false,
    kcal_adjustment: 0,
    macro_carbs_percent: 60,
    macro_protein_percent: 15,
    macro_fat_percent: 25,
    tdee_equation: 'iom_2005',
  };
}

export function defaultProfile(): UserProfile {
  return {
    height_cm: 175,
    current_weight_kg: 80,
    birthday: '1990-01-01',
    gender: 'male',
    activity_level: 'low_active',
    weekly_goal_kg: -0.5,
    plan_start_weight_kg: 80,
    last_weight_prompt_at: 0,
  };
}

export function defaultState(): AppState {
  return {
    settings: defaultSettings(),
    pairing: defaultPairing(),
    profile: defaultProfile(),
    foods: [],
    recipes: [],
    recipeItems: [],
    activities: fallbackActivities,
    intakes: [],
    activityLogs: [],
    weightLogs: [],
  };
}

export function loadState(): AppState {
  const defaults = defaultState();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw) as Partial<AppState>;
    const storedPairing: Partial<PairingConfig> = parsed.pairing ?? {};
    const storedProfile: Partial<UserProfile> = parsed.profile ?? {};
    const storedSettings: Partial<AppSettings> = parsed.settings ?? {};

    return {
      ...defaults,
      ...parsed,
      settings: { ...defaults.settings, ...storedSettings },
      pairing: {
        ...defaults.pairing,
        ...storedPairing,
        baseUrl: import.meta.env.DEV ? defaults.pairing.baseUrl : String(storedPairing.baseUrl ?? defaults.pairing.baseUrl),
        token: import.meta.env.DEV ? '' : String(storedPairing.token ?? ''),
      },
      profile: {
        ...defaults.profile,
        ...storedProfile,
        plan_start_weight_kg: storedProfile.plan_start_weight_kg || storedProfile.current_weight_kg || defaults.profile.current_weight_kg,
      },
      foods: Array.isArray(parsed.foods) ? parsed.foods : [],
      recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [],
      recipeItems: Array.isArray(parsed.recipeItems) ? parsed.recipeItems : [],
      activities: Array.isArray(parsed.activities) && parsed.activities.length ? parsed.activities : defaults.activities,
      intakes: Array.isArray(parsed.intakes) ? parsed.intakes : [],
      activityLogs: Array.isArray(parsed.activityLogs) ? parsed.activityLogs : [],
      weightLogs: Array.isArray(parsed.weightLogs) ? parsed.weightLogs : [],
    };
  } catch {
    return defaults;
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function generateId(prefix = 'id'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function dateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function dateKeyFromMs(ms: number): string {
  return dateKey(new Date(ms));
}

export function dayStartMs(key = dateKey()): number {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

export function dayEndMs(key = dateKey()): number {
  return dayStartMs(key) + 24 * 60 * 60 * 1000;
}

export function mergeById<T extends { id: string; deleted_at?: number | null }>(current: T[], incoming: T[]): T[] {
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    if (item.deleted_at) map.delete(item.id);
    else map.set(item.id, item);
  }
  return [...map.values()].sort((a, b) => {
    const left = 'name' in a ? String((a as { name: string }).name) : a.id;
    const right = 'name' in b ? String((b as { name: string }).name) : b.id;
    return left.localeCompare(right);
  });
}

export function normalizeFood(food: Food): Food {
  return {
    ...food,
    brand: food.brand ?? null,
    note: food.note ?? null,
    default_unit: food.default_unit || 'g',
    serving_size_g: food.serving_size_g ?? null,
    sugars_per_100g: food.sugars_per_100g ?? 0,
    fiber_per_100g: food.fiber_per_100g ?? 0,
    salt_per_100g: food.salt_per_100g ?? 0,
  };
}

export function foodSnapshot(item: Food | RecipeFood): string {
  return JSON.stringify(item);
}

export interface RecipeFood extends Food {
  recipe_id: string;
}

export function recipeAsFood(recipe: Recipe, items: RecipeItem[], foods: Food[]): RecipeFood {
  const totalWeight = items.reduce((sum, item) => sum + Math.max(0, item.amount_g), 0);
  let kcal = 0;
  let carbs = 0;
  let fat = 0;
  let protein = 0;

  for (const item of items) {
    const food = foods.find((entry) => entry.id === item.food_id);
    if (!food) continue;
    kcal += food.kcal_per_100g * item.amount_g / 100;
    carbs += food.carbs_per_100g * item.amount_g / 100;
    fat += food.fat_per_100g * item.amount_g / 100;
    protein += food.protein_per_100g * item.amount_g / 100;
  }

  const ratio = totalWeight > 0 ? 100 / totalWeight : 0;
  const serving = recipe.servings_count && recipe.servings_count > 0 && totalWeight > 0
    ? totalWeight / recipe.servings_count
    : null;

  return {
    id: `recipe:${recipe.id}`,
    recipe_id: recipe.id,
    source_id: recipe.source_id,
    name: recipe.name,
    brand: 'Recipe',
    note: recipe.note ?? recipe.description ?? null,
    default_unit: serving ? 'serving' : 'g',
    serving_size_g: serving,
    kcal_per_100g: kcal * ratio,
    carbs_per_100g: carbs * ratio,
    fat_per_100g: fat * ratio,
    protein_per_100g: protein * ratio,
    sugars_per_100g: 0,
    fiber_per_100g: 0,
    salt_per_100g: 0,
    updated_at: recipe.updated_at,
    deleted_at: recipe.deleted_at,
  };
}

export function catalogItems(state: AppState): Array<Food | RecipeFood> {
  const recipeFoods = state.recipes.map((recipe) => recipeAsFood(
    recipe,
    state.recipeItems.filter((item) => item.recipe_id === recipe.id && !item.deleted_at),
    state.foods,
  ));
  return [...state.foods.map(normalizeFood), ...recipeFoods].sort((a, b) => a.name.localeCompare(b.name));
}

export function findCatalogItem(state: AppState, id: string): Food | RecipeFood | undefined {
  return catalogItems(state).find((item) => item.id === id || item.id === `recipe:${id}`);
}

export function calculateKcal(food: Food, amountG: number): number {
  return Math.round((food.kcal_per_100g * amountG) / 100);
}

export function bmi(weightKg: number, heightCm: number): number {
  if (!weightKg || !heightCm) return 0;
  const meters = heightCm / 100;
  return Math.round((weightKg / (meters * meters)) * 10) / 10;
}

export function ageFromBirthday(birthday: string): number {
  const date = new Date(birthday);
  if (Number.isNaN(date.getTime())) return 30;
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const beforeBirthday = today.getMonth() < date.getMonth() || (today.getMonth() === date.getMonth() && today.getDate() < date.getDate());
  if (beforeBirthday) age -= 1;
  return Math.max(13, age);
}

export function palValue(level: ActivityLevel): number {
  switch (level) {
    case 'sedentary': return 1.25;
    case 'low_active': return 1.5;
    case 'active': return 1.75;
    case 'very_active': return 2.2;
  }
}

function paValue(level: ActivityLevel, gender: 'male' | 'female'): number {
  const pal = palValue(level);
  if (gender === 'male') {
    if (pal < 1.4) return 1.0;
    if (pal < 1.6) return 1.11;
    if (pal < 1.9) return 1.25;
    return 1.48;
  }
  if (pal < 1.4) return 1.0;
  if (pal < 1.6) return 1.12;
  if (pal < 1.9) return 1.27;
  return 1.45;
}

function calculationWeight(profile: UserProfile): number {
  const start = profile.plan_start_weight_kg || profile.current_weight_kg;
  if (profile.weekly_goal_kg < 0) return Math.min(profile.current_weight_kg, start);
  if (profile.weekly_goal_kg > 0) return Math.max(profile.current_weight_kg, start);
  return profile.current_weight_kg;
}

function tdeeByGender(profile: UserProfile, gender: 'male' | 'female'): number {
  const age = ageFromBirthday(profile.birthday);
  const weight = calculationWeight(profile);
  const heightM = profile.height_cm / 100;
  const pa = paValue(profile.activity_level, gender);
  if (gender === 'male') {
    return 864 - 9.72 * age + pa * 14.2 * weight + 503 * heightM;
  }
  return 387 - 7.31 * age + pa * 10.9 * weight + 660.7 * heightM;
}

export function tdee(profile: UserProfile): number {
  if (profile.gender === 'male') return tdeeByGender(profile, 'male');
  if (profile.gender === 'female') return tdeeByGender(profile, 'female');
  return (tdeeByGender(profile, 'male') + tdeeByGender(profile, 'female')) / 2;
}

export function dailyKcalGoal(profile: UserProfile, burnedKcal = 0): number {
  const weeklyAdjustment = Math.max(-1, Math.min(1, profile.weekly_goal_kg)) * KCAL_PER_KG_PER_WEEK_DAILY;
  const adjustment = Number((profile as any).kcal_adjustment ?? 0);
  return Math.round(tdee(profile) + weeklyAdjustment + burnedKcal + adjustment);
}

export function pendingIntakes(intakes: Intake[]): Intake[] {
  return intakes.filter((intake) => intake.pending_sync);
}

export function pendingWeightLogs(weightLogs: WeightLog[]): WeightLog[] {
  return weightLogs.filter((weight) => weight.pending_sync);
}

export function pendingActivityLogs(activityLogs: ActivityLog[]): ActivityLog[] {
  return activityLogs.filter((entry) => entry.pending_sync);
}

export function latestWeightForDay(weightLogs: WeightLog[], dayKeyValue: string): WeightLog | undefined {
  return weightLogs
    .filter((weight) => dateKeyFromMs(weight.measured_at) <= dayKeyValue)
    .sort((a, b) => b.measured_at - a.measured_at)[0];
}

export function needsWeightPrompt(profile: UserProfile, weightLogs: WeightLog[]): boolean {
  const last = [...weightLogs].sort((a, b) => b.measured_at - a.measured_at)[0];
  const reference = Math.max(last?.measured_at ?? 0, profile.last_weight_prompt_at ?? 0);
  return Date.now() - reference >= 7 * 24 * 60 * 60 * 1000;
}
