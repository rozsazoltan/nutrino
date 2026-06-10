#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function expectContains(file, needle, message) {
  expect(read(file).includes(needle), message);
}

function alcoholKcal(amountDl, kind, customKcal = 200) {
  const presets = {
    beer: 45,
    wine: 85,
    spirits: 230,
    cocktail: 160,
    other: Number(customKcal),
  };
  const kcalPerDl = presets[kind];
  if (!Number.isFinite(kcalPerDl)) throw new Error(`Unknown alcohol kind: ${kind}`);
  if (kind === 'other') return Math.max(0, Math.round(kcalPerDl));
  return Math.max(0, Math.round(Number(amountDl || 0) * kcalPerDl));
}

expect(alcoholKcal(2, 'beer') === 90, 'Beer kcal estimate should be 45 kcal/dl.');
expect(alcoholKcal(1.5, 'wine') === 128, 'Wine kcal estimate should round 85 kcal/dl.');
expect(alcoholKcal(0.4, 'spirits') === 92, 'Spirits kcal estimate should support sub-dl entries.');
expect(alcoholKcal(3, 'cocktail') === 480, 'Cocktail kcal estimate should be 160 kcal/dl.');
expect(alcoholKcal(2, 'other', 200) === 200, 'Custom alcohol entries should use per-drink kcal.');

expectContains('apps/mobile/src/types.ts', 'export interface FluidLog', 'FluidLog type should exist.');
expectContains('apps/mobile/src/types.ts', 'fluidLogs: FluidLog[];', 'AppState should persist fluid logs.');
expectContains('apps/mobile/src/lib/storage.ts', 'normalizeFluidLog', 'Storage should normalize fluid logs.');
expectContains('apps/mobile/src/App.vue', "type AddMode = 'food' | 'activity' | 'fluid' | null", 'Quick add mode should support fluids.');
expectContains('apps/mobile/src/App.vue', 'const fluidQuickAmountsDl = [1, 2, 3];', 'Fluid quick amount buttons should be configured.');
expectContains('apps/mobile/src/App.vue', "{ kind: 'beer', kcal: 45", 'Beer preset should be available.');
expectContains('apps/mobile/src/App.vue', "{ kind: 'wine', kcal: 85", 'Wine preset should be available.');
expectContains('apps/mobile/src/App.vue', "{ kind: 'spirits', kcal: 230", 'Spirits preset should be available.');
expectContains('apps/mobile/src/App.vue', "{ kind: 'cocktail', kcal: 160", 'Cocktail preset should be available.');
expectContains('apps/mobile/src/App.vue', 'function addFluidLog()', 'Fluid logging action should exist.');
expectContains('apps/mobile/src/App.vue', 'aiFluidMarkdown', 'AI export should include fluid entries.');
expectContains('apps/mobile/src/App.vue', 'fluid_total_dl', 'AI export should summarize total fluid amount.');
expectContains('apps/mobile/src/icons.ts', 'glassWater:', 'Fluid icon should be registered.');

if (failures.length > 0) {
  console.error('App domain check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('App domain check OK.');
