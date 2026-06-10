import type { FluidAlcoholKind, FluidDrinkKind, FluidLog } from '../types';

export type FluidKcalPreset = {
  kind: FluidDrinkKind;
  kcalPerDl: number;
  waterRatio: number;
  labelKey: string;
  hintKey: string;
  isAlcohol?: boolean;
};

export type AlcoholKcalPreset = {
  kind: FluidAlcoholKind;
  kcal: number;
  labelKey: string;
  hintKey: string;
};

export const FLUID_QUICK_AMOUNTS_DL = [1, 2, 3] as const;

export const FLUID_KIND_PRESETS: FluidKcalPreset[] = [
  { kind: 'fluid', kcalPerDl: 0, waterRatio: 0.7, labelKey: 'fluidGeneric', hintKey: 'fluidGenericHint' },
  { kind: 'water', kcalPerDl: 0, waterRatio: 1, labelKey: 'fluidWater', hintKey: 'fluidWaterHint' },
  {
    kind: 'sparkling_water',
    kcalPerDl: 0,
    waterRatio: 1,
    labelKey: 'fluidSparklingWater',
    hintKey: 'fluidSparklingWaterHint',
  },
  { kind: 'tea', kcalPerDl: 0, waterRatio: 0.95, labelKey: 'fluidTea', hintKey: 'fluidTeaHint' },
  { kind: 'coffee', kcalPerDl: 2, waterRatio: 0.8, labelKey: 'fluidCoffee', hintKey: 'fluidCoffeeHint' },
  { kind: 'soft_drink', kcalPerDl: 42, waterRatio: 0.65, labelKey: 'fluidSoftDrink', hintKey: 'fluidSoftDrinkHint' },
  { kind: 'juice', kcalPerDl: 45, waterRatio: 0.75, labelKey: 'fluidJuice', hintKey: 'fluidJuiceHint' },
  { kind: 'milk', kcalPerDl: 60, waterRatio: 0.85, labelKey: 'fluidMilk', hintKey: 'fluidMilkHint' },
  {
    kind: 'sports_drink',
    kcalPerDl: 25,
    waterRatio: 0.85,
    labelKey: 'fluidSportsDrink',
    hintKey: 'fluidSportsDrinkHint',
  },
  {
    kind: 'beer',
    kcalPerDl: 45,
    waterRatio: 0.45,
    labelKey: 'alcoholBeer',
    hintKey: 'alcoholBeerHint',
    isAlcohol: true,
  },
  {
    kind: 'wine',
    kcalPerDl: 85,
    waterRatio: 0.35,
    labelKey: 'alcoholWine',
    hintKey: 'alcoholWineHint',
    isAlcohol: true,
  },
  {
    kind: 'spirits',
    kcalPerDl: 230,
    waterRatio: 0.1,
    labelKey: 'alcoholSpirits',
    hintKey: 'alcoholSpiritsHint',
    isAlcohol: true,
  },
  {
    kind: 'cocktail',
    kcalPerDl: 160,
    waterRatio: 0.35,
    labelKey: 'alcoholCocktail',
    hintKey: 'alcoholCocktailHint',
    isAlcohol: true,
  },
  {
    kind: 'other_alcohol',
    kcalPerDl: 200,
    waterRatio: 0.3,
    labelKey: 'alcoholOther',
    hintKey: 'alcoholOtherHint',
    isAlcohol: true,
  },
];

export const ALCOHOL_KCAL_PRESETS: AlcoholKcalPreset[] = FLUID_KIND_PRESETS.filter((preset) => preset.isAlcohol).map(
  (preset) => ({
    kind: preset.kind === 'other_alcohol' ? 'other' : (preset.kind as FluidAlcoholKind),
    kcal: preset.kcalPerDl,
    labelKey: preset.labelKey,
    hintKey: preset.hintKey,
  }),
);

export function fluidPreset(kind: FluidDrinkKind | null | undefined): FluidKcalPreset {
  return FLUID_KIND_PRESETS.find((preset) => preset.kind === kind) || FLUID_KIND_PRESETS[0];
}

export function alcoholPreset(kind: FluidAlcoholKind): AlcoholKcalPreset {
  return (
    ALCOHOL_KCAL_PRESETS.find((preset) => preset.kind === kind) || ALCOHOL_KCAL_PRESETS[ALCOHOL_KCAL_PRESETS.length - 1]
  );
}

export function alcoholKindFromDrinkKind(kind: FluidDrinkKind): FluidAlcoholKind | null {
  if (kind === 'beer' || kind === 'wine' || kind === 'spirits' || kind === 'cocktail') return kind;
  if (kind === 'other_alcohol') return 'other';
  return null;
}

export function drinkKindFromAlcoholKind(kind: FluidAlcoholKind | null | undefined): FluidDrinkKind {
  if (kind === 'beer' || kind === 'wine' || kind === 'spirits' || kind === 'cocktail') return kind;
  if (kind === 'other') return 'other_alcohol';
  return 'fluid';
}

export function estimateFluidKcal(input: {
  amountDl: number;
  kind: FluidDrinkKind;
  customKcal?: number | null;
}): number {
  const amountDl = Math.max(0, Number(input.amountDl || 0));
  const preset = fluidPreset(input.kind);
  if (input.kind === 'other_alcohol') {
    return Math.max(0, Math.round(Number(input.customKcal ?? preset.kcalPerDl)));
  }
  return Math.max(0, Math.round(amountDl * preset.kcalPerDl));
}

export function estimateFluidAlcoholKcal(input: {
  amountDl: number;
  isAlcohol: boolean;
  kind: FluidAlcoholKind;
  customKcal?: number | null;
}): number {
  if (!input.isAlcohol) return 0;
  return estimateFluidKcal({
    amountDl: input.amountDl,
    kind: drinkKindFromAlcoholKind(input.kind),
    customKcal: input.customKcal,
  });
}

export function waterEquivalentDl(input: { amountDl: number; kind?: FluidDrinkKind | null }): number {
  const amountDl = Math.max(0, Number(input.amountDl || 0));
  return Math.round(amountDl * fluidPreset(input.kind).waterRatio * 10) / 10;
}

export function fluidLogWaterEquivalentDl(
  entry: Pick<FluidLog, 'amount_dl' | 'drink_kind' | 'is_alcohol' | 'alcohol_kind'>,
): number {
  const kind = entry.drink_kind || (entry.is_alcohol ? drinkKindFromAlcoholKind(entry.alcohol_kind) : 'fluid');
  return waterEquivalentDl({ amountDl: entry.amount_dl, kind });
}

export function fluidLogKcal(entry: Pick<FluidLog, 'is_alcohol' | 'kcal'>): number {
  return Math.max(0, Math.round(Number(entry.kcal || 0)));
}

export function effectiveFluidGoalDl(input: {
  baseGoalDl: number;
  burnedKcal: number;
  activityBonusDlPer100Kcal: number;
}): number {
  const base = Math.max(0, Number(input.baseGoalDl || 0));
  const bonusPer100 = Math.max(0, Number(input.activityBonusDlPer100Kcal || 0));
  const burned = Math.max(0, Number(input.burnedKcal || 0));
  return Math.round((base + (burned / 100) * bonusPer100) * 10) / 10;
}

export function formatFluidAmount(amountDl: number): string {
  const rounded = Math.round(Number(amountDl || 0) * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} dl`;
}
