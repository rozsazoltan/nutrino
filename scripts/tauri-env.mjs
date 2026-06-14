#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { gitShortCommit } from './version-info.mjs';

function findRepoRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, 'aube-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return startDir;
    current = parent;
  }
}

function packageName(cwd) {
  const packageJsonPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return path.basename(cwd);
  try {
    const data = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    return String(data.name || path.basename(cwd)).replace(/^nutrino-/, '') || path.basename(cwd);
  } catch {
    return path.basename(cwd);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function stopLockedDesktopDevBinary({ appName, args }) {
  if (process.platform !== 'win32') return;
  if (appName !== 'desktop') return;
  if (args[0] !== 'dev') return;

  const executable = 'nutrino_desktop.exe';
  const result = spawnSync('taskkill', ['/F', '/T', '/IM', executable], {
    stdio: 'ignore',
    windowsHide: true,
  });

  // taskkill exits non-zero when the process is not running. That is the common
  // clean state, so only log when a process was actually terminated.
  if (result.status === 0) {
    console.log(`Tauri dev: stopped stale ${executable} before rebuilding.`);
  }
}

function quoteForCmd(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+\\-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function commandSpec(command, args = []) {
  if (process.platform !== 'win32') return { command, args };
  const executable = command;
  if (!/\.cmd$/i.test(executable) && !/\.bat$/i.test(executable)) {
    return { command: executable, args };
  }
  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', [executable, ...args].map(quoteForCmd).join(' ')],
  };
}

function candidatePackageRoots(cwd, repoRoot) {
  const roots = [];
  let current = path.resolve(cwd);
  const stopAt = path.dirname(path.resolve(repoRoot));
  while (!roots.includes(current)) {
    roots.push(current);
    if (current === stopAt) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!roots.includes(repoRoot)) roots.push(repoRoot);
  return roots;
}

function packageDir(root, packageName) {
  return path.join(root, 'node_modules', ...packageName.split('/'));
}

function findPackageBin({ cwd, repoRoot, packageName: dependencyName, binName }) {
  for (const root of candidatePackageRoots(cwd, repoRoot)) {
    const dir = packageDir(root, dependencyName);
    const packageJsonPath = path.join(dir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) continue;

    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const bin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.[binName];
      if (!bin) continue;
      const binPath = path.resolve(dir, bin);
      if (fs.existsSync(binPath)) return binPath;
    } catch {
      // Try the next node_modules location.
    }
  }

  return undefined;
}

function findLocalBin({ cwd, repoRoot, binName }) {
  const names = process.platform === 'win32' ? [`${binName}.cmd`, `${binName}.bat`, binName] : [binName];
  for (const root of candidatePackageRoots(cwd, repoRoot)) {
    for (const name of names) {
      const binPath = path.join(root, 'node_modules', '.bin', name);
      if (fs.existsSync(binPath)) return binPath;
    }
  }

  return undefined;
}

function resolveTauriCommand({ cwd, repoRoot }) {
  const explicit = process.env.NUTRINO_TAURI_CLI;
  if (explicit) return commandSpec(explicit);

  const packageBin = findPackageBin({
    cwd,
    repoRoot,
    packageName: '@tauri-apps/cli',
    binName: 'tauri',
  });
  if (packageBin) {
    const extension = path.extname(packageBin).toLowerCase();
    if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
      return { command: process.execPath, args: [packageBin] };
    }
    return commandSpec(packageBin);
  }

  const localBin = findLocalBin({ cwd, repoRoot, binName: 'tauri' });
  if (localBin) return commandSpec(localBin);

  return commandSpec(process.platform === 'win32' ? 'tauri.cmd' : 'tauri');
}

const cwd = process.cwd();
const repoRoot = findRepoRoot(cwd);
const appName = packageName(cwd);
const cacheRoot = path.resolve(process.env.NUTRINO_BUILD_CACHE_DIR || path.join(repoRoot, '.cache', 'tauri'));
const env = { ...process.env };

env.CARGO_TARGET_DIR = env.CARGO_TARGET_DIR || ensureDir(path.join(cacheRoot, 'cargo-target', appName));
env.CARGO_INCREMENTAL = env.CARGO_INCREMENTAL || '1';

// Android Gradle must still build inside src-tauri/gen/android because that is
// the generated native project, but its user cache can live outside src-tauri.
if (appName === 'mobile' || process.argv.slice(2).includes('android')) {
  env.GRADLE_USER_HOME = env.GRADLE_USER_HOME || ensureDir(path.join(cacheRoot, 'gradle'));
}

const args = process.argv.slice(2);
stopLockedDesktopDevBinary({ appName, args });
const requestedChannel =
  env.NUTRINO_APP_CHANNEL ||
  env.VITE_NUTRINO_CHANNEL ||
  (args[0] === 'dev' || (args.includes('--config') && args.some((arg) => String(arg).includes('tauri.dev.conf')))
    ? 'dev'
    : 'stable');
env.NUTRINO_APP_CHANNEL = requestedChannel === 'dev' ? 'dev' : 'stable';
env.VITE_NUTRINO_CHANNEL = env.VITE_NUTRINO_CHANNEL || env.NUTRINO_APP_CHANNEL;
env.NUTRINO_GIT_COMMIT = env.NUTRINO_GIT_COMMIT || gitShortCommit(repoRoot);
console.log(`Tauri channel: ${env.NUTRINO_APP_CHANNEL}`);
console.log(`Tauri commit: ${env.NUTRINO_GIT_COMMIT}`);
console.log(`Tauri cache: Cargo target -> ${env.CARGO_TARGET_DIR}`);
if (env.GRADLE_USER_HOME) console.log(`Tauri cache: Gradle user home -> ${env.GRADLE_USER_HOME}`);

const tauriCommand = resolveTauriCommand({ cwd, repoRoot });
const child = spawn(tauriCommand.command, [...tauriCommand.args, ...args], {
  cwd,
  env,
  stdio: 'inherit',
  shell: false,
  windowsHide: false,
});

child.on('error', (error) => {
  console.error('Failed to start Tauri CLI.');
  console.error('Install dependencies with `aube install`, or set NUTRINO_TAURI_CLI to the Tauri CLI executable.');
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
