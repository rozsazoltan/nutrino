#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
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

function hasGitRepository() {
  return exists('.git');
}

function isTrackedByGit(file) {
  if (!hasGitRepository()) return exists(file);

  try {
    execFileSync('git', ['ls-files', '--error-unmatch', file], {
      cwd: root,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function expectNotTracked(file, message) {
  expect(!isTrackedByGit(file), message);
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
expectNotTracked('pnpm-lock.yaml', 'pnpm-lock.yaml should not be committed.');
expectNotTracked('package-lock.json', 'package-lock.json should not be committed.');
expectNotTracked('yarn.lock', 'yarn.lock should not be committed.');
expectNotTracked('bun.lockb', 'bun.lockb should not be committed.');
expectNotTracked('aube.lock', 'aube.lock should not be committed.');
expectNotTracked('aube-lock.yaml', 'aube-lock.yaml should not be committed.');
expect(exists('.oxlintrc.json'), '.oxlintrc.json should exist.');
expect(exists('.oxfmtrc.json'), '.oxfmtrc.json should exist.');
expect(exists('vitest.config.ts'), 'vitest.config.ts should exist.');
expect(exists('scripts/run-quality.mjs'), 'scripts/run-quality.mjs should exist.');
expect(exists('scripts/install-git-hooks.mjs'), 'scripts/install-git-hooks.mjs should exist.');
expect(exists('CONTRIBUTING.md'), 'CONTRIBUTING.md should contain development and contribution instructions.');

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
expect(!read('mise.toml').includes('[tasks.'), 'mise.toml should only define tool dependencies, not task shortcuts.');
expect(!read('mise.toml').includes('hk ='), 'mise should not require hk for cross-platform hooks.');
expect(!read('mise.toml').includes('pkl ='), 'mise should not require pkl for cross-platform hooks.');
expectContains('scripts/run-quality.mjs', 'pre-commit', 'Quality runner should define a pre-commit mode.');
expectContains('scripts/run-quality.mjs', 'pre-push', 'Quality runner should define a pre-push mode.');
expectContains('scripts/run-quality.mjs', 'format:js', 'Quality runner should run JavaScript formatting.');
expectContains('scripts/run-quality.mjs', 'format:rust', 'Quality runner should run Rust formatting.');

for (const file of [
  'README.md',
  'apps/mobile/src-tauri/tauri.conf.json',
  'apps/desktop/src-tauri/tauri.conf.json',
  'apps/mobile/scripts/android-dev-host.mjs',
  'apps/mobile/scripts/android-build.mjs',
  'apps/mobile/scripts/android-init.mjs',
  'apps/mobile/scripts/android-doctor.mjs',
  'apps/mobile/scripts/patch-android-generated.mjs',
  '.github/workflows/test.yml',
  '.github/workflows/release.yml',
  '.github/release/nutrino-desktop.tauri-release.toml',
  '.github/release/nutrino-mobile.tauri-release.toml',
]) {
  expectNoPackageManagerReferences(file);
}

expectContains('README.md', '## Installation', 'README should focus on user installation.');
expectContains('README.md', '## Features', 'README should describe app features for users.');
expectContains('CONTRIBUTING.md', 'aube run check', 'CONTRIBUTING.md should document repository checks.');
expectContains('CONTRIBUTING.md', 'Rector', 'CONTRIBUTING.md should document PHP tooling convention.');
expectContains('CONTRIBUTING.md', 'Oxlint', 'CONTRIBUTING.md should document JavaScript tooling convention.');
expectContains('CONTRIBUTING.md', 'clippy', 'CONTRIBUTING.md should document Rust tooling convention.');
expectContains('.gitignore', 'aube-lock.yaml', 'Aube YAML lock files should be ignored.');
expect(!exists('hk.pkl'), 'hk.pkl should not be used because hk requires sh on Windows.');

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
  rootPackage.scripts['hooks:install'] === 'node scripts/install-git-hooks.mjs',
  'Root package should expose cross-platform Git hook installation.',
);
expect(
  rootPackage.scripts['pre-commit'] === 'node scripts/run-quality.mjs pre-commit',
  'Root package should expose the Node-backed pre-commit hook.',
);
expect(
  rootPackage.scripts['hooks:check'] === 'node scripts/run-quality.mjs check',
  'Root package should expose Node-backed quality checks.',
);
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
