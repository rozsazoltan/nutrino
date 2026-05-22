#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEV_APPLICATION_ID, STABLE_APPLICATION_ID } from './android-channel.mjs';

function exists(p) { return fs.existsSync(p); }
function run(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  return result.stdout?.trim() || result.stderr?.trim() || 'not available';
}
function read(p) { return exists(p) ? fs.readFileSync(p, 'utf8') : ''; }

const androidDir = path.join(process.cwd(), 'src-tauri', 'gen', 'android');
const gradleProps = path.join(androidDir, 'gradle.properties');
const appGradle = [path.join(androidDir, 'app', 'build.gradle.kts'), path.join(androidDir, 'app', 'build.gradle')].find(exists);
const manifest = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
const mainActivities = exists(path.join(androidDir, 'app', 'src', 'main', 'java'))
  ? fs.readdirSync(path.join(androidDir, 'app', 'src', 'main', 'java'), { recursive: true }).filter((name) => String(name).endsWith('MainActivity.kt'))
  : [];
const slowCargoConfigs = [
  path.join(process.cwd(), '.cargo', 'config.toml'),
  path.join(process.cwd(), 'src-tauri', '.cargo', 'config.toml'),
].filter(exists);
const gradleText = read(gradleProps);
const appGradleText = appGradle ? read(appGradle) : '';
const tauriText = read(path.join(process.cwd(), 'src-tauri', 'tauri.conf.json'));

console.log('Nutrino mobile Android doctor\n');
console.log(`Platform: ${os.platform()} ${os.release()}`);
console.log(`CPU cores detected: ${os.cpus()?.length || 'unknown'}`);
console.log(`Node: ${process.version}`);
console.log(`pnpm: ${run('pnpm', ['--version'])}`);
console.log(`tauri: ${run('pnpm', ['tauri', '--version'])}`);
console.log(`JAVA_HOME: ${process.env.JAVA_HOME || 'not set'}`);
console.log(`ANDROID_HOME: ${process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || 'not set'}`);
console.log(`NDK_HOME: ${process.env.NDK_HOME || 'not set'}`);
console.log(`Android project: ${exists(androidDir) ? 'generated' : 'missing'}`);
console.log(`Tauri config: ${exists(path.join(process.cwd(), 'src-tauri', 'tauri.conf.json')) ? 'ok' : 'missing'}`);

console.log('\nChannel separation:');
console.log(`Stable package ID: ${STABLE_APPLICATION_ID}`);
console.log(`Dev package ID:    ${DEV_APPLICATION_ID}`);
console.log(`Tauri identifier:  ${tauriText.match(/"identifier"\s*:\s*"([^"]+)"/)?.[1] || 'unknown'}`);
console.log(`Gradle applicationId contains stable/dev package: ${appGradleText.includes(STABLE_APPLICATION_ID) ? 'yes' : 'no'}`);
console.log(`MainActivity files: ${mainActivities.length || 'none detected'}`);
console.log(`Manifest exists: ${exists(manifest) ? 'yes' : 'no'}`);

console.log('\nBuild performance checks:');
console.log(`Slow Cargo config files: ${slowCargoConfigs.length ? slowCargoConfigs.join(', ') : 'none'}`);
console.log(`Gradle workers forced to 1: ${/org\.gradle\.workers\.max\s*=\s*1\b/.test(gradleText) ? 'yes - run pnpm android:patch' : 'no'}`);
console.log(`Kotlin incremental disabled intentionally: ${/kotlin\.incremental\s*=\s*false\b/.test(gradleText) ? 'yes' : 'no'}`);

console.log('\nExpected first run:');
console.log('  pnpm install');
console.log('  pnpm android:init');
console.log('  cd ../.. && pnpm dev:android -- --host 192.168.1.202');
console.log('\nStable APK build from repository root:');
console.log('  cd ../.. && pnpm build:android');
