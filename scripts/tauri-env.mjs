#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function findRepoRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
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

function quoteForShell(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+\\-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
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
console.log(`Tauri cache: Cargo target -> ${env.CARGO_TARGET_DIR}`);
if (env.GRADLE_USER_HOME) console.log(`Tauri cache: Gradle user home -> ${env.GRADLE_USER_HOME}`);

const child = spawn('tauri', args, {
  cwd,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('error', (error) => {
  console.error('Failed to start Tauri CLI:');
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
