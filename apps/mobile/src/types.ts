export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type Gender = 'female' | 'male' | 'non_binary';
export type ActivityLevel = 'sedentary' | 'low_active' | 'active' | 'very_active';
export type AppLanguage = 'system' | 'en' | 'hu';
export type ThemeMode = 'system' | 'light' | 'dark';
export type AppChannel = 'dev' | 'stable';
export type CatalogKind = 'ingredient' | 'food' | 'recipe' | 'activity';
export type FoodCatalogKind = 'food' | 'ingredient';

export interface Ingredient {
  id: string;
  source_id: string;
  name: string;
  note?: string | null;
  default_unit: string;
  serving_size_g?: number | null;
  kcal_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  protein_per_100g: number;
  sugars_per_100g?: number | null;
  fiber_per_100g?: number | null;
  salt_per_100g?: number | null;
  updated_at: number;
  deleted_at?: number | null;
  pending_sync?: boolean;
}

export interface CatalogAlias {
  kind: CatalogKind;
  alias_id: string;
  canonical_id: string;
  source_id?: string;
  updated_at: number;
}

export interface GitHubCsvSource {
  id: string;
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
  token?: string;
  enabled: boolean;
  lastSyncAt?: number;
  lastStatus?: string;
}

export interface PairingConfig {
  baseUrl: string;
  token: string;
  password?: string;
  channel?: AppChannel;
  sourceId: string;
  lastSyncAt: number;
  lastSyncError?: string;
  catalogRevision?: number;
  lastHealthCheckAt?: number;
}

export interface UserProfile {
  height_cm: number;
  current_weight_kg: number;
  birthday: string;
  gender: Gender;
  activity_level: ActivityLevel;
  weekly_goal_kg: number;
  plan_start_weight_kg: number;
  last_weight_prompt_at?: number;
}

export interface Food {
  id: string;
  source_id: string;
  name: string;
  brand?: string | null;
  catalog_kind?: FoodCatalogKind;
  note?: string | null;
  default_unit: string;
  serving_size_g?: number | null;
  kcal_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  protein_per_100g: number;
  sugars_per_100g?: number | null;
  fiber_per_100g?: number | null;
  salt_per_100g?: number | null;
  barcode?: string | null;
  updated_at: number;
  deleted_at?: number | null;
  pending_sync?: boolean;
}

export interface Recipe {
  id: string;
  source_id: string;
  name: string;
  description?: string | null;
  note?: string | null;
  total_weight_g?: number | null;
  servings_count?: number | null;
  updated_at: number;
  deleted_at?: number | null;
  pending_sync?: boolean;
}

export interface RecipeItem {
  id: string;
  recipe_id: string;
  food_id: string;
  amount_g: number;
  updated_at: number;
  deleted_at?: number | null;
  pending_sync?: boolean;
}

export interface ActivityDefinition {
  id: string;
  source_id?: string;
  code: string;
  name: string;
  description?: string | null;
  type?: string;
  activity_type?: string;
  met: number;
  kcal_per_min: number;
  updated_at: number;
  deleted_at?: number | null;
  pending_sync?: boolean;
}

export interface Intake {
  id: string;
  source_id: string;
  item_type: 'ingredient' | 'food' | 'recipe' | 'note';
  food_id: string;
  consumed_at: number;
  meal_type: MealType;
  amount_g: number;
  unit: 'g' | 'serving';
  serving_qty?: number | null;
  food_snapshot_json: string;
  note_title?: string | null;
  note_description?: string | null;
  pending_sync: boolean;
  created_at: number;
  updated_at: number;
}

export interface ActivityLog {
  id: string;
  activity_id?: string | null;
  activity_name: string;
  performed_at: number;
  duration_min: number;
  kcal: number;
  source: 'activity_catalog' | 'watch' | 'manual';
  pending_sync: boolean;
  created_at: number;
  updated_at: number;
}

export interface WeightLog {
  id: string;
  measured_at: number;
  weight_kg: number;
  bmi: number;
  source: 'mobile_prompt' | 'manual';
  pending_sync: boolean;
  created_at: number;
  updated_at: number;
}

export interface ServerHealth {
  ok: boolean;
  name?: string;
  version?: string;
  auth_required?: boolean;
  app_channel?: AppChannel;
  dev_mode?: boolean;
  catalog_revision?: number;
}

export interface SyncPullResponse {
  server_time: number;
  source_id: string;
  foods: Food[];
  ingredients?: Ingredient[];
  recipes?: Recipe[];
  recipe_items?: RecipeItem[];
  activities?: ActivityDefinition[];
  aliases?: CatalogAlias[];
}

export interface SyncPushRequest {
  source_id?: string;
  device_name?: string;
  sent_at?: number;
  foods?: Food[];
  ingredients?: Ingredient[];
  recipes?: Recipe[];
  recipe_items?: RecipeItem[];
  activities?: ActivityDefinition[];
  intakes: Array<{
    id: string;
    item_type: string;
    food_id: string;
    source_id: string;
    consumed_at: number;
    meal_type: string;
    amount_g: number;
    food_snapshot_json: string;
    note_title?: string | null;
    note_description?: string | null;
  }>;
  weight_logs: Array<{
    id: string;
    measured_at: number;
    weight_kg: number;
    bmi: number;
    source: string;
  }>;
  activity_logs: Array<{
    id: string;
    activity_id?: string | null;
    activity_name: string;
    performed_at: number;
    duration_min: number;
    kcal: number;
    source: string;
  }>;
}

export interface SyncPushResponse {
  accepted: boolean;
  server_time: number;
}

export interface AppSettings {
  language: AppLanguage;
  theme: ThemeMode;
  units: 'metric' | 'imperial';
  show_activity_tracking: boolean;
  show_meal_macros: boolean;
  show_micronutrients: boolean;
  daily_reminder: boolean;
  kcal_adjustment: number;
  macro_carbs_percent: number;
  macro_protein_percent: number;
  macro_fat_percent: number;
  tdee_equation: 'iom_2005';
}

export interface AppState {
  settings: AppSettings;
  pairing: PairingConfig;
  profile: UserProfile;
  foods: Food[];
  ingredients: Ingredient[];
  recipes: Recipe[];
  recipeItems: RecipeItem[];
  activities: ActivityDefinition[];
  intakes: Intake[];
  activityLogs: ActivityLog[];
  weightLogs: WeightLog[];
  catalogAliases: CatalogAlias[];
  githubSources: GitHubCsvSource[];
}

export interface SyncResult {
  ok: boolean;
  message: string;
  pulledFoods: number;
  pulledRecipes: number;
  pulledActivities: number;
  pushedIntakes: number;
  pushedWeightLogs: number;
  pushedActivityLogs: number;
}
