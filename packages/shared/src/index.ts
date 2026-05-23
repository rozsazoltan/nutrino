export type LocalizedNameMap = Record<string, string>;

export type NutrinoSource = {
  id: string;
  name: string;
  name_i18n?: LocalizedNameMap | null;
  baseUrl?: string;
};

export type NutrinoFood = {
  id: string;
  source_id?: string;
  name: string;
  name_i18n?: LocalizedNameMap | null;
  brand?: string;
  catalog_kind?: 'food' | 'ingredient';
  note?: string | null;
  serving_size_g?: number;
  kcal_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  protein_per_100g: number;
};

export type NutrinoRecipeIngredient = {
  food_id: string;
  amount_g: number;
};

export type NutrinoRecipe = {
  id: string;
  source_id?: string;
  name: string;
  name_i18n?: LocalizedNameMap | null;
  description?: string;
  note?: string | null;
  total_weight_g?: number | null;
  extra_kcal?: number | null;
  servings_count?: number | null;
  ingredients: NutrinoRecipeIngredient[];
};

export type NutrinoActivity = {
  id: string;
  name: string;
  name_i18n?: LocalizedNameMap | null;
  description?: string;
  kcal_per_min: number;
};

export type CatalogHealth = {
  name: string;
  version: string;
  dev_mode: boolean;
  auth_required: boolean;
  catalog_revision: number;
};
