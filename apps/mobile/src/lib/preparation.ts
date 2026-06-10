import type { Food, FoodPreparationMethod, Intake } from '../types';

export type PreparationMethodConfig = {
  key: FoodPreparationMethod;
  labelKey: string;
  hintKey: string;
  defaultOilMl: number;
  kcalPer100g: number;
};

export const PREPARATION_METHODS: PreparationMethodConfig[] = [
  {
    key: 'none',
    labelKey: 'preparationNone',
    hintKey: 'preparationNoneHint',
    defaultOilMl: 0,
    kcalPer100g: 0,
  },
  {
    key: 'boiled',
    labelKey: 'preparationBoiled',
    hintKey: 'preparationBoiledHint',
    defaultOilMl: 0,
    kcalPer100g: 0,
  },
  {
    key: 'air_fryer',
    labelKey: 'preparationAirFryer',
    hintKey: 'preparationAirFryerHint',
    defaultOilMl: 3,
    kcalPer100g: 27,
  },
  {
    key: 'pan_light_oil',
    labelKey: 'preparationPanLightOil',
    hintKey: 'preparationPanLightOilHint',
    defaultOilMl: 5,
    kcalPer100g: 45,
  },
  {
    key: 'pan_oil',
    labelKey: 'preparationPanOil',
    hintKey: 'preparationPanOilHint',
    defaultOilMl: 10,
    kcalPer100g: 90,
  },
  {
    key: 'deep_fried',
    labelKey: 'preparationDeepFried',
    hintKey: 'preparationDeepFriedHint',
    defaultOilMl: 15,
    kcalPer100g: 135,
  },
  {
    key: 'custom_oil',
    labelKey: 'preparationCustomOil',
    hintKey: 'preparationCustomOilHint',
    defaultOilMl: 0,
    kcalPer100g: 0,
  },
];

const PREPARATION_FOOD_KEYWORDS = [
  'burgonya',
  'krumpli',
  'hasábburgonya',
  'édesburgonya',
  'rantott',
  'rántott',
  'fasírt',
  'hús',
  'csirke',
  'sertés',
  'sajt',
  'zöldség',
  'brokkoli',
  'cukkini',
  'karfiol',
  'gomba',
];

export function preparationMethodConfig(method: FoodPreparationMethod): PreparationMethodConfig {
  return PREPARATION_METHODS.find((item) => item.key === method) || PREPARATION_METHODS[0];
}

export function oilMlToKcal(oilMl: number): number {
  return Math.max(0, Math.round(Number(oilMl || 0) * 8.1));
}

export function estimatePreparationKcal(input: {
  method: FoodPreparationMethod;
  amountG: number;
  oilMl?: number | null;
}): number {
  const amountG = Number(input.amountG || 0);
  if (!Number.isFinite(amountG) || amountG <= 0 || input.method === 'none' || input.method === 'boiled') return 0;

  if (input.method === 'custom_oil') return oilMlToKcal(Number(input.oilMl || 0));

  const config = preparationMethodConfig(input.method);
  return Math.max(0, Math.round((amountG * config.kcalPer100g) / 100));
}

export function intakePreparationKcal(entry: Pick<Intake, 'preparation_kcal'>): number {
  return Math.max(0, Math.round(Number(entry.preparation_kcal || 0)));
}

export function foodSupportsPreparation(food?: Pick<Food, 'id' | 'name' | 'note'> | null): boolean {
  if (!food) return false;
  if (food.id.startsWith('recipe:')) return false;
  const haystack = `${food.name || ''} ${food.note || ''}`.toLowerCase();
  return PREPARATION_FOOD_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

export function hasPieceServing(food?: Pick<Food, 'name' | 'default_unit' | 'serving_size_g'> | null): boolean {
  const serving = Number(food?.serving_size_g || 0);
  if (!serving || !Number.isFinite(serving)) return false;

  const unit = String(food?.default_unit || '')
    .trim()
    .toLowerCase();
  if (['db', 'pc', 'pcs', 'piece', 'pieces', 'serving', 'adag'].includes(unit)) return true;

  const name = String(food?.name || '').toLowerCase();
  return /\b1\s*(db|darab|pc|piece)\b/.test(name) || /\(\s*1\s*(db|darab|pc|piece)\s*=/.test(name);
}
