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
  try {
    const output = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return output.trim() === 'true';
  } catch {
    return false;
  }
}

function isTrackedByGit(file) {
  if (!hasGitRepository()) return false;

  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', file], {
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
expect(exists('hk.pkl'), 'hk.pkl should exist.');
expect(exists('CONTRIBUTING.md'), 'CONTRIBUTING.md should contain development and contribution instructions.');
expect(exists('scripts/check-wip-ci.mjs'), 'WIP CI guard script should exist.');

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
expectContains('mise.toml', 'hk = "1.47.0"', 'mise should install a pinned hk version.');
expectContains('mise.toml', 'pkl = "0.31.1"', 'mise should install pkl for hk configuration compatibility.');
expectContains('hk.pkl', 'windows = "cmd /d /s /c"', 'hk should use cmd.exe instead of sh on Windows.');
expectContains('hk.pkl', 'aube run format:js', 'hk should run JavaScript formatting.');
expectContains('hk.pkl', 'aube run format:rust', 'hk should run Rust formatting.');
expectContains('hk.pkl', 'aube run lint:js', 'hk pre-push should run JavaScript linting.');
expectContains('hk.pkl', 'aube run test:unit', 'hk pre-push should run Vitest unit tests.');
expectContains('hk.pkl', 'aube run test:app', 'hk pre-push should run app-domain checks.');
expectContains('hk.pkl', 'aube run check:i18n', 'hk pre-push should run i18n checks.');
expectContains('hk.pkl', 'aube run test:rust', 'hk pre-push should run Rust checks.');
expectContains('hk.pkl', 'aube run build --filter nutrino-mobile', 'hk pre-push should build the mobile app.');
expectContains('hk.pkl', 'aube run build --filter nutrino-desktop', 'hk pre-push should build the desktop app.');
expectContains(
  'hk.pkl',
  'depends = formatStepNames',
  'hk fast quality steps should wait for formatter steps before running tests.',
);
expectContains(
  'hk.pkl',
  'depends = fastQualityStepNames',
  'hk push-quality steps should wait for fast quality checks before running expensive checks.',
);
expectContains('hk.pkl', '["pre-commit"]', 'hk should define a fast formatting pre-commit hook.');
expectContains('hk.pkl', 'fix = true', 'hk pre-commit should auto-fix formatting only.');
expectContains('hk.pkl', '["pre-push"]', 'hk should define a pre-push quality hook.');

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
expectContains('CONTRIBUTING.md', 'hk run pre-push', 'CONTRIBUTING.md should document push hook checks.');
expectContains('CONTRIBUTING.md', 'Rector', 'CONTRIBUTING.md should document PHP tooling convention.');
expectContains('CONTRIBUTING.md', 'Oxlint', 'CONTRIBUTING.md should document JavaScript tooling convention.');
expectContains('CONTRIBUTING.md', 'clippy', 'CONTRIBUTING.md should document Rust tooling convention.');
expectContains('.gitignore', 'aube-lock.yaml', 'Aube YAML lock files should be ignored.');

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
expect(rootPackage.scripts.check === 'aube run quality:push', 'Root check should run the full push quality gate.');
expect(
  rootPackage.scripts['quality:push']?.includes('aube run test:rust'),
  'Push quality should include Rust/Tauri checks.',
);
expect(
  rootPackage.scripts['quality:push']?.includes('aube run build --filter nutrino-mobile'),
  'Push quality should include the mobile web build.',
);
expect(
  rootPackage.scripts['quality:push']?.includes('aube run build --filter nutrino-desktop'),
  'Push quality should include the desktop web build.',
);
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
  !Object.prototype.hasOwnProperty.call(rootPackage.scripts, 'hooks:install'),
  'Root package should not wrap hk install through aube scripts.',
);
expect(
  !Object.prototype.hasOwnProperty.call(rootPackage.scripts, 'hooks:check'),
  'Root package should not wrap hk check through aube scripts.',
);
expect(
  !Object.prototype.hasOwnProperty.call(rootPackage.scripts, 'pre-commit'),
  'Root package should not define npm-style pre-commit scripts.',
);
expect(
  !Object.prototype.hasOwnProperty.call(rootPackage.scripts, 'pre-push'),
  'Root package should let hk own pre-push directly.',
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
