export type NutrinoSource = {
  id: string;
  name: string;
  baseUrl?: string;
};

export type NutrinoFood = {
  id: string;
  source_id?: string;
  name: string;
  brand?: string;
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
  description?: string;
  note?: string | null;
  servings_count: number;
  ingredients: NutrinoRecipeIngredient[];
};

export type NutrinoActivity = {
  id: string;
  name: string;
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
