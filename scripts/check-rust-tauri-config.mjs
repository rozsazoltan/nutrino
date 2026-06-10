#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];

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

function manifestValue(relativePath, key) {
  const source = read(relativePath);
  const match = source.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
  if (!match) throw new Error(`Missing ${key} in ${relativePath}`);
  return match[1];
}

function cargoLockPackageVersion(relativePath, packageName) {
  const source = read(relativePath);
  const blocks = source.split(/(?=^\[\[package\]\]$)/m);
  const block = blocks.find((item) => item.includes(`name = "${packageName}"`));
  if (!block) throw new Error(`Missing ${packageName} package entry in ${relativePath}`);
  const match = block.match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`Missing ${packageName} package version in ${relativePath}`);
  return match[1];
}

function androidVersionCode(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Invalid version for Android versionCode: ${version}`);
  const [, major, minor, patch] = match.map(Number);
  return major * 10000 + minor * 100 + patch;
}

const rootVersion = readJson('package.json').version;
const mobilePackageVersion = readJson('apps/mobile/package.json').version;
const desktopPackageVersion = readJson('apps/desktop/package.json').version;
const mobileTauri = readJson('apps/mobile/src-tauri/tauri.conf.json');
const desktopTauri = readJson('apps/desktop/src-tauri/tauri.conf.json');

expect(mobilePackageVersion === rootVersion, 'Mobile package version should match root package version.');
expect(desktopPackageVersion === rootVersion, 'Desktop package version should match root package version.');
expect(mobileTauri.version === rootVersion, 'Mobile Tauri version should match root package version.');
expect(desktopTauri.version === rootVersion, 'Desktop Tauri version should match root package version.');
expect(
  mobileTauri.bundle?.android?.versionCode === androidVersionCode(rootVersion),
  'Android versionCode should be derived from SemVer.',
);

expect(
  manifestValue('apps/mobile/src-tauri/Cargo.toml', 'name') === 'nutrino_mobile',
  'Mobile Cargo package name should stay stable.',
);
expect(
  manifestValue('apps/desktop/src-tauri/Cargo.toml', 'name') === 'nutrino_desktop',
  'Desktop Cargo package name should stay stable.',
);
expect(
  manifestValue('apps/mobile/src-tauri/Cargo.toml', 'version') === rootVersion,
  'Mobile Cargo version should match root package version.',
);
expect(
  manifestValue('apps/desktop/src-tauri/Cargo.toml', 'version') === rootVersion,
  'Desktop Cargo version should match root package version.',
);
expect(
  cargoLockPackageVersion('apps/mobile/src-tauri/Cargo.lock', 'nutrino_mobile') === rootVersion,
  'Mobile Cargo.lock package version should match root package version.',
);
expect(
  cargoLockPackageVersion('apps/desktop/src-tauri/Cargo.lock', 'nutrino_desktop') === rootVersion,
  'Desktop Cargo.lock package version should match root package version.',
);

expectContains('apps/mobile/src-tauri/Cargo.toml', 'panic = "abort"', 'Mobile release profile should abort on panic.');
expectContains('apps/mobile/src-tauri/Cargo.toml', 'lto = "thin"', 'Mobile release profile should enable thin LTO.');
expectContains('apps/mobile/src-tauri/Cargo.toml', 'strip = "symbols"', 'Mobile release profile should strip symbols.');
expectContains(
  'apps/mobile/src-tauri/Cargo.toml',
  'tauri-plugin-notification',
  'Mobile app should include notification plugin for Android handoff actions.',
);
expectContains(
  'apps/mobile/src-tauri/Cargo.toml',
  '[target."cfg(any(target_os = ',
  'Mobile-only plugins should stay behind mobile target dependencies.',
);
expectContains(
  'apps/mobile/src-tauri/Cargo.toml',
  'tauri-plugin-share = "2"',
  'Mobile app should keep native share plugin for backup exports.',
);
expectContains(
  'apps/mobile/src-tauri/capabilities/default.json',
  '"share:default"',
  'Mobile capability should keep native share permission for backup exports.',
);
expectContains(
  'apps/desktop/src-tauri/Cargo.toml',
  'axum = { version = "0.8", features = ["ws"] }',
  'Desktop LAN API should keep websocket support enabled.',
);
expectContains(
  'apps/desktop/src-tauri/Cargo.toml',
  'tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "net", "time"] }',
  'Desktop LAN API should keep tokio time support enabled.',
);
expectContains(
  'apps/desktop/src-tauri/Cargo.toml',
  'base64 = "0.22"',
  'Desktop should keep base64 support for mobile handoff chunks.',
);
expectContains('.gitignore', '**/src-tauri/gen/android/*.jks', 'Android keystores should be ignored.');
expectContains(
  '.gitignore',
  '**/src-tauri/gen/android/keystore.properties',
  'Android keystore properties should be ignored.',
);

const rootPackage = readJson('package.json');
expect(rootPackage.scripts['format:rust:check']?.includes('cargo fmt'), 'Rust checks should include rustfmt.');
expect(rootPackage.scripts['lint:rust']?.includes('cargo clippy'), 'Rust checks should include clippy.');
expect(rootPackage.scripts['test:rust:cargo']?.includes('cargo test'), 'Rust checks should include cargo test.');
expect(
  rootPackage.scripts['check:rust']?.includes('cargo metadata --manifest-path apps/mobile/src-tauri/Cargo.toml'),
  'Rust checks should validate the mobile manifest without host-checking mobile-only capabilities.',
);
expect(
  rootPackage.scripts['check:rust']?.includes('cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml'),
  'Rust checks should check the desktop crate.',
);
expectContains('mise.toml', 'rust = "stable"', 'mise should install stable Rust.');
expect(
  !read('mise.toml').includes('[tasks.'),
  'mise.toml should not contain task shortcuts; package scripts own repository automation.',
);
expectContains('hk.pkl', 'aube run format:rust', 'hk should run Rust formatting.');
expectContains('package.json', 'format:rust:check', 'Package scripts should expose Rust formatting checks.');

if (failures.length > 0) {
  console.error('Rust/Tauri config check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Rust/Tauri config check OK.');
