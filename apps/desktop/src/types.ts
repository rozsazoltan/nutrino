export type LocalizedNameMap = Record<string, string>;

export interface ServerStatus {
  running: boolean;
  bind_address: string | null;
  port: number | null;
  base_url: string | null;
  token: string;
  password_set: boolean;
  app_channel: 'dev' | 'stable';
  source_id: string;
  auth_required: boolean;
  dev_mode: boolean;
  catalog_revision: number;
  connected_devices: number;
}

export interface ConnectedDevice {
  id: string;
  display_name: string;
  device_name?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  platform?: string | null;
  os_version?: string | null;
  app_channel?: string | null;
  app_version?: string | null;
  ip_address: string;
  user_agent?: string | null;
  first_seen: number;
  last_seen: number;
  request_count: number;
  last_path: string;
}

export interface Food {
  id: string;
  source_id: string;
  name: string;
  name_i18n?: LocalizedNameMap | null;
  brand?: string | null;
  note?: string | null;
  barcode?: string | null;
  default_unit: string;
  serving_size_g?: number | null;
  kcal_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  protein_per_100g: number;
  sugars_per_100g: number;
  fiber_per_100g: number;
  salt_per_100g: number;
  updated_at: number;
  deleted_at?: number | null;
}

export interface Ingredient {
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
  sugars_per_100g: number;
  fiber_per_100g: number;
  salt_per_100g: number;
  updated_at: number;
  deleted_at?: number | null;
}

export interface FoodInput {
  id?: string | null;
  name: string;
  name_i18n?: LocalizedNameMap | null;
  brand?: string | null;
  note?: string | null;
  barcode?: string | null;
  default_unit?: string | null;
  serving_size_g?: number | null;
  kcal_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  protein_per_100g: number;
  sugars_per_100g?: number | null;
  fiber_per_100g?: number | null;
  salt_per_100g?: number | null;
}

export interface IngredientInput {
  id?: string | null;
  name: string;
  name_i18n?: LocalizedNameMap | null;
  note?: string | null;
  default_unit?: string | null;
  serving_size_g?: number | null;
  kcal_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  protein_per_100g: number;
  sugars_per_100g?: number | null;
  fiber_per_100g?: number | null;
  salt_per_100g?: number | null;
}

export interface ImportPreviewRow {
  row_number: number;
  food: Food | null;
  ingredient?: Ingredient | null;
  errors: string[];
}

export interface ImportPreview {
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  rows: ImportPreviewRow[];
}

export interface ImportCommitResult {
  inserted_or_updated: number;
  skipped: number;
  errors: string[];
}

export interface Recipe {
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
}

export interface RecipeInputItem {
  food_id: string;
  amount_g: number;
}

export interface RecipeInput {
  id?: string | null;
  name: string;
  name_i18n?: LocalizedNameMap | null;
  description?: string | null;
  note?: string | null;
  total_weight_g?: number | null;
  extra_kcal?: number | null;
  servings_count?: number | null;
  items: RecipeInputItem[];
}

export interface RecipeItemDetail {
  id: string;
  recipe_id: string;
  food_id: string;
  food_name: string;
  amount_g: number;
  kcal: number;
  carbs: number;
  fat: number;
  protein: number;
  deleted_at?: number | null;
}

export interface RecipeNutrition {
  total_weight_g: number;
  kcal_total: number;
  kcal_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  protein_per_100g: number;
}

export interface RecipeDetail {
  recipe: Recipe;
  items: RecipeItemDetail[];
  nutrition: RecipeNutrition;
}

export interface ActivityDefinition {
  id: string;
  code: string;
  name: string;
  name_i18n?: LocalizedNameMap | null;
  description?: string | null;
  activity_type: string;
  met: number;
  kcal_per_min: number;
  updated_at: number;
  deleted_at?: number | null;
}

export interface ActivityInput {
  id?: string | null;
  code?: string | null;
  name: string;
  name_i18n?: LocalizedNameMap | null;
  description?: string | null;
  activity_type?: string | null;
  met: number;
  kcal_per_min: number;
}


export interface SyncInboxSummary {
  foods: number;
  ingredients: number;
  recipes: number;
  recipe_items: number;
  activities: number;
  intakes: number;
  weight_logs: number;
  activity_logs: number;
}

export interface MergeCandidate {
  kind: 'ingredient' | 'food' | 'recipe' | 'activity' | string;
  incoming_id: string;
  incoming_name: string;
  canonical_id: string;
  canonical_name: string;
}

export interface ReplacementCandidate {
  kind: 'ingredient' | 'food' | 'recipe' | 'activity' | string;
  id: string;
  incoming_name: string;
  existing_name: string;
  incoming_updated_at: number;
  existing_updated_at: number;
}

export interface CatalogDuplicateItem {
  id: string;
  name: string;
  subtitle: string;
  updated_at: number;
}

export interface CatalogDuplicateSuggestion {
  kind: 'ingredient' | 'food' | 'recipe' | 'activity' | string;
  reason: string;
  confidence: string;
  score: number;
  key: string;
  items: CatalogDuplicateItem[];
}


export interface SkippedSyncItem {
  kind: string;
  id: string;
  label: string;
  skipped_at: number;
  item: unknown;
}

export interface SyncPushPayload {
  source_id?: string | null;
  device_name?: string | null;
  sent_at?: number | null;
  foods?: Food[] | null;
  ingredients?: Ingredient[] | null;
  recipes?: Recipe[] | null;
  recipe_items?: Array<{ id: string; recipe_id: string; food_id: string; amount_g: number; updated_at?: number; deleted_at?: number | null }> | null;
  activities?: ActivityDefinition[] | null;
  intakes: Array<{ id: string; item_type?: string | null; food_id: string; source_id: string; consumed_at: number; meal_type: string; amount_g: number; food_snapshot_json: string; note_title?: string | null; note_description?: string | null }>;
  weight_logs: Array<{ id: string; measured_at: number; weight_kg: number; bmi?: number | null; source: string }>;
  activity_logs: Array<{ id: string; activity_id?: string | null; activity_name: string; performed_at: number; duration_min: number; kcal: number; source: string }>;
  skipped_items?: SkippedSyncItem[];
}

export interface SyncInboxEntry {
  id: string;
  source_id: string;
  device_name?: string | null;
  received_at: number;
  status: string;
  summary: SyncInboxSummary;
  merge_candidates: MergeCandidate[];
  replacement_candidates: ReplacementCandidate[];
  payload: SyncPushPayload;
}

export interface SyncInboxCommitResult {
  accepted: boolean;
  merged: number;
  inserted_or_updated: number;
  intakes: number;
  weight_logs: number;
  activity_logs: number;
}

export interface ServerPasswordUpdate {
  password: string;
}

export interface DesktopSettings {
  remember_window_state: boolean;
  launch_at_startup: boolean;
  run_in_background: boolean;
  auto_start_server: boolean;
  close_to_tray: boolean;
  start_hidden_to_tray: boolean;
  window_x?: number | null;
  window_y?: number | null;
  window_width?: number | null;
  window_height?: number | null;
}
