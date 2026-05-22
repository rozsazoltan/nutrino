#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { DEV_APPLICATION_ID, channelConfig } from './android-channel.mjs';

function parseExplicitHost(argv) {
  const args = argv.slice(2).filter(Boolean);
  const hostIndex = args.findIndex((arg) => arg === '--host' || arg === '-h');
  if (hostIndex >= 0 && args[hostIndex + 1]) return args[hostIndex + 1];
  const inlineHost = args.find((arg) => /^\d{1,3}(\.\d{1,3}){3}$/.test(arg));
  return inlineHost || process.env.NUTRINO_ANDROID_DEV_HOST || process.env.TAURI_DEV_HOST;
}

function cpuCount() {
  return Math.max(2, Math.min(os.cpus()?.length || 4, 8));
}

function isPrivateLan(ip) {
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('10.')) return true;
  const parts = ip.split('.').map(Number);
  return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function isBadDevHost(ip) {
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('169.254.')) return true;
  if (ip.startsWith('26.')) return true;
  const parts = ip.split('.').map(Number);
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function isVirtualName(name) {
  return /radmin|vethernet|hyper-v|wsl|default switch|docker|vmware|virtualbox|loopback|tailscale|zerotier/i.test(name);
}

function isPreferredName(name) {
  return /wi-?fi|wireless|wlan|ethernet|lan/i.test(name) && !isVirtualName(name);
}

function candidates() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, entries = []]) => entries
      .filter((entry) => entry.family === 'IPv4' && !entry.internal)
      .map((entry) => ({
        name,
        address: entry.address,
        privateLan: isPrivateLan(entry.address),
        bad: isBadDevHost(entry.address),
        virtual: isVirtualName(name),
        preferred: isPreferredName(name),
      })))
    .sort((a, b) => {
      const score = (item) => {
        let value = 0;
        if (item.privateLan) value += 100;
        if (item.preferred) value += 80;
        if (item.address.startsWith('192.168.')) value += 40;
        if (item.address.startsWith('10.')) value += 20;
        if (item.virtual) value -= 500;
        if (item.bad) value -= 1000;
        return value;
      };
      return score(b) - score(a) || a.address.localeCompare(b.address);
    });
}

function ensureAndroidProjectExists() {
  const androidDir = path.join(process.cwd(), 'src-tauri', 'gen', 'android');
  if (!fs.existsSync(androidDir)) {
    console.error(`\nAndroid project is missing: ${androidDir}`);
    console.error('Run this once first:');
    console.error('  pnpm init:android');
    console.error('or from apps/mobile:');
    console.error('  pnpm android:init\n');
    process.exit(1);
  }
}

function androidGeneratedKotlinDir(applicationId) {
  return path.join(process.cwd(), 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'java', ...applicationId.split('.'), 'generated');
}


function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function hashFileIfExists(hash, relativePath) {
  const filePath = path.join(process.cwd(), relativePath);
  hash.update(`file=${relativePath}\n`);
  if (fs.existsSync(filePath)) hash.update(fs.readFileSync(filePath));
  hash.update('\n');
}

function currentDevIdentityHash(config) {
  const hash = crypto.createHash('sha256');
  hash.update('devStateVersion=2\n');
  hash.update(`applicationId=${config.applicationId}\n`);
  hash.update(`channel=${config.channel}\n`);
  hash.update(`label=${config.label}\n`);
  for (const relative of [
    'package.json',
    'src-tauri/Cargo.toml',
    'src-tauri/build.rs',
    'src-tauri/tauri.conf.json',
    'scripts/android-channel.mjs',
    'scripts/patch-android-generated.mjs',
  ]) {
    hashFileIfExists(hash, relative);
  }
  return hash.digest('hex');
}

function removePathIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) return false;
  console.log(`Removing stale Android dev artifact: ${targetPath}`);
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function stopGradleDaemon(androidDir) {
  const gradlew = process.platform === 'win32'
    ? path.join(androidDir, 'gradlew.bat')
    : path.join(androidDir, 'gradlew');
  if (!fs.existsSync(gradlew)) return;
  console.log('Stopping generated Android Gradle daemon before version-sensitive dev rebuild');
  spawnSync(gradlew, ['--stop'], {
    cwd: androidDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

function prepareVersionSensitiveDevState(config) {
  const androidDir = path.join(process.cwd(), 'src-tauri', 'gen', 'android');
  if (!fs.existsSync(androidDir)) return false;

  const statePath = path.join(androidDir, '.nutrino-android-dev-state.json');
  const packageJson = readJsonIfExists(path.join(process.cwd(), 'package.json'));
  const nextState = {
    devStateVersion: 2,
    channel: config.channel,
    applicationId: config.applicationId,
    label: config.label,
    appVersion: packageJson?.version ?? null,
    devIdentityHash: currentDevIdentityHash(config),
  };
  const previous = readJsonIfExists(statePath);
  const needsClean = !previous
    || previous.devStateVersion !== nextState.devStateVersion
    || previous.channel !== nextState.channel
    || previous.applicationId !== nextState.applicationId
    || previous.label !== nextState.label
    || previous.appVersion !== nextState.appVersion
    || previous.devIdentityHash !== nextState.devIdentityHash;

  if (!needsClean) return false;

  console.log('Android dev identity/version changed; cleaning stale native/Gradle state before starting dev.');
  stopGradleDaemon(androidDir);
  removePathIfExists(path.join(process.cwd(), 'src-tauri', 'target'));
  removePathIfExists(path.join(androidDir, 'app', 'build'));
  removePathIfExists(path.join(androidDir, 'build'));
  removePathIfExists(path.join(androidDir, '.gradle'));
  removePathIfExists(path.join(androidDir, 'app', '.gradle'));
  removePathIfExists(path.join(androidDir, 'kotlin'));
  removePathIfExists(path.join(androidDir, 'app', 'src', 'main', 'jniLibs'));
  removePathIfExists(path.join(androidDir, '.nutrino-android-native-state.json'));
  fs.writeFileSync(statePath, `${JSON.stringify(nextState, null, 2)}
`);
  return true;
}

function cleanEnv(host) {
  const env = {};
  const config = channelConfig('dev');
  for (const [key, value] of Object.entries(process.env)) {
    if (!key || key.includes('=') || value === undefined || String(value).includes('\u0000')) continue;
    env[key] = String(value);
  }

  env.TAURI_DEV_HOST = host;
  env.NUTRINO_ANDROID_CHANNEL = config.channel;
  env.VITE_NUTRINO_CHANNEL = config.channel;
  env.VITE_NUTRINO_APP_NAME = config.label;
  env.TAURI_ANDROID_PACKAGE_UNESCAPED = config.applicationId;
  env.WRY_ANDROID_PACKAGE = config.applicationId;
  env.WRY_ANDROID_LIBRARY = 'nutrino_mobile_lib';
  env.WRY_ANDROID_KOTLIN_FILES_OUT_DIR = androidGeneratedKotlinDir(config.applicationId);
  env.NUTRINO_ANDROID_DEV_HOST = host;
  env.NUTRINO_DEV_API_BASE_URL = `http://${host}:8090/api/v1`;
  env.CARGO_BUILD_JOBS = env.CARGO_BUILD_JOBS || String(cpuCount());
  env.CARGO_INCREMENTAL = env.CARGO_INCREMENTAL || '1';
  env.GRADLE_OPTS = [
    env.GRADLE_OPTS || '',
    '-Dorg.gradle.daemon=true',
    '-Dorg.gradle.parallel=true',
    '-Dorg.gradle.caching=true',
    '-Dkotlin.incremental=false',
    '-Dkotlin.incremental.useClasspathSnapshot=false',
    '-Dkotlin.compiler.execution.strategy=in-process',
    `-Dorg.gradle.workers.max=${cpuCount()}`,
  ].filter(Boolean).join(' ');

  return env;
}

function patchGeneratedAndroidProject() {
  const script = path.join(process.cwd(), 'scripts', 'patch-android-generated.mjs');
  const result = spawn(process.execPath, [script, '--channel', 'dev'], {
    stdio: 'inherit',
    env: { ...process.env, NUTRINO_ANDROID_CHANNEL: 'dev' },
  });
  return new Promise((resolve) => {
    result.on('exit', (code) => resolve(code ?? 0));
    result.on('error', () => resolve(1));
  });
}

const explicitHost = parseExplicitHost(process.argv);
const list = candidates();
const selected = explicitHost
  ? { address: explicitHost, name: 'explicit host' }
  : list.find((item) => item.privateLan && !item.bad && !item.virtual && item.preferred)
    ?? list.find((item) => item.privateLan && !item.bad && !item.virtual)
    ?? list.find((item) => item.privateLan && !item.bad)
    ?? list[0];

const host = selected?.address;
console.log('\nNutrino Android dev host selection');
console.log('Available IPv4 addresses:');
for (const item of list) {
  const marker = item.address === host ? ' < selected' : '';
  const notes = [item.virtual ? 'virtual' : '', item.bad ? 'ignored' : ''].filter(Boolean).join(', ');
  console.log(`- ${item.address.padEnd(15)} ${item.name}${notes ? ` (${notes})` : ''}${marker}`);
}

if (!host) {
  console.error('\nNo usable LAN IPv4 address was detected.');
  console.error('Run: pnpm android:dev -- --host 192.168.1.50');
  process.exit(1);
}

ensureAndroidProjectExists();
const patchCode = await patchGeneratedAndroidProject();
if (patchCode !== 0) process.exit(patchCode);
prepareVersionSensitiveDevState(channelConfig('dev'));

console.log(`\nStarting Tauri Android dev with host ${host}`);
console.log(`Dev package: ${DEV_APPLICATION_ID}`);
console.log('If this is not your Wi-Fi/LAN IP, stop it and run:');
console.log('  pnpm android:dev -- --host <your-desktop-lan-ip>\n');

const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
const args = process.platform === 'win32'
  ? ['/d', '/s', '/c', `pnpm tauri android dev --host ${host}`]
  : ['tauri', 'android', 'dev', '--host', host];

const child = spawn(command, args, {
  stdio: 'inherit',
  env: cleanEnv(host),
});

child.on('error', (error) => {
  console.error('\nFailed to start Tauri Android dev:');
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
