#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = process.cwd();
const androidDir = path.join(projectRoot, 'src-tauri', 'gen', 'android');
const gradlew = process.platform === 'win32'
  ? path.join(androidDir, 'gradlew.bat')
  : path.join(androidDir, 'gradlew');

if (fs.existsSync(gradlew)) {
  console.log('Stopping generated Android Gradle daemon');
  spawnSync(gradlew, ['--stop'], {
    cwd: androidDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

const paths = [
  path.join(projectRoot, 'src-tauri', 'target'),
  path.join(androidDir, 'app', 'build'),
  path.join(androidDir, 'build'),
  path.join(androidDir, '.gradle'),
  path.join(androidDir, 'app', '.gradle'),
  path.join(androidDir, 'kotlin'),
  path.join(androidDir, 'app', 'src', 'main', 'jniLibs'),
  path.join(androidDir, '.nutrino-android-native-state.json'),
  path.join(androidDir, '.nutrino-android-dev-state.json'),
];

for (const target of paths) {
  if (!fs.existsSync(target)) continue;
  console.log(`Removing ${target}`);
  fs.rmSync(target, { recursive: true, force: true });
}

const cargoToml = path.join(projectRoot, 'src-tauri', 'Cargo.toml');
if (fs.existsSync(cargoToml)) {
  console.log('Running cargo clean for mobile Rust crate');
  spawnSync('cargo', ['clean'], {
    cwd: path.dirname(cargoToml),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

console.log('Android build artifacts cleaned.');
