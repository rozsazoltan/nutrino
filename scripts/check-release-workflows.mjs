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

expectContains('.github/workflows/release.yml', 'github-release prepare', 'Release workflow should prepare releases through github-release.');
expectContains('.github/workflows/release.yml', 'github-release finalize', 'Release workflow should finalize releases through github-release.');
expectContains('.github/workflows/release.yml', 'github-release cleanup', 'Release workflow should clean up failed release branches.');
expectContains('.github/workflows/release.yml', 'verzly/tauri-release', 'Release workflow should delegate platform builds to tauri-release.');
expectContains('.github/workflows/release.yml', 'release_name_prefix', 'Release workflow should support release name prefix input.');
expectContains('.github/release/nutrino.github-release.toml', 'bundle.android.versionCode', 'Release config should manage Android versionCode.');
expectContains('.github/release/nutrino.github-release.toml', 'cargo-lock-package', 'Release config should manage Cargo.lock package versions.');
expectContains('.github/release/nutrino.github-release.toml', 'release_name_prefix = "Nutrino "', 'Release config should default GitHub Release names to Nutrino vX.Y.Z.');
expectContains('.github/workflows/delete-release.yml', 'expected_confirmation="DELETE ${version}"', 'Delete release workflow should require an explicit confirmation phrase.');
expectContains('.github/workflows/delete-release.yml', 'gh api --method DELETE "/repos/${{ github.repository }}/releases/', 'Delete release workflow should delete the GitHub Release.');
expectContains('.github/workflows/delete-release.yml', 'gh api --method DELETE "/repos/${{ github.repository }}/git/refs/tags/', 'Delete release workflow should delete Git tags.');

if (failures.length > 0) {
  console.error('Release workflow check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Release workflow check OK.');
