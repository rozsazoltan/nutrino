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

expectContains(
  '.github/workflows/release.yml',
  'github-release prepare',
  'Release workflow should prepare releases through github-release.',
);
expectContains(
  '.github/workflows/release.yml',
  'github-release finalize',
  'Release workflow should finalize releases through github-release.',
);
expectContains(
  '.github/workflows/release.yml',
  'github-release cleanup',
  'Release workflow should clean up failed release branches.',
);
expectContains(
  '.github/workflows/release.yml',
  'verzly/tauri-release',
  'Release workflow should delegate platform builds to tauri-release.',
);
expectContains(
  '.github/workflows/release.yml',
  'verzly/setup-aube',
  'Release workflow should install JavaScript dependencies through setup-aube.',
);
expectContains('.github/workflows/test.yml', 'actions/setup-node@v6', 'Test workflow should install Node directly instead of failing during mise install.');
expectContains(
  '.github/workflows/test.yml',
  'aube run format:js',
  'Test workflow should format JavaScript before checks.',
);
expectContains(
  '.github/workflows/test.yml',
  'cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml',
  'Test workflow should format Rust before checks.',
);
expectContains('.github/workflows/test.yml', 'aube run test:js', 'Test workflow should run JavaScript tooling checks.');
expectContains(
  '.github/workflows/test.yml',
  'aube run build --filter nutrino-mobile',
  'Test workflow should build the mobile web app.',
);
expectContains(
  '.github/workflows/test.yml',
  'aube run build --filter nutrino-desktop',
  'Test workflow should build the desktop web app.',
);
expectContains(
  '.github/workflows/test.yml',
  'node scripts/check-rust-tauri-config.mjs',
  'Test workflow should run Rust/Tauri config checks.',
);
expectContains(
  '.github/workflows/test.yml',
  'cargo metadata --manifest-path apps/mobile/src-tauri/Cargo.toml --no-deps',
  'Test workflow should validate the mobile Rust manifest without a host-only cargo check.',
);
expectContains(
  '.github/workflows/test.yml',
  'cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml',
  'Test workflow should check the desktop Rust crate.',
);
expectContains(
  '.github/workflows/test.yml',
  'cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check',
  'Test workflow should still verify Rust formatting after auto-formatting.',
);
expectContains(
  '.github/workflows/test.yml',
  'cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings',
  'Test workflow should lint the desktop Rust crate.',
);
expectContains(
  '.github/workflows/test.yml',
  'cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --all-targets',
  'Test workflow should run desktop Rust tests.',
);
expectContains('.github/workflows/test.yml', 'Restore Cargo cache', 'Test workflow should cache Cargo dependencies.');
expectContains(
  '.github/workflows/release.yml',
  'Restore Cargo and Tauri cache',
  'Release workflow should cache desktop Cargo/Tauri builds.',
);
expectContains(
  '.github/workflows/release.yml',
  'Restore Android build cache',
  'Release workflow should cache Android Cargo/Gradle/Tauri builds.',
);
expectContains(
  '.github/workflows/release.yml',
  'Restore iOS Cargo and Tauri cache',
  'Release workflow should cache iOS Cargo/Tauri builds.',
);
expectContains('.gitignore', 'aube.lock', 'Aube lock files should be ignored.');
expectContains('.gitignore', 'package-lock.json', 'npm lock files should be ignored.');
expectContains(
  'aube-workspace.yaml',
  'verifyDepsBeforeRun: install',
  'Aube workspace should install dependencies before running scripts.',
);
expectContains('mise.toml', 'aube = "latest"', 'Mise should install aube for local development.');
expectContains('mise.toml', 'hk = "latest"', 'Mise should install hk for Git hooks.');
expectContains('mise.toml', 'pkl = "latest"', 'Mise should install pkl for hook configuration.');
expectContains('hk.pkl', '["pre-commit"]', 'hk should define a pre-commit hook.');
expectContains(
  '.github/workflows/release.yml',
  'release_name_prefix',
  'Release workflow should support release name prefix input.',
);
expectContains(
  '.github/release/nutrino.github-release.toml',
  'bundle.android.versionCode',
  'Release config should manage Android versionCode.',
);
expectContains(
  '.github/release/nutrino.github-release.toml',
  'cargo-lock-package',
  'Release config should manage Cargo.lock package versions.',
);
expectContains(
  '.github/release/nutrino.github-release.toml',
  'release_name_prefix = "Nutrino "',
  'Release config should default GitHub Release names to Nutrino vX.Y.Z.',
);
expectContains(
  '.github/workflows/delete-release.yml',
  'expected_confirmation="DELETE ${version}"',
  'Delete release workflow should require an explicit confirmation phrase.',
);
expectContains(
  '.github/workflows/delete-release.yml',
  'gh api --method DELETE "/repos/${{ github.repository }}/releases/',
  'Delete release workflow should delete the GitHub Release.',
);
expectContains(
  '.github/workflows/delete-release.yml',
  'gh api --method DELETE "/repos/${{ github.repository }}/git/refs/tags/',
  'Delete release workflow should delete Git tags.',
);

if (failures.length > 0) {
  console.error('Release workflow check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Release workflow check OK.');
