export type LocalizedNameMap = Record<string, string>;
export type OptionalNutrientMap = Record<string, number | null | undefined>;

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type Gender = 'female' | 'male' | 'non_binary';
export type ActivityLevel = 'sedentary' | 'low_active' | 'active' | 'very_active';
export type AppLanguage = 'system' | 'en' | 'hu' | 'de' | 'fr' | 'ru' | 'uk' | 'zh' | 'sk' | 'ro' | 'cs' | 'sl' | 'hr' | 'pl' | 'es' | 'pt';
export type FoodPreparationMethod = 'none' | 'boiled' | 'air_fryer' | 'pan_light_oil' | 'pan_oil' | 'deep_fried' | 'custom_oil';
export type ThemeMode = 'system' | 'light' | 'dark';
export type AppChannel = 'dev' | 'stable';
export type CatalogKind = 'ingredient' | 'food' | 'recipe' | 'activity';
export type FoodCatalogKind = 'food' | 'ingredient';
export type CatalogSourceKind = 'desktop' | 'github' | 'custom' | 'qr';
export type ProfilePurpose = 'weight_loss' | 'weight_gain' | 'healthy_eating' | 'meal_logging' | 'health_issue_logging';
export type HealthCategoryType = 'pain' | 'digestive' | 'stool' | 'skin' | 'respiratory' | 'sleep' | 'mood' | 'injury' | 'energy' | 'other';
export type HealthAttachmentType = 'photo' | 'video';

export interface CatalogItemMetadata {
  catalog_source_kind?: CatalogSourceKind | null;
  source_label?: string | null;
  source_url?: string | null;
  source_checked_at?: number | null;
  locked?: boolean | null;
  inactive?: boolean | null;
}

export interface Ingredient extends CatalogItemMetadata {
  id: string;
  source_id: string;
  name: string;
  name_i18n?: LocalizedNameMap | null;
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
  optional_nutrients?: OptionalNutrientMap | null;
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
  acceptedNewerServerVersion?: string;
  declinedNewerServerVersion?: string;
}


export interface UserProfile {
  id: string;
  height_cm: number;
  current_weight_kg: number;
  birthday: string;
  gender: Gender;
  activity_level: ActivityLevel;
  weekly_goal_kg: number;
  plan_start_weight_kg: number;
  usage_purposes: ProfilePurpose[];
  last_weight_prompt_at?: number;
}

export interface HealthAttachment {
  id: string;
  type: HealthAttachmentType;
  name: string;
  display_name?: string | null;
  mime_type: string;
  size: number;
  data_url: string;
  preview_data_url?: string | null;
  backup_path?: string | null;
  fingerprint?: string | null;
  created_at: number;
}

export interface HealthEntry {
  id: string;
  profile_id: string;
  event_id: string;
  recurrence_of_id?: string | null;
  title: string;
  description: string;
  occurred_at: number;
  category: HealthCategoryType;
  notes?: string | null;
  attachments: HealthAttachment[];
  ongoing?: boolean;
  resolved_at?: number | null;
  last_reviewed_at?: number | null;
  review_dismissed_at?: number | null;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
}

export interface Food extends CatalogItemMetadata {
  id: string;
  source_id: string;
  name: string;
  name_i18n?: LocalizedNameMap | null;
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
  optional_nutrients?: OptionalNutrientMap | null;
  barcode?: string | null;
  updated_at: number;
  deleted_at?: number | null;
  pending_sync?: boolean;
}

export interface Recipe extends CatalogItemMetadata {
  id: string;
  source_id: string;
  name: string;
  name_i18n?: LocalizedNameMap | null;
  description?: string | null;
  note?: string | null;
  total_weight_g?: number | null;
  extra_kcal?: number | null;
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

export interface ActivityDefinition extends CatalogItemMetadata {
  id: string;
  source_id?: string;
  code: string;
  name: string;
  name_i18n?: LocalizedNameMap | null;
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
  note_final?: boolean;
  preparation_method?: FoodPreparationMethod | null;
  preparation_oil_ml?: number | null;
  preparation_kcal?: number | null;
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


export type FluidAlcoholKind = 'beer' | 'wine' | 'spirits' | 'cocktail' | 'other';

export interface FluidLog {
  id: string;
  consumed_at: number;
  amount_dl: number;
  is_alcohol: boolean;
  alcohol_kind?: FluidAlcoholKind | null;
  kcal?: number | null;
  note?: string | null;
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


export type MobileHandoffKind = 'backup_export' | 'ai_export' | 'backup_import' | string;
export type MobileHandoffStatus = 'pending' | 'completed' | 'rejected' | 'used' | 'kept' | 'deleted' | 'error' | string;

export interface MobileHandoffRequest {
  id: string;
  device_id: string;
  device_name?: string | null;
  kind: MobileHandoffKind;
  status: MobileHandoffStatus;
  created_at: number;
  responded_at?: number | null;
  payload: {
    filename?: string;
    mime_type?: string;
    desktop_name?: string;
    backup_base64?: string;
    startKey?: string;
    endKey?: string;
    [key: string]: unknown;
  };
  result_filename?: string | null;
  result_mime_type?: string | null;
  result_base64?: string | null;
  result_saved_path?: string | null;
  message?: string | null;
}

export interface MobileHandoffResponseInput {
  status: 'completed' | 'rejected' | 'used' | 'kept' | 'deleted' | 'error';
  result_filename?: string | null;
  result_mime_type?: string | null;
  result_base64?: string | null;
  result_saved_path?: string | null;
  message?: string | null;
}

export interface MobileHandoffResultChunkInput {
  chunk_index: number;
  total_chunks: number;
  chunk_base64: string;
  total_size?: number | null;
  result_filename: string;
  result_mime_type?: string | null;
}

export interface MobileHandoffResultChunkAck {
  accepted: boolean;
  chunk_index: number;
  received_bytes: number;
  saved_path?: string | null;
  server_time: number;
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

export interface DesktopUpdateCheckResponse {
  accepted: boolean;
  server_version: string;
}

export interface AppSettings {
  language: AppLanguage;
  theme: ThemeMode;
  units: 'metric' | 'imperial';
  desktop_api_enabled: boolean;
  github_csv_enabled: boolean;
  desktop_sync_prompted: boolean;
  check_prerelease_updates: boolean;
  show_activity_tracking: boolean;
  show_meal_macros: boolean;
  show_micronutrients: boolean;
  health_diary_enabled: boolean;
  protect_external_catalog_items: boolean;
  include_inactive_catalog_items: boolean;
  micronutrient_limits: Record<string, number>;
  daily_reminder: boolean;
  daily_reminder_time: string;
  weekly_weight_average_enabled: boolean;
  daily_weight_reminder_enabled: boolean;
  daily_weight_reminder_time: string;
  meal_reminders_enabled: boolean;
  meal_reminder_morning_time: string;
  meal_reminder_noon_time: string;
  meal_reminder_afternoon_time: string;
  calorie_deficit_enabled: boolean;
  target_deficit_kcal: number;
  calorie_limit_warning_enabled: boolean;
  exercise_kcal_eatback_percent: number;
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
  fluidLogs: FluidLog[];
  weightLogs: WeightLog[];
  healthEntries: HealthEntry[];
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
