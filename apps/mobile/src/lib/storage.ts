import { drinkKindFromAlcoholKind, waterEquivalentDl } from './fluid';
import type {
  ActivityDefinition,
  ActivityLevel,
  ActivityLog,
  AppState,
  AppSettings,
  Food,
  Ingredient,
  HealthEntry,
  Intake,
  PairingConfig,
  AppChannel,
  CatalogAlias,
  CatalogKind,
  CatalogSourceKind,
  Recipe,
  RecipeItem,
  UserProfile,
  WeightLog,
  GitHubCsvSource,
  LocalizedNameMap,
  FluidLog,
} from '../types';

const STORAGE_KEY = 'nutrino.mobile.v3.state';
const KCAL_PER_KG_PER_WEEK_DAILY = 1100;

const fallbackActivities: ActivityDefinition[] = [
  {
    id: 'activity-walking',
    code: '17190',
    name: 'walking',
    description: 'general, moderate pace',
    type: 'conditioning',
    met: 3.5,
    kcal_per_min: 4.4,
    updated_at: 0,
    catalog_source_kind: 'custom',
    source_label: 'Nutrino default',
  },
  {
    id: 'activity-cycling',
    code: '01015',
    name: 'bicycling',
    description: 'general',
    type: 'bicycling',
    met: 7.5,
    kcal_per_min: 9.4,
    updated_at: 0,
    catalog_source_kind: 'custom',
    source_label: 'Nutrino default',
  },
  {
    id: 'activity-running',
    code: '12150',
    name: 'running',
    description: 'general',
    type: 'running',
    met: 8.3,
    kcal_per_min: 10.4,
    updated_at: 0,
    catalog_source_kind: 'custom',
    source_label: 'Nutrino default',
  },
  {
    id: 'activity-yoga',
    code: '02160',
    name: 'yoga',
    description: 'general, hatha',
    type: 'conditioning',
    met: 3.0,
    kcal_per_min: 3.8,
    updated_at: 0,
    catalog_source_kind: 'custom',
    source_label: 'Nutrino default',
  },
  {
    id: 'activity-strength',
    code: '02050',
    name: 'resistance training',
    description: 'weight lifting',
    type: 'conditioning',
    met: 6.0,
    kcal_per_min: 7.5,
    updated_at: 0,
    catalog_source_kind: 'custom',
    source_label: 'Nutrino default',
  },
];

export function inferDevBaseUrl(): string {
  const explicit = import.meta.env.VITE_NUTRINO_API_BASE_URL;
  if (typeof explicit === 'string' && explicit.trim()) {
    return explicit.trim().replace(/\/+$/, '');
  }

  if (!import.meta.env.DEV) return '';

  if (typeof __NUTRINO_DEV_API_BASE_URL__ === 'string' && __NUTRINO_DEV_API_BASE_URL__.trim()) {
    return __NUTRINO_DEV_API_BASE_URL__.trim().replace(/\/+$/, '');
  }

  if (typeof __NUTRINO_DEV_HOST__ === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(__NUTRINO_DEV_HOST__)) {
    return `http://${__NUTRINO_DEV_HOST__}:8090/api/v1`;
  }

  return 'http://192.168.1.202:8090/api/v1';
}

export function runtimeChannel(): AppChannel {
  const explicit = String(import.meta.env.VITE_NUTRINO_CHANNEL || '').toLowerCase();
  if (explicit === 'dev' || explicit === 'stable') return explicit;
  return import.meta.env.DEV ? 'dev' : 'stable';
}

export function isDevMode(): boolean {
  return runtimeChannel() === 'dev';
}

export function runtimeAppName(base = 'Nutrino'): string {
  return isDevMode() ? `${base} Dev` : base;
}

export function defaultPairing(): PairingConfig {
  return {
    baseUrl: inferDevBaseUrl(),
    token: '',
    password: '',
    channel: runtimeChannel(),
    sourceId: generateId('mobile'),
    lastSyncAt: 0,
    catalogRevision: 0,
    lastHealthCheckAt: 0,
  };
}

export const DEFAULT_MICRONUTRIENT_LIMITS: Record<string, number> = {
  sugars_per_100g: 50,
  fiber_per_100g: 30,
  salt_per_100g: 5,
  saturated_fat_per_100g: 20,
  sodium_mg_per_100g: 2300,
  calcium_mg_per_100g: 1000,
  iron_mg_per_100g: 18,
  potassium_mg_per_100g: 3500,
  vitamin_d_mcg_per_100g: 20,
  vitamin_b12_mcg_per_100g: 2.4,
  magnesium_mg_per_100g: 400,
};

export function defaultSettings(): AppSettings {
  return {
    language: 'system',
    theme: 'system',
    units: 'metric',
    desktop_api_enabled: true,
    github_csv_enabled: true,
    desktop_sync_prompted: false,
    check_prerelease_updates: false,
    show_activity_tracking: true,
    show_meal_macros: true,
    show_micronutrients: false,
    health_diary_enabled: false,
    protect_external_catalog_items: true,
    include_inactive_catalog_items: false,
    micronutrient_limits: { ...DEFAULT_MICRONUTRIENT_LIMITS },
    daily_reminder: false,
    daily_reminder_time: '20:00',
    weekly_weight_average_enabled: false,
    daily_weight_reminder_enabled: false,
    daily_weight_reminder_time: '07:30',
    meal_reminders_enabled: false,
    meal_reminder_morning_time: '08:00',
    meal_reminder_noon_time: '12:30',
    meal_reminder_afternoon_time: '17:30',
    calorie_deficit_enabled: false,
    target_deficit_kcal: 300,
    calorie_limit_warning_enabled: false,
    fluid_tracking_enabled: false,
    daily_fluid_goal_dl: 25,
    fluid_activity_bonus_dl_per_100_kcal: 2,
    fluid_reminders_enabled: false,
    fluid_reminder_interval_min: 120,
    fluid_skipped_day_keys: [],
    exercise_kcal_eatback_percent: 50,
    kcal_adjustment: 0,
    macro_carbs_percent: 60,
    macro_protein_percent: 15,
    macro_fat_percent: 25,
    tdee_equation: 'iom_2005',
  };
}

export function defaultProfile(): UserProfile {
  return {
    id: generateId('profile'),
    height_cm: 175,
    current_weight_kg: 80,
    birthday: '1990-01-01',
    gender: 'male',
    activity_level: 'low_active',
    weekly_goal_kg: -0.5,
    plan_start_weight_kg: 80,
    usage_purposes: [],
    last_weight_prompt_at: 0,
  };
}

export function defaultState(): AppState {
  return {
    settings: defaultSettings(),
    pairing: defaultPairing(),
    profile: defaultProfile(),
    foods: [],
    ingredients: [],
    recipes: [],
    recipeItems: [],
    activities: fallbackActivities,
    intakes: [],
    activityLogs: [],
    fluidLogs: [],
    weightLogs: [],
    healthEntries: [],
    catalogAliases: [],
    githubSources: [],
  };
}

function normalizeFluidLog(entry: Partial<FluidLog> | null | undefined): FluidLog | null {
  if (!entry) return null;
  const amountDl = Number(entry.amount_dl ?? 0);
  const consumedAt = Number(entry.consumed_at || entry.created_at || Date.now());
  if (!Number.isFinite(amountDl) || amountDl <= 0) return null;
  return {
    id: String(entry.id || generateId('fluid')),
    consumed_at: Number.isFinite(consumedAt) ? consumedAt : Date.now(),
    amount_dl: Math.max(0, Math.round(amountDl * 10) / 10),
    drink_kind:
      entry.drink_kind || (entry.is_alcohol === true ? drinkKindFromAlcoholKind(entry.alcohol_kind) : 'fluid'),
    water_equivalent_dl: Number.isFinite(Number(entry.water_equivalent_dl))
      ? Math.max(0, Math.round(Number(entry.water_equivalent_dl) * 10) / 10)
      : waterEquivalentDl({
          amountDl,
          kind:
            entry.drink_kind || (entry.is_alcohol === true ? drinkKindFromAlcoholKind(entry.alcohol_kind) : 'fluid'),
        }),
    is_alcohol: entry.is_alcohol === true,
    alcohol_kind: entry.alcohol_kind || null,
    kcal: Number.isFinite(Number(entry.kcal)) ? Math.max(0, Math.round(Number(entry.kcal))) : 0,
    note: entry.note ? String(entry.note) : null,
    pending_sync: entry.pending_sync !== false,
    created_at: Number(entry.created_at || consumedAt || Date.now()),
    updated_at: Number(entry.updated_at || entry.created_at || consumedAt || Date.now()),
  };
}

function normalizeHealthEntry(entry: HealthEntry): HealthEntry {
  const attachments = Array.isArray(entry.attachments)
    ? entry.attachments.map((attachment: any) => ({
        id: String(attachment?.id || generateId('health-attachment')),
        type: attachment?.type === 'video' ? ('video' as const) : ('photo' as const),
        name: String(attachment?.name || attachment?.display_name || 'attachment'),
        display_name: attachment?.display_name ?? null,
        mime_type: String(attachment?.mime_type || (attachment?.type === 'video' ? 'video/*' : 'image/*')),
        size: Number(attachment?.size || 0),
        data_url: String(attachment?.data_url || ''),
        preview_data_url: attachment?.preview_data_url ? String(attachment.preview_data_url) : null,
        backup_path: attachment?.backup_path ? String(attachment.backup_path) : null,
        fingerprint: attachment?.fingerprint ? String(attachment.fingerprint) : null,
        created_at: Number(attachment?.created_at || Date.now()),
      }))
    : [];

  return {
    ...entry,
    profile_id: String(entry.profile_id || ''),
    event_id: String(entry.event_id || entry.id),
    recurrence_of_id: entry.recurrence_of_id ?? null,
    title: String(entry.title || ''),
    description: String(entry.description || ''),
    occurred_at: Number(entry.occurred_at || entry.created_at || Date.now()),
    category: entry.category || 'other',
    notes: entry.notes ?? null,
    attachments,
    ongoing: entry.ongoing === true,
    resolved_at: Number.isFinite(Number(entry.resolved_at)) ? Number(entry.resolved_at) : null,
    last_reviewed_at: Number.isFinite(Number(entry.last_reviewed_at)) ? Number(entry.last_reviewed_at) : null,
    review_dismissed_at: Number.isFinite(Number(entry.review_dismissed_at)) ? Number(entry.review_dismissed_at) : null,
    created_at: Number(entry.created_at || Date.now()),
    updated_at: Number(entry.updated_at || entry.created_at || Date.now()),
    deleted_at: entry.deleted_at ?? null,
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

    const rawFoodEntries = Array.isArray(parsed.foods) ? (parsed.foods as Food[]) : [];
    const migratedIngredients = rawFoodEntries
      .filter((food) => food.catalog_kind === 'ingredient')
      .map((food) => foodToIngredient(normalizeFood({ ...food, catalog_kind: 'food' })));
    const parsedIngredients = Array.isArray((parsed as any).ingredients)
      ? ((parsed as any).ingredients as Ingredient[]).map(normalizeIngredient)
      : [];
    const foods = rawFoodEntries
      .filter((food) => food.catalog_kind !== 'ingredient')
      .map((food) => normalizeFood({ ...food, catalog_kind: 'food' }));
    const ingredients = mergeById(parsedIngredients, migratedIngredients);

    const mergedSettings: AppSettings = {
      ...defaults.settings,
      ...storedSettings,
      daily_reminder: storedSettings.daily_reminder === true,
      daily_reminder_time:
        typeof storedSettings.daily_reminder_time === 'string'
          ? storedSettings.daily_reminder_time
          : defaults.settings.daily_reminder_time,
      weekly_weight_average_enabled: storedSettings.weekly_weight_average_enabled === true,
      desktop_api_enabled: storedSettings.desktop_api_enabled !== false,
      github_csv_enabled: storedSettings.github_csv_enabled !== false,
      desktop_sync_prompted: storedSettings.desktop_sync_prompted === true,
      check_prerelease_updates: storedSettings.check_prerelease_updates === true,
      daily_weight_reminder_enabled: storedSettings.daily_weight_reminder_enabled === true,
      meal_reminders_enabled: storedSettings.meal_reminders_enabled === true,
      calorie_deficit_enabled: storedSettings.calorie_deficit_enabled === true,
      calorie_limit_warning_enabled: storedSettings.calorie_limit_warning_enabled === true,
      fluid_tracking_enabled: storedSettings.fluid_tracking_enabled === true,
      fluid_reminders_enabled: storedSettings.fluid_reminders_enabled === true,
      fluid_skipped_day_keys: Array.isArray(storedSettings.fluid_skipped_day_keys)
        ? storedSettings.fluid_skipped_day_keys.filter(
            (key): key is string => typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key),
          )
        : [],
      health_diary_enabled: storedSettings.health_diary_enabled === true,
      protect_external_catalog_items: storedSettings.protect_external_catalog_items !== false,
      include_inactive_catalog_items: storedSettings.include_inactive_catalog_items === true,
      target_deficit_kcal: Number.isFinite(Number(storedSettings.target_deficit_kcal))
        ? Number(storedSettings.target_deficit_kcal)
        : defaults.settings.target_deficit_kcal,
      exercise_kcal_eatback_percent: Number.isFinite(Number(storedSettings.exercise_kcal_eatback_percent))
        ? Number(storedSettings.exercise_kcal_eatback_percent)
        : defaults.settings.exercise_kcal_eatback_percent,
      daily_fluid_goal_dl: Number.isFinite(Number(storedSettings.daily_fluid_goal_dl))
        ? Math.max(1, Number(storedSettings.daily_fluid_goal_dl))
        : defaults.settings.daily_fluid_goal_dl,
      fluid_activity_bonus_dl_per_100_kcal: Number.isFinite(Number(storedSettings.fluid_activity_bonus_dl_per_100_kcal))
        ? Math.max(0, Number(storedSettings.fluid_activity_bonus_dl_per_100_kcal))
        : defaults.settings.fluid_activity_bonus_dl_per_100_kcal,
      fluid_reminder_interval_min: Number.isFinite(Number(storedSettings.fluid_reminder_interval_min))
        ? Math.max(30, Math.round(Number(storedSettings.fluid_reminder_interval_min)))
        : defaults.settings.fluid_reminder_interval_min,
      micronutrient_limits: {
        ...DEFAULT_MICRONUTRIENT_LIMITS,
        ...(storedSettings.micronutrient_limits && typeof storedSettings.micronutrient_limits === 'object'
          ? Object.fromEntries(
              Object.entries(storedSettings.micronutrient_limits)
                .filter(([, value]) => Number.isFinite(Number(value)))
                .map(([key, value]) => [key, Math.max(0, Number(value))]),
            )
          : {}),
      },
    };

    return {
      ...defaults,
      ...parsed,
      settings: mergedSettings,
      pairing: {
        ...defaults.pairing,
        ...storedPairing,
        baseUrl: String(storedPairing.baseUrl ?? defaults.pairing.baseUrl),
        token: String(storedPairing.token ?? storedPairing.password ?? ''),
        password: String(storedPairing.password ?? storedPairing.token ?? ''),
        channel: runtimeChannel(),
      },
      profile: {
        ...defaults.profile,
        ...storedProfile,
        id: storedProfile.id || defaults.profile.id,
        plan_start_weight_kg:
          storedProfile.plan_start_weight_kg || storedProfile.current_weight_kg || defaults.profile.current_weight_kg,
        usage_purposes: Array.isArray(storedProfile.usage_purposes)
          ? storedProfile.usage_purposes
          : defaults.profile.usage_purposes,
      },
      foods,
      ingredients,
      recipes: Array.isArray(parsed.recipes) ? parsed.recipes.map((recipe: Recipe) => normalizeRecipe(recipe)) : [],
      recipeItems: Array.isArray(parsed.recipeItems) ? parsed.recipeItems : [],
      activities: Array.isArray(parsed.activities)
        ? parsed.activities.map((activity) => normalizeActivity(activity))
        : defaults.activities,
      intakes: Array.isArray(parsed.intakes) ? parsed.intakes : [],
      activityLogs: Array.isArray(parsed.activityLogs) ? parsed.activityLogs : [],
      fluidLogs: Array.isArray((parsed as any).fluidLogs)
        ? (((parsed as any).fluidLogs as Partial<FluidLog>[]).map(normalizeFluidLog).filter(Boolean) as FluidLog[])
        : [],
      weightLogs: Array.isArray(parsed.weightLogs) ? parsed.weightLogs : [],
      healthEntries: Array.isArray((parsed as any).healthEntries)
        ? ((parsed as any).healthEntries as HealthEntry[]).map(normalizeHealthEntry)
        : [],
      catalogAliases: Array.isArray(parsed.catalogAliases) ? parsed.catalogAliases : [],
      githubSources: Array.isArray(parsed.githubSources)
        ? (parsed.githubSources.map(normalizeGitHubSource).filter(Boolean) as GitHubCsvSource[])
        : [],
    };
  } catch {
    return defaults;
  }
}

export function saveState(state: AppState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function saveStateJson(serializedState: string): void {
  localStorage.setItem(STORAGE_KEY, serializedState);
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

export function normalizeGitHubSource(source: Partial<GitHubCsvSource> | null | undefined): GitHubCsvSource | null {
  if (!source) return null;
  const owner = String(source.owner || '').trim();
  const repo = String(source.repo || '').trim();
  if (!owner || !repo) return null;
  return {
    id: source.id || generateId('github-source'),
    owner,
    repo,
    branch: String(source.branch || 'main').trim() || 'main',
    path: String(source.path || '').trim(),
    token: String(source.token || '').trim(),
    enabled: source.enabled !== false,
    lastSyncAt: Number(source.lastSyncAt || 0),
    lastStatus: source.lastStatus,
  };
}

function normalizeNullableOptionalNutrient(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const numberValue = Number(typeof value === 'string' ? value.replace(',', '.') : value);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : null;
}

function scaledNullableOptionalNutrient(value: unknown, amountG: number): number | null {
  const normalized = normalizeNullableOptionalNutrient(value);
  if (normalized === null) return null;
  return (normalized * Math.max(0, Number(amountG || 0))) / 100;
}

function normalizeOptionalNutrients(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, number> = {};
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = String(rawKey || '').trim();
    const numberValue = normalizeNullableOptionalNutrient(rawValue);
    if (!key || numberValue === null) continue;
    result[key] = numberValue;
  }
  return result;
}

function addScaledOptionalNutrients(target: Record<string, number>, source: unknown, amountG: number) {
  const scale = Math.max(0, Number(amountG || 0)) / 100;
  if (!scale) return;
  for (const [key, value] of Object.entries(normalizeOptionalNutrients(source))) {
    target[key] = (target[key] || 0) + value * scale;
  }
}

function scaleOptionalNutrients(source: Record<string, number>, ratio: number): Record<string, number> {
  const safeRatio = Number.isFinite(ratio) ? ratio : 0;
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, value * safeRatio]));
}

function normalizeNameI18n(value: unknown): LocalizedNameMap {
  if (!value || typeof value !== 'object') return {};
  const result: LocalizedNameMap = {};
  for (const [rawCode, rawName] of Object.entries(value as Record<string, unknown>)) {
    const code = String(rawCode || '')
      .trim()
      .toLowerCase();
    const name = String(rawName ?? '').trim();
    if (!code || !name) continue;
    result[code] = name;
  }
  return result;
}

function normalizeCatalogSourceKind(value: unknown, sourceId?: string | null): CatalogSourceKind {
  const kind = String(value || '')
    .trim()
    .toLowerCase();
  if (kind === 'desktop' || kind === 'github' || kind === 'custom' || kind === 'qr') return kind;
  const source = String(sourceId || '').trim();
  if (source.startsWith('github:')) return 'github';
  if (source.startsWith('mobile')) return 'custom';
  return source ? 'desktop' : 'custom';
}

function sourceLabelFromId(sourceId?: string | null): string | null {
  const source = String(sourceId || '').trim();
  if (!source) return null;
  if (source.startsWith('github:')) return source.slice('github:'.length) || source;
  return source;
}

function normalizeCatalogMetadata<
  T extends {
    source_id?: string | null;
    catalog_source_kind?: CatalogSourceKind | null;
    source_label?: string | null;
    source_url?: string | null;
    source_checked_at?: number | null;
    locked?: boolean | null;
    inactive?: boolean | null;
  },
>(item: T): T {
  const sourceKind = normalizeCatalogSourceKind(item.catalog_source_kind, item.source_id);
  const sourceLabel = String(item.source_label ?? '').trim() || sourceLabelFromId(item.source_id);
  const sourceUrl = String(item.source_url ?? '').trim();
  const checkedAt = Number(item.source_checked_at || 0);
  return {
    ...item,
    catalog_source_kind: sourceKind,
    source_label: sourceLabel,
    source_url: sourceUrl || null,
    source_checked_at: checkedAt > 0 ? checkedAt : null,
    locked: item.locked === true ? true : item.locked === false ? false : null,
    inactive: item.inactive === true,
  };
}

export function normalizeFood(food: Food): Food {
  return normalizeCatalogMetadata({
    ...food,
    name_i18n: normalizeNameI18n(food.name_i18n),
    brand: food.brand ?? null,
    catalog_kind: 'food',
    note: food.note ?? null,
    default_unit: food.default_unit || 'g',
    serving_size_g: food.serving_size_g ?? null,
    sugars_per_100g: normalizeNullableOptionalNutrient(food.sugars_per_100g),
    fiber_per_100g: normalizeNullableOptionalNutrient(food.fiber_per_100g),
    salt_per_100g: normalizeNullableOptionalNutrient(food.salt_per_100g),
    optional_nutrients: normalizeOptionalNutrients(food.optional_nutrients),
    barcode: food.barcode ?? null,
  });
}

export function normalizeIngredient(ingredient: Ingredient): Ingredient {
  return normalizeCatalogMetadata({
    ...ingredient,
    name_i18n: normalizeNameI18n(ingredient.name_i18n),
    note: ingredient.note ?? null,
    default_unit: ingredient.default_unit || 'g',
    serving_size_g: ingredient.serving_size_g ?? null,
    sugars_per_100g: normalizeNullableOptionalNutrient(ingredient.sugars_per_100g),
    fiber_per_100g: normalizeNullableOptionalNutrient(ingredient.fiber_per_100g),
    salt_per_100g: normalizeNullableOptionalNutrient(ingredient.salt_per_100g),
    optional_nutrients: normalizeOptionalNutrients(ingredient.optional_nutrients),
  });
}

export function normalizeRecipe(recipe: Recipe): Recipe {
  return normalizeCatalogMetadata({
    ...recipe,
    name_i18n: normalizeNameI18n(recipe.name_i18n),
    description: recipe.description ?? null,
    note: recipe.note ?? null,
    extra_kcal: recipe.extra_kcal ?? 0,
    total_weight_g: null,
    servings_count: recipe.servings_count ?? null,
  });
}

export function normalizeActivity(activity: ActivityDefinition): ActivityDefinition {
  return normalizeCatalogMetadata({
    ...activity,
    source_id: activity.source_id ?? undefined,
    name_i18n: normalizeNameI18n(activity.name_i18n),
    description: activity.description ?? null,
    activity_type: activity.activity_type || activity.type || 'custom',
    type: activity.type || activity.activity_type || 'custom',
  });
}

export function ingredientAsFood(ingredient: Ingredient): Food {
  return normalizeCatalogMetadata({
    id: `ingredient:${ingredient.id}`,
    source_id: ingredient.source_id,
    name: ingredient.name,
    name_i18n: normalizeNameI18n(ingredient.name_i18n),
    brand: 'Ingredient',
    catalog_kind: 'ingredient',
    note: ingredient.note ?? null,
    default_unit: ingredient.default_unit || 'g',
    serving_size_g: ingredient.serving_size_g ?? null,
    kcal_per_100g: ingredient.kcal_per_100g,
    carbs_per_100g: ingredient.carbs_per_100g,
    fat_per_100g: ingredient.fat_per_100g,
    protein_per_100g: ingredient.protein_per_100g,
    sugars_per_100g: normalizeNullableOptionalNutrient(ingredient.sugars_per_100g),
    fiber_per_100g: normalizeNullableOptionalNutrient(ingredient.fiber_per_100g),
    salt_per_100g: normalizeNullableOptionalNutrient(ingredient.salt_per_100g),
    optional_nutrients: normalizeOptionalNutrients(ingredient.optional_nutrients),
    barcode: null,
    updated_at: ingredient.updated_at,
    deleted_at: ingredient.deleted_at,
    pending_sync: ingredient.pending_sync,
    catalog_source_kind: ingredient.catalog_source_kind,
    source_label: ingredient.source_label,
    source_url: ingredient.source_url,
    source_checked_at: ingredient.source_checked_at,
    locked: ingredient.locked,
    inactive: ingredient.inactive,
  });
}

function foodToIngredient(food: Food): Ingredient {
  return normalizeIngredient({
    id: food.id,
    source_id: food.source_id,
    name: food.name,
    name_i18n: normalizeNameI18n(food.name_i18n),
    note: food.note ?? null,
    default_unit: food.default_unit || 'g',
    serving_size_g: food.serving_size_g ?? null,
    kcal_per_100g: food.kcal_per_100g,
    carbs_per_100g: food.carbs_per_100g,
    fat_per_100g: food.fat_per_100g,
    protein_per_100g: food.protein_per_100g,
    sugars_per_100g: normalizeNullableOptionalNutrient(food.sugars_per_100g),
    fiber_per_100g: normalizeNullableOptionalNutrient(food.fiber_per_100g),
    salt_per_100g: normalizeNullableOptionalNutrient(food.salt_per_100g),
    optional_nutrients: normalizeOptionalNutrients(food.optional_nutrients),
    updated_at: food.updated_at,
    deleted_at: food.deleted_at,
    pending_sync: food.pending_sync,
    catalog_source_kind: food.catalog_source_kind,
    source_label: food.source_label,
    source_url: food.source_url,
    source_checked_at: food.source_checked_at,
    locked: food.locked,
    inactive: food.inactive,
  });
}

export function foodSnapshot(item: Food | RecipeFood): string {
  return JSON.stringify(item);
}

export interface RecipeFood extends Food {
  recipe_id: string;
}

function recipeAsFoodInternal(
  recipe: Recipe,
  items: RecipeItem[],
  foods: Food[],
  ingredients: Ingredient[],
  recipes: Recipe[],
  allItems: RecipeItem[],
  visited: Set<string>,
): RecipeFood {
  if (visited.has(recipe.id)) {
    return {
      id: `recipe:${recipe.id}`,
      recipe_id: recipe.id,
      source_id: recipe.source_id,
      name: recipe.name,
      name_i18n: normalizeNameI18n(recipe.name_i18n),
      brand: 'Recipe',
      catalog_kind: 'food',
      note: recipe.note ?? recipe.description ?? null,
      default_unit: 'g',
      serving_size_g: null,
      kcal_per_100g: 0,
      carbs_per_100g: 0,
      fat_per_100g: 0,
      protein_per_100g: 0,
      sugars_per_100g: null,
      fiber_per_100g: null,
      salt_per_100g: null,
      optional_nutrients: {},
      updated_at: recipe.updated_at,
      deleted_at: recipe.deleted_at,
      catalog_source_kind: recipe.catalog_source_kind,
      source_label: recipe.source_label,
      source_url: recipe.source_url,
      source_checked_at: recipe.source_checked_at,
      locked: recipe.locked,
      inactive: recipe.inactive,
    };
  }

  visited.add(recipe.id);
  const ingredientWeight = items.reduce((sum, item) => sum + Math.max(0, item.amount_g), 0);
  const totalWeight = ingredientWeight;
  let kcal = Number(recipe.extra_kcal || 0);
  let carbs = 0;
  let fat = 0;
  let protein = 0;
  let sugars = 0;
  let fiber = 0;
  let salt = 0;
  let hasSugars = false;
  let hasFiber = false;
  let hasSalt = false;
  const optionalNutrients: Record<string, number> = {};

  for (const item of items) {
    const recipeRef = item.food_id.startsWith('recipe:') ? item.food_id.slice('recipe:'.length) : '';
    const food = recipeRef
      ? (() => {
          const referenced = recipes.find((entry) => entry.id === recipeRef && !entry.deleted_at);
          if (!referenced) return undefined;
          return recipeAsFoodInternal(
            referenced,
            allItems.filter((entry) => entry.recipe_id === referenced.id && !entry.deleted_at),
            foods,
            ingredients,
            recipes,
            allItems,
            visited,
          );
        })()
      : item.food_id.startsWith('ingredient:')
        ? (() => {
            const ingredient = ingredients.find(
              (entry) => entry.id === item.food_id.slice('ingredient:'.length) && !entry.deleted_at,
            );
            return ingredient ? ingredientAsFood(ingredient) : undefined;
          })()
        : foods.find((entry) => entry.id === item.food_id && !entry.deleted_at);
    if (!food) continue;
    kcal += (food.kcal_per_100g * item.amount_g) / 100;
    carbs += (food.carbs_per_100g * item.amount_g) / 100;
    fat += (food.fat_per_100g * item.amount_g) / 100;
    protein += (food.protein_per_100g * item.amount_g) / 100;
    const sugarContribution = scaledNullableOptionalNutrient(food.sugars_per_100g, item.amount_g);
    if (sugarContribution !== null) {
      sugars += sugarContribution;
      hasSugars = true;
    }
    const fiberContribution = scaledNullableOptionalNutrient(food.fiber_per_100g, item.amount_g);
    if (fiberContribution !== null) {
      fiber += fiberContribution;
      hasFiber = true;
    }
    const saltContribution = scaledNullableOptionalNutrient(food.salt_per_100g, item.amount_g);
    if (saltContribution !== null) {
      salt += saltContribution;
      hasSalt = true;
    }
    addScaledOptionalNutrients(optionalNutrients, food.optional_nutrients, item.amount_g);
  }

  visited.delete(recipe.id);
  const ratio = totalWeight > 0 ? 100 / totalWeight : 0;
  const serving =
    recipe.servings_count && recipe.servings_count > 0 && totalWeight > 0 ? totalWeight / recipe.servings_count : null;

  return {
    id: `recipe:${recipe.id}`,
    recipe_id: recipe.id,
    source_id: recipe.source_id,
    name: recipe.name,
    name_i18n: normalizeNameI18n(recipe.name_i18n),
    brand: 'Recipe',
    catalog_kind: 'food',
    note: recipe.note ?? recipe.description ?? null,
    default_unit: serving ? 'serving' : 'g',
    serving_size_g: serving,
    kcal_per_100g: kcal * ratio,
    carbs_per_100g: carbs * ratio,
    fat_per_100g: fat * ratio,
    protein_per_100g: protein * ratio,
    sugars_per_100g: hasSugars && ratio > 0 ? sugars * ratio : null,
    fiber_per_100g: hasFiber && ratio > 0 ? fiber * ratio : null,
    salt_per_100g: hasSalt && ratio > 0 ? salt * ratio : null,
    optional_nutrients: scaleOptionalNutrients(optionalNutrients, ratio),
    updated_at: recipe.updated_at,
    deleted_at: recipe.deleted_at,
    catalog_source_kind: recipe.catalog_source_kind,
    source_label: recipe.source_label,
    source_url: recipe.source_url,
    source_checked_at: recipe.source_checked_at,
    locked: recipe.locked,
    inactive: recipe.inactive,
  };
}

export function recipeAsFood(
  recipe: Recipe,
  items: RecipeItem[],
  foods: Food[],
  ingredients: Ingredient[] = [],
  recipes: Recipe[] = [],
  allItems: RecipeItem[] = items,
): RecipeFood {
  return recipeAsFoodInternal(
    recipe,
    items,
    foods.map(normalizeFood),
    ingredients.map(normalizeIngredient),
    recipes,
    allItems,
    new Set<string>(),
  );
}

function aliasKey(kind: CatalogKind, id: string): string {
  return `${kind}:${id}`;
}

export function mergeAliases(current: CatalogAlias[] = [], incoming: CatalogAlias[] = []): CatalogAlias[] {
  const map = new Map<string, CatalogAlias>();
  for (const alias of current) map.set(aliasKey(alias.kind, alias.alias_id), alias);
  for (const alias of incoming) {
    if (!alias.alias_id || !alias.canonical_id || alias.alias_id === alias.canonical_id) continue;
    map.set(aliasKey(alias.kind, alias.alias_id), alias);
  }
  return [...map.values()].sort((a, b) => `${a.kind}:${a.alias_id}`.localeCompare(`${b.kind}:${b.alias_id}`));
}

export function resolveCatalogId(state: AppState, kind: CatalogKind, id: string): string {
  const clean =
    kind === 'recipe' && id.startsWith('recipe:')
      ? id.slice('recipe:'.length)
      : kind === 'ingredient' && id.startsWith('ingredient:')
        ? id.slice('ingredient:'.length)
        : id;
  let current = clean;
  const visited = new Set<string>();
  for (let i = 0; i < 12; i += 1) {
    const key = aliasKey(kind, current);
    if (visited.has(key)) break;
    visited.add(key);
    const alias = state.catalogAliases.find((entry) => entry.kind === kind && entry.alias_id === current);
    if (!alias || !alias.canonical_id || alias.canonical_id === current) break;
    current = alias.canonical_id;
  }
  return current;
}

export function canonicalizeStateReferences(state: AppState): AppState {
  const canonicalRecipe = (id: string) => resolveCatalogId(state, 'recipe', id);
  const canonicalFood = (id: string) => resolveCatalogId(state, 'food', id);
  const canonicalIngredient = (id: string) => resolveCatalogId(state, 'ingredient', id);
  const canonicalActivity = (id?: string | null) => (id ? resolveCatalogId(state, 'activity', id) : id);

  return {
    ...state,
    recipeItems: state.recipeItems.map((item) => {
      const foodId = item.food_id.startsWith('recipe:')
        ? `recipe:${canonicalRecipe(item.food_id.slice('recipe:'.length))}`
        : item.food_id.startsWith('ingredient:')
          ? `ingredient:${canonicalIngredient(item.food_id.slice('ingredient:'.length))}`
          : canonicalFood(item.food_id);
      return {
        ...item,
        recipe_id: canonicalRecipe(item.recipe_id),
        food_id: foodId,
      };
    }),
    intakes: state.intakes.map((intake) => {
      if (intake.item_type === 'note') return { ...intake, pending_sync: false };
      const kind: CatalogKind =
        intake.item_type === 'recipe' ? 'recipe' : intake.item_type === 'ingredient' ? 'ingredient' : 'food';
      const canonical = resolveCatalogId(state, kind, intake.food_id);
      const normalized =
        kind === 'recipe' ? `recipe:${canonical}` : kind === 'ingredient' ? `ingredient:${canonical}` : canonical;
      return normalized === intake.food_id
        ? { ...intake, pending_sync: false }
        : { ...intake, food_id: normalized, pending_sync: false, updated_at: Date.now() };
    }),
    activityLogs: state.activityLogs.map((log) => {
      const canonical = canonicalActivity(log.activity_id);
      return canonical === log.activity_id
        ? { ...log, pending_sync: false }
        : { ...log, activity_id: canonical, pending_sync: false, updated_at: Date.now() };
    }),
  };
}

export function catalogItems(state: AppState): Array<Food | RecipeFood> {
  const recipeFoods = state.recipes.map((recipe) =>
    recipeAsFood(
      recipe,
      state.recipeItems.filter((item) => item.recipe_id === recipe.id && !item.deleted_at),
      state.foods,
      state.ingredients,
      state.recipes,
      state.recipeItems,
    ),
  );
  return [...state.ingredients.map(ingredientAsFood), ...state.foods.map(normalizeFood), ...recipeFoods].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function findCatalogItem(state: AppState, id: string): Food | RecipeFood | undefined {
  const rawRecipeId = id.startsWith('recipe:') ? id.slice('recipe:'.length) : id;
  const recipeId = resolveCatalogId(state, 'recipe', rawRecipeId);
  const ingredientId = resolveCatalogId(
    state,
    'ingredient',
    id.startsWith('ingredient:') ? id.slice('ingredient:'.length) : id,
  );
  const foodId = resolveCatalogId(state, 'food', id);
  return catalogItems(state).find(
    (item) =>
      item.id === id ||
      item.id === foodId ||
      item.id === `ingredient:${ingredientId}` ||
      item.id === `recipe:${recipeId}` ||
      item.id === `recipe:${rawRecipeId}`,
  );
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
  const beforeBirthday =
    today.getMonth() < date.getMonth() || (today.getMonth() === date.getMonth() && today.getDate() < date.getDate());
  if (beforeBirthday) age -= 1;
  return Math.max(13, age);
}

export function palValue(level: ActivityLevel): number {
  switch (level) {
    case 'sedentary':
      return 1.25;
    case 'low_active':
      return 1.5;
    case 'active':
      return 1.75;
    case 'very_active':
      return 2.2;
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
