import { describe, expect, it } from 'vitest';
import {
  ALCOHOL_KCAL_PRESETS,
  FLUID_QUICK_AMOUNTS_DL,
  alcoholPreset,
  estimateFluidAlcoholKcal,
  fluidLogKcal,
  formatFluidAmount,
} from './fluid';

describe('fluid tracking helpers', () => {
  it('keeps non-alcoholic fluids calorie-free', () => {
    expect(estimateFluidAlcoholKcal({ amountDl: 3, isAlcohol: false, kind: 'beer' })).toBe(0);
    expect(fluidLogKcal({ is_alcohol: false, kcal: 250 })).toBe(0);
  });

  it('estimates alcohol calories from dl-based presets', () => {
    expect(estimateFluidAlcoholKcal({ amountDl: 5, isAlcohol: true, kind: 'beer' })).toBe(225);
    expect(estimateFluidAlcoholKcal({ amountDl: 2, isAlcohol: true, kind: 'wine' })).toBe(170);
    expect(estimateFluidAlcoholKcal({ amountDl: 0.5, isAlcohol: true, kind: 'spirits' })).toBe(115);
  });

  it('uses a per-drink custom kcal value for other alcohol', () => {
    expect(
      estimateFluidAlcoholKcal({
        amountDl: 4,
        isAlcohol: true,
        kind: 'other',
        customKcal: 200,
      }),
    ).toBe(200);
    expect(
      estimateFluidAlcoholKcal({
        amountDl: 4,
        isAlcohol: true,
        kind: 'other',
        customKcal: -10,
      }),
    ).toBe(0);
  });

  it('falls back to the other preset for unknown alcohol kinds from older data', () => {
    expect(alcoholPreset('legacy' as any).kind).toBe('other');
  });

  it('rounds alcohol kcal and never returns negative values', () => {
    expect(estimateFluidAlcoholKcal({ amountDl: 1.25, isAlcohol: true, kind: 'wine' })).toBe(106);
    expect(estimateFluidAlcoholKcal({ amountDl: -5, isAlcohol: true, kind: 'beer' })).toBe(0);
    expect(fluidLogKcal({ is_alcohol: true, kcal: -40 })).toBe(0);
    expect(fluidLogKcal({ is_alcohol: true, kcal: 40.6 })).toBe(41);
  });

  it('uses the default other-alcohol estimate when no custom kcal is provided', () => {
    expect(estimateFluidAlcoholKcal({ amountDl: 4, isAlcohol: true, kind: 'other' })).toBe(200);
  });

  it('formats dl values without noisy decimals', () => {
    expect(formatFluidAmount(2)).toBe('2 dl');
    expect(formatFluidAmount(2.25)).toBe('2.3 dl');
    expect(formatFluidAmount(Number.NaN)).toBe('0 dl');
  });

  it('defines quick amounts and a kcal preset for every alcohol option exposed by the UI', () => {
    expect([...FLUID_QUICK_AMOUNTS_DL]).toEqual([1, 2, 3]);
    expect(ALCOHOL_KCAL_PRESETS.map((preset) => preset.kind)).toEqual(['beer', 'wine', 'spirits', 'cocktail', 'other']);
    expect(new Set(ALCOHOL_KCAL_PRESETS.map((preset) => preset.kind)).size).toBe(ALCOHOL_KCAL_PRESETS.length);
  });
});
