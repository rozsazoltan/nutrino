#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const androidDir = path.join(projectRoot, 'src-tauri', 'gen', 'android');
const args = new Set(process.argv.slice(2));
const cleanGenerated = args.has('--generated');
const cleanRust = args.has('--all') || args.has('--rust');
const cleanGradleTransforms = args.has('--gradle-transforms');
const gradlew = process.platform === 'win32'
  ? path.join(androidDir, 'gradlew.bat')
  : path.join(androidDir, 'gradlew');

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

stopGradleDaemon();

if (cleanGenerated) {
  removePath(androidDir, 'Removing generated Android project');
} else {
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

console.log(cleanRust
  ? 'Android and Rust build artifacts cleaned.'
  : 'Android generated/Gradle artifacts cleaned. Rust target cache was preserved.');
