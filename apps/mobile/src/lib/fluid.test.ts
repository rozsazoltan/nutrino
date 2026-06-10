import { describe, expect, it } from 'vitest';
import {
  ALCOHOL_KCAL_PRESETS,
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
    expect(estimateFluidAlcoholKcal({ amountDl: 4, isAlcohol: true, kind: 'other', customKcal: 200 })).toBe(200);
    expect(estimateFluidAlcoholKcal({ amountDl: 4, isAlcohol: true, kind: 'other', customKcal: -10 })).toBe(0);
  });

  it('formats dl values without noisy decimals', () => {
    expect(formatFluidAmount(2)).toBe('2 dl');
    expect(formatFluidAmount(2.25)).toBe('2.3 dl');
  });

  it('defines a kcal preset for every alcohol option exposed by the UI', () => {
    expect(ALCOHOL_KCAL_PRESETS.map((preset) => preset.kind)).toEqual([
      'beer',
      'wine',
      'spirits',
      'cocktail',
      'other',
    ]);
  });
});
