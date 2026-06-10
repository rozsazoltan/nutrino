import type { FluidAlcoholKind, FluidLog } from '../types';

export type AlcoholKcalPreset = {
  kind: FluidAlcoholKind;
  kcal: number;
  labelKey: string;
  hintKey: string;
};

export const FLUID_QUICK_AMOUNTS_DL = [1, 2, 3] as const;

export const ALCOHOL_KCAL_PRESETS: AlcoholKcalPreset[] = [
  { kind: 'beer', kcal: 45, labelKey: 'alcoholBeer', hintKey: 'alcoholBeerHint' },
  { kind: 'wine', kcal: 85, labelKey: 'alcoholWine', hintKey: 'alcoholWineHint' },
  { kind: 'spirits', kcal: 230, labelKey: 'alcoholSpirits', hintKey: 'alcoholSpiritsHint' },
  { kind: 'cocktail', kcal: 160, labelKey: 'alcoholCocktail', hintKey: 'alcoholCocktailHint' },
  { kind: 'other', kcal: 200, labelKey: 'alcoholOther', hintKey: 'alcoholOtherHint' },
];

export function alcoholPreset(kind: FluidAlcoholKind): AlcoholKcalPreset {
  return ALCOHOL_KCAL_PRESETS.find((preset) => preset.kind === kind) || ALCOHOL_KCAL_PRESETS[ALCOHOL_KCAL_PRESETS.length - 1];
}

export function estimateFluidAlcoholKcal(input: {
  amountDl: number;
  isAlcohol: boolean;
  kind: FluidAlcoholKind;
  customKcal?: number | null;
}): number {
  if (!input.isAlcohol) return 0;

  const preset = alcoholPreset(input.kind);
  if (input.kind === 'other') {
    return Math.max(0, Math.round(Number(input.customKcal ?? preset.kcal)));
  }

  return Math.max(0, Math.round(Number(input.amountDl || 0) * preset.kcal));
}

export function fluidLogKcal(entry: Pick<FluidLog, 'is_alcohol' | 'kcal'>): number {
  return entry.is_alcohol ? Math.max(0, Math.round(Number(entry.kcal || 0))) : 0;
}

export function formatFluidAmount(amountDl: number): string {
  const rounded = Math.round(Number(amountDl || 0) * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} dl`;
}
