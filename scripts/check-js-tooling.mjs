#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function expectContains(file, needle, message) {
  expect(read(file).includes(needle), message);
}

function expectNotExists(file, message) {
  expect(!exists(file), message);
}

function expectNoPackageManagerReferences(file) {
  const source = read(file);
  const forbidden = [
    ['pnpm ', 'pnpm command'],
    ['pnpm@', 'pnpm version pin'],
    ['pnpm-', 'pnpm lock/cache reference'],
    ['npm install', 'npm install command'],
    ['yarn ', 'yarn command'],
    ['bun install', 'bun install command'],
  ];

  for (const [needle, label] of forbidden) {
    expect(!source.includes(needle), `${file} should not contain ${label}.`);
  }
}

function packageUsesCatalog(relativePath) {
  const data = readJson(relativePath);
  for (const section of ['dependencies', 'devDependencies']) {
    const entries = Object.entries(data[section] ?? {});
    for (const [name, version] of entries) {
      if (name.startsWith('@types/')) continue;
      if (name === 'typescript') continue;
      expect(version === 'catalog:', `${relativePath} should use catalog: for ${section}.${name}.`);
    }
  }
}

expect(exists('aube-workspace.yaml'), 'aube-workspace.yaml should exist.');
expectNotExists('pnpm-workspace.yaml', 'pnpm-workspace.yaml should not exist after moving to aube.');
expectNotExists('pnpm-lock.yaml', 'pnpm-lock.yaml should not be committed.');
expectNotExists('package-lock.json', 'package-lock.json should not be committed.');
expectNotExists('yarn.lock', 'yarn.lock should not be committed.');
expectNotExists('bun.lockb', 'bun.lockb should not be committed.');
expectNotExists('aube.lock', 'aube.lock should not be committed.');
expect(exists('.oxlintrc.json'), '.oxlintrc.json should exist.');
expect(exists('.oxfmtrc.json'), '.oxfmtrc.json should exist.');
expect(exists('vitest.config.ts'), 'vitest.config.ts should exist.');
expect(exists('hk.pkl'), 'hk.pkl should exist.');

expectContains('aube-workspace.yaml', 'catalog:', 'aube-workspace.yaml should define a dependency catalog.');
expectContains(
  'aube-workspace.yaml',
  'verifyDepsBeforeRun: install',
  'aube should install dependencies before running scripts.',
);
expectContains(
  'aube-workspace.yaml',
  'strictDepBuilds: true',
  'aube should fail on unreviewed dependency build scripts.',
);
expectContains(
  'aube-workspace.yaml',
  'allowBuilds:',
  'aube-workspace.yaml should explicitly review dependency build scripts.',
);
expectContains(
  'aube-workspace.yaml',
  '  esbuild: true',
  'esbuild install script should be explicitly approved for Vite builds.',
);
expectContains('aube-workspace.yaml', '  esbuild: ^', 'esbuild should be an explicit Vite build dependency.');
expectContains('aube-workspace.yaml', '  oxlint: ^', 'oxlint should be part of the JavaScript quality gate.');
expectContains('aube-workspace.yaml', '  oxfmt: ^', 'oxfmt should be part of the JavaScript quality gate.');
expectContains('aube-workspace.yaml', '  vitest: ^', 'vitest should be part of the JavaScript test gate.');
expectContains(
  'aube-workspace.yaml',
  "'@vitejs/plugin-vue': ^6.",
  'Vue plugin catalog should use the current major version.',
);
expectContains('aube-workspace.yaml', 'vite: ^8.', 'Vite catalog should use the current major version.');
expectContains('aube-workspace.yaml', 'vue-tsc: ^3.', 'vue-tsc catalog should use the current major version.');
expectContains('aube-workspace.yaml', 'typescript: ^6.', 'TypeScript catalog should use the current major version.');
expectContains('mise.toml', 'node = "24"', 'mise should pin Node 24.');
expectContains('mise.toml', 'aube = "latest"', 'mise should install aube.');
expectContains('mise.toml', 'rust = "stable"', 'mise should install stable Rust.');
expectContains('mise.toml', 'hk = "latest"', 'mise should install hk for Git hooks.');
expectContains('mise.toml', 'pkl = "latest"', 'mise should install pkl for hook configuration.');
expect(!read('mise.toml').includes('[tasks.'), 'mise.toml should only define tool dependencies, not task shortcuts.');
expectContains('hk.pkl', '["pre-commit"]', 'hk should define a pre-commit hook.');
expectContains('hk.pkl', 'hk@1.18.1', 'hk.pkl should pin the hk configuration schema.');
expectContains('hk.pkl', 'oxfmt', 'hk should run oxfmt for JavaScript formatting.');
expectContains('hk.pkl', 'rustfmt', 'hk should run rustfmt for Rust formatting.');

for (const file of [
  'README.md',
  '.github/workflows/test.yml',
  '.github/workflows/release.yml',
  '.github/release/nutrino-desktop.tauri-release.toml',
  '.github/release/nutrino-mobile.tauri-release.toml',
]) {
  expectNoPackageManagerReferences(file);
}

packageUsesCatalog('apps/mobile/package.json');
packageUsesCatalog('apps/desktop/package.json');
expect(
  readJson('apps/mobile/package.json').devDependencies?.esbuild === 'catalog:',
  'Mobile app should depend on esbuild explicitly for Vite 8 builds.',
);
expect(
  readJson('apps/desktop/package.json').devDependencies?.esbuild === 'catalog:',
  'Desktop app should depend on esbuild explicitly for Vite 8 builds.',
);

const rootPackage = readJson('package.json');
expect(rootPackage.scripts.check.includes('aube run test:js'), 'Root check should include JavaScript tooling checks.');
expect(rootPackage.scripts.check.includes('aube run test:rust'), 'Root check should include Rust/Tauri checks.');
expect(rootPackage.scripts['lint:js']?.startsWith('oxlint '), 'Root package should expose oxlint.');
expect(rootPackage.scripts['format:js:check']?.startsWith('oxfmt --check '), 'Root package should expose oxfmt check.');
expect(rootPackage.scripts['test:unit'] === 'vitest run', 'Root package should expose vitest unit tests.');
expect(rootPackage.scripts['test:js'].includes('aube run lint:js'), 'Root test:js should run oxlint.');
expect(
  rootPackage.scripts['test:js'].includes('aube run format:js:check'),
  'Root test:js should run oxfmt in check mode.',
);
expect(rootPackage.scripts['test:js'].includes('aube run test:unit'), 'Root test:js should run vitest.');
expect(rootPackage.scripts['test:rust'] === 'aube run check:rust', 'Root package should expose Rust checks.');
expect(
  rootPackage.scripts.format === 'aube run format:js && aube run format:rust',
  'Root package should expose combined formatting.',
);
expect(
  rootPackage.scripts['hooks:install'] === 'HK_MISE=1 hk install --mise',
  'Root package should expose hk installation.',
);
expect(rootPackage.scripts['pre-commit'] === 'hk run pre-commit', 'Root package should expose the hk pre-commit hook.');
for (const dependency of ['esbuild', 'oxlint', 'oxfmt', 'vitest']) {
  expect(
    rootPackage.devDependencies?.[dependency] === 'catalog:',
    `Root package should include ${dependency} from the catalog.`,
  );
}

if (failures.length > 0) {
  console.error('JavaScript tooling check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('JavaScript tooling check OK.');
