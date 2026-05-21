#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { channelConfig, parseChannel, stripChannelArgs } from './android-channel.mjs';

const projectRoot = process.cwd();
const androidDir = path.join(projectRoot, 'src-tauri', 'gen', 'android');

function cpuCount() {
  return Math.max(2, Math.min(os.cpus()?.length || 4, 8));
}

function cleanEnv(channel) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key || key.includes('=') || value === undefined || String(value).includes('\u0000')) continue;
    env[key] = String(value);
  }

  env.NUTRINO_ANDROID_CHANNEL = channel;
  env.CARGO_BUILD_JOBS = env.CARGO_BUILD_JOBS || String(cpuCount());
  env.CARGO_INCREMENTAL = env.CARGO_INCREMENTAL || '1';
  env.GRADLE_OPTS = [
    env.GRADLE_OPTS || '',
    '-Dorg.gradle.daemon=true',
    '-Dorg.gradle.parallel=true',
    '-Dorg.gradle.caching=true',
    // Avoid Kotlin incremental cache crashes on Windows when Tauri plugin sources
    // are in the Cargo registry on a different drive than the generated Android project.
    '-Dkotlin.incremental=false',
    '-Dkotlin.incremental.useClasspathSnapshot=false',
    '-Dkotlin.compiler.execution.strategy=in-process',
    `-Dorg.gradle.workers.max=${cpuCount()}`,
  ].filter(Boolean).join(' ');

  return env;
}

function patchGeneratedAndroidProject(channel) {
  const script = path.join(projectRoot, 'scripts', 'patch-android-generated.mjs');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, '--channel', channel], {
      stdio: 'inherit',
      env: { ...process.env, NUTRINO_ANDROID_CHANNEL: channel },
    });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

if (!fs.existsSync(androidDir)) {
  console.error(`\nAndroid project is missing: ${androidDir}`);
  console.error('Run this once first:');
  console.error('  pnpm android:init\n');
  process.exit(1);
}

const originalArgs = process.argv.slice(2);
const channel = parseChannel(originalArgs);
const config = channelConfig(channel);
const args = stripChannelArgs(originalArgs);
if (!args.length) {
  args.push('--apk', '--debug', '--target', 'aarch64');
}

const patchCode = await patchGeneratedAndroidProject(channel);
if (patchCode !== 0) process.exit(patchCode);

console.log('\nStarting Nutrino Android build');
console.log(`Channel: ${config.channel} package (${config.applicationId})`);
console.log(`App label: ${config.label}`);
console.log(`Command: pnpm tauri android build ${args.join(' ')}`);
const isApkBuild = args.includes('--apk');
const isDebugBuild = args.includes('--debug') || args.includes('-d');
const targetValues = args.flatMap((arg, index) => (arg === '--target' && args[index + 1] ? [args[index + 1]] : []));
const keystorePropertiesPath = path.join(androidDir, 'keystore.properties');

console.log(isDebugBuild
  ? 'Debug APK build: fast and installable for development, but larger than release.'
  : 'Release build: optimized for size. A real keystore is recommended for distribution.');
console.log(targetValues.length ? `Native targets: ${targetValues.join(', ')}` : 'Native targets: all supported ABIs (larger and slower).');
console.log('Use pnpm android:dev for live Vite development, pnpm android:apk for a packaged offline Nutrino Dev APK, pnpm android:apk:stable for the stable aarch64 release APK, or pnpm android:aab for the Play Store oriented stable AAB.');
if (isApkBuild && !isDebugBuild && !fs.existsSync(keystorePropertiesPath)) {
  console.warn('\nWarning: no src-tauri/gen/android/keystore.properties file found.');
  console.warn('Nutrino will sign the local release APK with Android debug signing as a sideload fallback.');
  console.warn('Configure keystore.properties before publishing to a store.\n');
}
console.log('');

const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
const commandArgs = process.platform === 'win32'
  ? ['/d', '/s', '/c', `pnpm tauri android build ${args.join(' ')}`]
  : ['tauri', 'android', 'build', ...args];

const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  env: cleanEnv(channel),
});

child.on('error', (error) => {
  console.error('\nFailed to start Tauri Android build:');
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
