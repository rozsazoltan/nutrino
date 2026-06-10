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

expectContains('aube-workspace.yaml', 'catalog:', 'aube-workspace.yaml should define a dependency catalog.');
expectContains('aube-workspace.yaml', 'verifyDepsBeforeRun: install', 'aube should install dependencies before running scripts.');
expectContains('mise.toml', 'node = "24"', 'mise should pin Node 24.');
expectContains('mise.toml', 'aube = "latest"', 'mise should install aube.');
expectContains('mise.toml', 'rust = "stable"', 'mise should install stable Rust.');

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

const rootPackage = readJson('package.json');
expect(rootPackage.scripts.check.includes('aube run test:js'), 'Root check should include JavaScript tooling checks.');
expect(rootPackage.scripts.check.includes('aube run test:rust'), 'Root check should include Rust/Tauri config checks.');
expect(rootPackage.scripts['test:js'] === 'node scripts/check-js-tooling.mjs', 'Root package should expose test:js.');
expect(rootPackage.scripts['test:rust'] === 'node scripts/check-rust-tauri-config.mjs', 'Root package should expose test:rust.');

if (failures.length > 0) {
  console.error('JavaScript tooling check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('JavaScript tooling check OK.');
