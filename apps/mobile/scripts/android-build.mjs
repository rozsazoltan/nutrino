#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { channelConfig, parseChannel, stripChannelArgs } from './android-channel.mjs';
import { mobileCargoTargetDir, mobileGradleUserHome, archiveAndroidPackageOutputs, pruneAndroidPackageOutputs, formatBytes } from './android-artifacts.mjs';

const projectRoot = process.cwd();
const androidDir = path.join(projectRoot, 'src-tauri', 'gen', 'android');

function cpuCount() {
  return Math.max(2, Math.min(os.cpus()?.length || 4, 8));
}

function androidGeneratedKotlinDir(applicationId) {
  return path.join(projectRoot, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'java', ...applicationId.split('.'), 'generated');
}

function runAndroidInit(channel) {
  const script = path.join(projectRoot, 'scripts', 'android-init.mjs');
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, '--channel', channel], {
      stdio: 'inherit',
      env: { ...process.env, NUTRINO_ANDROID_CHANNEL: channel },
    });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

async function ensureAndroidProjectExists(channel) {
  if (fs.existsSync(androidDir)) return;

  const config = channelConfig(channel);
  console.log(`\nAndroid project is missing, generating ${config.channel} project first: ${androidDir}`);
  const initCode = await runAndroidInit(channel);
  if (initCode !== 0) process.exit(initCode);
}

function cleanEnv(channel) {
  const env = {};
  const config = channelConfig(channel);
  for (const [key, value] of Object.entries(process.env)) {
    if (!key || key.includes('=') || value === undefined || String(value).includes('\u0000')) continue;
    env[key] = String(value);
  }

  env.NUTRINO_ANDROID_CHANNEL = config.channel;
  env.VITE_NUTRINO_CHANNEL = config.channel;
  env.VITE_NUTRINO_APP_NAME = config.label;
  env.TAURI_ANDROID_PACKAGE_UNESCAPED = config.applicationId;
  env.WRY_ANDROID_PACKAGE = config.applicationId;
  env.WRY_ANDROID_LIBRARY = 'nutrino_mobile_lib';
  env.WRY_ANDROID_KOTLIN_FILES_OUT_DIR = androidGeneratedKotlinDir(config.applicationId);
  env.CARGO_BUILD_JOBS = env.CARGO_BUILD_JOBS || String(cpuCount());
  env.CARGO_INCREMENTAL = env.CARGO_INCREMENTAL || '1';
  env.CARGO_TARGET_DIR = env.CARGO_TARGET_DIR || mobileCargoTargetDir(projectRoot);
  env.GRADLE_USER_HOME = env.GRADLE_USER_HOME || mobileGradleUserHome(projectRoot);
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

const originalArgs = process.argv.slice(2);
const channel = parseChannel(originalArgs);
await ensureAndroidProjectExists(channel);
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
console.log(`Command: aube run tauri -- android build ${args.join(' ')}`);
const isApkBuild = args.includes('--apk');
const isDebugBuild = args.includes('--debug') || args.includes('-d');
const targetValues = args.flatMap((arg, index) => (arg === '--target' && args[index + 1] ? [args[index + 1]] : []));
const keystorePropertiesPath = path.join(androidDir, 'keystore.properties');
const androidEnv = cleanEnv(channel);

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}

function escapePropertiesValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function materializeReleaseKeystoreFromEnv() {
  if (config.channel !== 'stable' || isDebugBuild) return false;
  if (fs.existsSync(keystorePropertiesPath)) return false;

  const storeBase64 = envValue('NUTRINO_ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_BASE64');
  const storePassword = envValue('NUTRINO_ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEYSTORE_PASSWORD');
  const keyAlias = envValue('NUTRINO_ANDROID_KEY_ALIAS', 'ANDROID_KEY_ALIAS');
  const keyPassword = envValue('NUTRINO_ANDROID_KEY_PASSWORD', 'ANDROID_KEY_PASSWORD') || storePassword;
  const provided = [storeBase64, storePassword, keyAlias, keyPassword].some(Boolean);

  if (!provided) return false;
  if (!storeBase64 || !storePassword || !keyAlias || !keyPassword) {
    console.error('\nAndroid release signing is partially configured.');
    console.error('Set NUTRINO_ANDROID_KEYSTORE_BASE64, NUTRINO_ANDROID_KEYSTORE_PASSWORD, NUTRINO_ANDROID_KEY_ALIAS and NUTRINO_ANDROID_KEY_PASSWORD, or remove all of them to use the local debug fallback.');
    process.exit(1);
  }

  const keystoreFileName = 'nutrino-release-keystore.jks';
  const keystorePath = path.join(androidDir, keystoreFileName);
  fs.mkdirSync(androidDir, { recursive: true });
  fs.writeFileSync(keystorePath, Buffer.from(storeBase64, 'base64'));
  fs.writeFileSync(keystorePropertiesPath, [
    `storeFile=${keystoreFileName}`,
    `storePassword=${escapePropertiesValue(storePassword)}`,
    `keyAlias=${escapePropertiesValue(keyAlias)}`,
    `keyPassword=${escapePropertiesValue(keyPassword)}`,
    '',
  ].join('\n'));
  console.log('Android release signing: keystore.properties created from environment secrets.');
  return true;
}

const envKeystoreCreated = materializeReleaseKeystoreFromEnv();

console.log(isDebugBuild
  ? 'Debug APK build: fast and installable for development, but larger than release.'
  : 'Release build: optimized for size. A real keystore is recommended for distribution.');
console.log(targetValues.length ? `Native targets: ${targetValues.join(', ')}` : 'Native targets: all supported ABIs (larger and slower).');
console.log(`Cargo target cache: ${androidEnv.CARGO_TARGET_DIR}`);
console.log(`Gradle user cache: ${androidEnv.GRADLE_USER_HOME}`);
console.log('Use root commands: aube dev:android for live Vite development or aube build:android for a stable aarch64 APK.');
if (isApkBuild && !isDebugBuild && !fs.existsSync(keystorePropertiesPath)) {
  console.warn('\nWarning: no src-tauri/gen/android/keystore.properties file found.');
  console.warn('Nutrino will sign the local release APK with Android debug signing as a sideload fallback.');
  console.warn('GitHub release APKs built this way may not install over an older stable app because Android requires the same signing key for updates.');
  console.warn('Configure keystore.properties before publishing to a store.\n');
} else if (envKeystoreCreated) {
  console.log('Stable sideload updates will keep the same Android signing identity when the same secrets are reused.');
}
console.log('');

const tauriEnvScript = path.resolve(projectRoot, '..', '..', 'scripts', 'tauri-env.mjs');
const child = spawn(process.execPath, [tauriEnvScript, 'android', 'build', ...args], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: androidEnv,
});

child.on('error', (error) => {
  console.error('\nFailed to start Tauri Android build:');
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if ((code ?? 0) === 0) {
    const copied = archiveAndroidPackageOutputs({ projectRoot, androidDir, channel: config.channel });
    if (copied.length > 0) {
      console.log('\nAndroid package artifact archive:');
      for (const item of copied) {
        console.log(`- ${item.to} (${formatBytes(item.size)})`);
      }
    }

    if (process.env.NUTRINO_ANDROID_KEEP_GENERATED_OUTPUTS !== '1' && copied.length > 0) {
      const removed = pruneAndroidPackageOutputs(androidDir);
      const total = removed.reduce((sum, item) => sum + item.size, 0);
      if (removed.length > 0) {
        console.log(`Pruned duplicate generated Android package outputs: ${formatBytes(total)}`);
      }
    }
  }
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
