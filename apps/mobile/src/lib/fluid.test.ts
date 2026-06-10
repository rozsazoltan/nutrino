import { describe, expect, it } from 'vitest';
import {
  ALCOHOL_KCAL_PRESETS,
  FLUID_KIND_PRESETS,
  FLUID_QUICK_AMOUNTS_DL,
  alcoholPreset,
  effectiveFluidGoalDl,
  estimateFluidAlcoholKcal,
  estimateFluidKcal,
  fluidLogKcal,
  fluidLogWaterEquivalentDl,
  formatFluidAmount,
  waterEquivalentDl,
} from './fluid';

describe('fluid tracking helpers', () => {
  it('tracks water without calories and with full clean-water credit', () => {
    expect(estimateFluidKcal({ amountDl: 3, kind: 'water' })).toBe(0);
    expect(waterEquivalentDl({ amountDl: 3, kind: 'water' })).toBe(3);
  });

  it('counts soft drinks as calories and partial clean-water equivalent', () => {
    expect(estimateFluidKcal({ amountDl: 3, kind: 'soft_drink' })).toBe(126);
    expect(waterEquivalentDl({ amountDl: 3, kind: 'soft_drink' })).toBe(2);
  });

  it('estimates alcohol calories from dl-based presets', () => {
    expect(estimateFluidAlcoholKcal({ amountDl: 5, isAlcohol: true, kind: 'beer' })).toBe(225);
    expect(estimateFluidAlcoholKcal({ amountDl: 2, isAlcohol: true, kind: 'wine' })).toBe(170);
    expect(estimateFluidAlcoholKcal({ amountDl: 0.5, isAlcohol: true, kind: 'spirits' })).toBe(115);
  });

  it('keeps legacy alcohol API calorie-free when alcohol is not checked', () => {
    expect(estimateFluidAlcoholKcal({ amountDl: 3, isAlcohol: false, kind: 'beer' })).toBe(0);
  });

  it('uses a per-drink custom kcal value for other alcohol', () => {
    expect(estimateFluidAlcoholKcal({ amountDl: 4, isAlcohol: true, kind: 'other', customKcal: 200 })).toBe(200);
    expect(estimateFluidAlcoholKcal({ amountDl: 4, isAlcohol: true, kind: 'other', customKcal: -10 })).toBe(0);
  });

  it('falls back to the other preset for unknown alcohol kinds from older data', () => {
    expect(alcoholPreset('legacy' as any).kind).toBe('other');
  });

  it('rounds kcal and never returns negative values', () => {
    expect(estimateFluidAlcoholKcal({ amountDl: 1.25, isAlcohol: true, kind: 'wine' })).toBe(106);
    expect(estimateFluidAlcoholKcal({ amountDl: -5, isAlcohol: true, kind: 'beer' })).toBe(0);
    expect(fluidLogKcal({ is_alcohol: false, kcal: 40.6 })).toBe(41);
    expect(fluidLogKcal({ is_alcohol: true, kcal: -40 })).toBe(0);
  });

  it('calculates effective daily fluid goal from activity calories', () => {
    expect(effectiveFluidGoalDl({ baseGoalDl: 25, burnedKcal: 300, activityBonusDlPer100Kcal: 2 })).toBe(31);
  });

  it('normalizes clean-water equivalent for persisted entries', () => {
    expect(
      fluidLogWaterEquivalentDl({ amount_dl: 2, drink_kind: 'juice', is_alcohol: false, alcohol_kind: null }),
    ).toBe(1.5);
    expect(fluidLogWaterEquivalentDl({ amount_dl: 2, drink_kind: null, is_alcohol: true, alcohol_kind: 'beer' })).toBe(
      0.9,
    );
  });

  it('formats dl values without noisy decimals', () => {
    expect(formatFluidAmount(2)).toBe('2 dl');
    expect(formatFluidAmount(2.25)).toBe('2.3 dl');
    expect(formatFluidAmount(Number.NaN)).toBe('0 dl');
  });

  it('defines quick amounts and all fluid presets exposed by the UI', () => {
    expect([...FLUID_QUICK_AMOUNTS_DL]).toEqual([1, 2, 3]);
    expect(ALCOHOL_KCAL_PRESETS.map((preset) => preset.kind)).toEqual(['beer', 'wine', 'spirits', 'cocktail', 'other']);
    expect(new Set(FLUID_KIND_PRESETS.map((preset) => preset.kind)).size).toBe(FLUID_KIND_PRESETS.length);
  });
});
