import { describe, expect, it } from 'vitest';
import { estimatePreparationKcal, foodSupportsPreparation, hasPieceServing, oilMlToKcal } from './preparation';

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
    expect(estimatePreparationKcal({ method: 'custom_oil', amountG: 150, oilMl: 10 })).toBe(81);
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
    expect(foodSupportsPreparation({ id: 'recipe:hotdog', name: 'hotdog', note: null })).toBe(false);
  });
});
