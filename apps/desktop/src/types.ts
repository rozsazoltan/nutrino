export interface ServerStatus {
  running: boolean;
  bind_address: string | null;
  port: number | null;
  base_url: string | null;
  token: string;
  source_id: string;
  auth_required: boolean;
  dev_mode: boolean;
  catalog_revision: number;
}

export interface Food {
  id: string;
  source_id: string;
  name: string;
  brand?: string | null;
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
  brand?: string | null;
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
  description?: string | null;
  note?: string | null;
  total_weight_g?: number | null;
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
  description?: string | null;
  note?: string | null;
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
  description?: string | null;
  activity_type?: string | null;
  met: number;
  kcal_per_min: number;
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
