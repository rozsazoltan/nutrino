#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { mobileCargoTargetDir, mobileGradleUserHome, pruneAndroidPackageOutputs, dirSize, formatBytes } from './android-artifacts.mjs';

const projectRoot = process.cwd();
const androidDir = path.join(projectRoot, 'src-tauri', 'gen', 'android');
const args = new Set(process.argv.slice(2));
const cleanGenerated = args.has('--generated');
const cleanRust = args.has('--all') || args.has('--rust');
const cleanGradleTransforms = args.has('--gradle-transforms');
const cleanOutputs = args.has('--outputs') || args.has('--packages');
const showSize = args.has('--size') || args.has('--sizes');
const cleanGradleUserHome = args.has('--gradle-user-home');
const fullAndroidClean = !cleanGenerated
  && !cleanOutputs
  && !cleanGradleUserHome
  && (!showSize || cleanRust || cleanGradleTransforms || args.size === 0);
const gradlew = process.platform === 'win32'
  ? path.join(androidDir, 'gradlew.bat')
  : path.join(androidDir, 'gradlew');


function showArtifactSizes() {
  const targets = [
    ['mobile src-tauri/target legacy Rust cache', path.join(projectRoot, 'src-tauri', 'target')],
    ['mobile shared Cargo target cache', mobileCargoTargetDir(projectRoot)],
    ['mobile Gradle user cache', mobileGradleUserHome(projectRoot)],
    ['generated Android app build', path.join(androidDir, 'app', 'build')],
    ['generated Android project build', path.join(androidDir, 'build')],
    ['generated Android project .gradle', path.join(androidDir, '.gradle')],
    ['generated Android buildSrc build', path.join(androidDir, 'buildSrc', 'build')],
    ['archived Android packages', path.join(projectRoot, 'dist', 'android')],
  ];

  console.log('Android/Tauri artifact sizes:');
  for (const [label, target] of targets) {
    console.log(`- ${label}: ${formatBytes(dirSize(target))}`);
  }
}

function removePath(targetPath, label = 'Removing') {
  if (!targetPath || !fs.existsSync(targetPath)) return false;
  console.log(`${label} ${targetPath}`);
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function stopGradleDaemon() {
  if (!fs.existsSync(gradlew)) return;
  console.log('Stopping generated Android Gradle daemon');
  spawnSync(gradlew, ['--stop'], {
    cwd: androidDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function gradleUserHome() {
  if (process.env.GRADLE_USER_HOME) return process.env.GRADLE_USER_HOME;
  const home = os.homedir();
  return home ? path.join(home, '.gradle') : null;
}

function cleanGlobalGradleTransforms() {
  const home = gradleUserHome();
  if (!home) return false;
  const cacheDir = path.join(home, 'caches');
  if (!fs.existsSync(cacheDir)) return false;

  let changed = false;
  for (const entry of fs.readdirSync(cacheDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('transforms-')) continue;
    changed = removePath(path.join(cacheDir, entry.name), 'Removing Gradle transform cache') || changed;
  }
  return changed;
}

if (showSize) {
  showArtifactSizes();
  if (args.size === 1 || (args.has('--size') && !cleanGenerated && !cleanRust && !cleanGradleTransforms && !cleanOutputs)) {
    process.exit(0);
  }
}

stopGradleDaemon();

if (cleanOutputs) {
  const removed = pruneAndroidPackageOutputs(androidDir);
  const total = removed.reduce((sum, item) => sum + item.size, 0);
  console.log(removed.length > 0
    ? `Android package outputs cleaned: ${formatBytes(total)}`
    : 'No generated Android package outputs to clean.');
}

if (cleanGenerated) {
  removePath(androidDir, 'Removing generated Android project');
} else if (fullAndroidClean) {
  for (const target of [
    path.join(androidDir, 'app', 'build'),
    path.join(androidDir, 'build'),
    path.join(androidDir, '.gradle'),
    path.join(androidDir, 'app', '.gradle'),
    path.join(androidDir, 'buildSrc', 'build'),
    path.join(androidDir, 'buildSrc', '.gradle'),
    path.join(androidDir, 'kotlin'),
    path.join(androidDir, 'app', 'src', 'main', 'jniLibs'),
    path.join(androidDir, '.nutrino-android-native-state.json'),
  ]) {
    removePath(target);
  }
}

if (cleanGradleTransforms) {
  cleanGlobalGradleTransforms();
}

if (cleanRust) {
  removePath(path.join(projectRoot, 'src-tauri', 'target'));
  removePath(mobileCargoTargetDir(projectRoot));

  const cargoToml = path.join(projectRoot, 'src-tauri', 'Cargo.toml');
  if (fs.existsSync(cargoToml)) {
    console.log('Running cargo clean for mobile Rust crate');
    spawnSync('cargo', ['clean'], {
      cwd: path.dirname(cargoToml),
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }
}

if (cleanGradleUserHome) {
  removePath(mobileGradleUserHome(projectRoot));
}

if (!showSize || cleanGenerated || cleanOutputs || fullAndroidClean || cleanRust || cleanGradleTransforms || cleanGradleUserHome) {
  console.log(cleanRust
    ? 'Android and Rust build artifacts cleaned.'
    : 'Android generated/Gradle artifacts cleaned. Rust target cache was preserved.');
}
