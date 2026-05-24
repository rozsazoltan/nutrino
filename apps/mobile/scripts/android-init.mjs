#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { channelConfig, parseChannel } from './android-channel.mjs';
import { mobileCargoTargetDir, mobileGradleUserHome } from './android-artifacts.mjs';

const projectRoot = process.cwd();
const androidDir = path.join(projectRoot, 'src-tauri', 'gen', 'android');
const scriptsDir = path.join(projectRoot, 'scripts');
const RUNNER_STATE_VERSION = 10;

function quoteForCmd(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+\\-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
function commandSpec(command, args = []) {
  if (process.platform !== 'win32') return { command, args };
  const executable = command === 'pnpm' ? 'pnpm.cmd' : command;
  if (!/\.cmd$/i.test(executable) && !/\.bat$/i.test(executable)) return { command: executable, args };
  return { command: 'cmd.exe', args: ['/d', '/s', '/c', [executable, ...args].map(quoteForCmd).join(' ')] };
}
function run(command, args, options = {}) {
  const spec = commandSpec(command, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd: options.cwd || projectRoot,
    env: options.env || process.env,
    stdio: options.stdio || 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function removePath(targetPath, label = 'Removing') {
  if (!fs.existsSync(targetPath)) return false;
  console.log(`${label}: ${targetPath}`);
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}
function stopGradleDaemon() {
  const gradlew = process.platform === 'win32' ? path.join(androidDir, 'gradlew.bat') : path.join(androidDir, 'gradlew');
  if (!fs.existsSync(gradlew)) return;
  const spec = commandSpec(gradlew, ['--stop']);
  spawnSync(spec.command, spec.args, { cwd: androidDir, stdio: 'inherit', shell: false });
}
function cpuCount() { return Math.max(2, Math.min(os.cpus()?.length || 4, 8)); }
function envForAndroid(channel) {
  const env = { ...process.env };
  const config = channelConfig(channel);
  env.NUTRINO_ANDROID_CHANNEL = config.channel;
  env.VITE_NUTRINO_CHANNEL = config.channel;
  env.VITE_NUTRINO_APP_NAME = config.label;
  env.TAURI_ANDROID_PACKAGE_UNESCAPED = config.applicationId;
  env.WRY_ANDROID_PACKAGE = config.applicationId;
  env.WRY_ANDROID_LIBRARY = 'nutrino_mobile_lib';
  env.WRY_ANDROID_KOTLIN_FILES_OUT_DIR = path.join(androidDir, 'app', 'src', 'main', 'java', ...config.applicationId.split('.'), 'generated');
  env.CARGO_BUILD_JOBS = env.CARGO_BUILD_JOBS || String(cpuCount());
  env.CARGO_INCREMENTAL = env.CARGO_INCREMENTAL || '1';
  env.CARGO_TARGET_DIR = env.CARGO_TARGET_DIR || mobileCargoTargetDir(projectRoot);
  env.GRADLE_USER_HOME = env.GRADLE_USER_HOME || mobileGradleUserHome(projectRoot);
  return env;
}
function writeGeneratedState(config) {
  fs.writeFileSync(path.join(androidDir, '.nutrino-android-generated-state.json'), `${JSON.stringify({
    runnerStateVersion: RUNNER_STATE_VERSION,
    channel: config.channel,
    applicationId: config.applicationId,
    label: config.label,
  }, null, 2)}\n`);
}

const channel = parseChannel(process.argv.slice(2), 'stable');
const config = channelConfig(channel);
console.log(`Preparing Android project for ${config.channel} (${config.applicationId})`);

run(process.execPath, [path.join(scriptsDir, 'android-channel.mjs'), '--channel', channel], { env: { ...process.env, NUTRINO_ANDROID_CHANNEL: channel } });
if (fs.existsSync(androidDir)) {
  stopGradleDaemon();
  removePath(androidDir, 'Removing old generated Android project');
}
run('pnpm', ['tauri', 'android', 'init'], { env: envForAndroid(channel) });
run(process.execPath, [path.join(scriptsDir, 'patch-android-generated.mjs'), '--channel', channel], { env: { ...process.env, NUTRINO_ANDROID_CHANNEL: channel } });
writeGeneratedState(config);
console.log(`Android project initialized for ${config.channel}.`);
