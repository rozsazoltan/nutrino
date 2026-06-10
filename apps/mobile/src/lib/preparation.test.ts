import { describe, expect, it } from 'vitest';
import {
  PREPARATION_METHODS,
  estimatePreparationKcal,
  foodSupportsPreparation,
  hasPieceServing,
  intakePreparationKcal,
  oilMlToKcal,
  preparationMethodConfig,
} from './preparation';

describe('meal preparation helpers', () => {
  it('keeps raw and boiled preparation calorie-neutral', () => {
    expect(estimatePreparationKcal({ method: 'none', amountG: 200 })).toBe(0);
    expect(estimatePreparationKcal({ method: 'boiled', amountG: 200 })).toBe(0);
  });

  it('estimates cooking fat from preparation method and amount', () => {
    expect(estimatePreparationKcal({ method: 'air_fryer', amountG: 200 })).toBe(54);
    expect(estimatePreparationKcal({ method: 'pan_light_oil', amountG: 200 })).toBe(90);
    expect(estimatePreparationKcal({ method: 'deep_fried', amountG: 200 })).toBe(270);
  });

  it('supports custom oil amount when the user wants precise tracking', () => {
    expect(oilMlToKcal(10)).toBe(81);
    expect(oilMlToKcal(-10)).toBe(0);
    expect(estimatePreparationKcal({ method: 'custom_oil', amountG: 150, oilMl: 10 })).toBe(81);
    expect(estimatePreparationKcal({ method: 'custom_oil', amountG: 0, oilMl: 10 })).toBe(0);
  });

  it('handles invalid amounts and persisted entry values defensively', () => {
    expect(estimatePreparationKcal({ method: 'pan_oil', amountG: Number.NaN })).toBe(0);
    expect(estimatePreparationKcal({ method: 'deep_fried', amountG: -100 })).toBe(0);
    expect(intakePreparationKcal({ preparation_kcal: 49.6 })).toBe(50);
    expect(intakePreparationKcal({ preparation_kcal: -25 })).toBe(0);
  });

  it('returns the neutral preparation config for unknown legacy values', () => {
    expect(preparationMethodConfig('legacy' as any).key).toBe('none');
  });

  it('only exposes piece mode for explicit piece-based items', () => {
    expect(hasPieceServing({ name: 'Alma', default_unit: 'g', serving_size_g: 182 })).toBe(false);
    expect(hasPieceServing({ name: 'hotdog kifli (1 db = 62.5 g)', default_unit: 'g', serving_size_g: 62.5 })).toBe(
      true,
    );
    expect(hasPieceServing({ name: 'palacsinta', default_unit: 'serving', serving_size_g: 55 })).toBe(true);
  });

  it('suggests preparation options for cookable foods', () => {
    expect(foodSupportsPreparation({ id: 'food-burgonya', name: 'Burgonya', note: null })).toBe(true);
    expect(foodSupportsPreparation({ id: 'food-alma', name: 'Alma', note: null })).toBe(false);
    expect(foodSupportsPreparation({ id: 'food-note', name: 'Sima köret', note: 'air fryer krumpli változat' })).toBe(
      true,
    );
    expect(foodSupportsPreparation({ id: 'recipe:hotdog', name: 'hotdog', note: null })).toBe(false);
  });

  it('keeps preparation method keys unique and ordered for the UI', () => {
    expect(PREPARATION_METHODS.map((method) => method.key)).toEqual([
      'none',
      'boiled',
      'air_fryer',
      'pan_light_oil',
      'pan_oil',
      'deep_fried',
      'custom_oil',
    ]);
    expect(new Set(PREPARATION_METHODS.map((method) => method.key)).size).toBe(PREPARATION_METHODS.length);
  });
});
