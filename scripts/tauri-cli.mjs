#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const TAURI_PACKAGE = '@tauri-apps/cli';
const TAURI_BIN = 'tauri';

function findRepoRoot(startDir) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, 'aube-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return startDir;
    current = parent;
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function hasTauriCliDependency(packageJson) {
  return Boolean(
    packageJson?.dependencies?.[TAURI_PACKAGE] ||
    packageJson?.devDependencies?.[TAURI_PACKAGE] ||
    packageJson?.optionalDependencies?.[TAURI_PACKAGE],
  );
}

function packageDirsUnder(repoRoot, parentName) {
  const parent = path.join(repoRoot, parentName);
  if (!fs.existsSync(parent)) return [];
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name))
    .filter((dir) => hasTauriCliDependency(readJson(path.join(dir, 'package.json'))));
}

function unique(items) {
  return [...new Set(items.map((item) => path.resolve(item)))];
}

function candidatePackageDirs(cwd, repoRoot) {
  const dirs = [];
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, 'package.json'))) dirs.push(current);
    if (current === repoRoot) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  dirs.push(repoRoot);
  dirs.push(...packageDirsUnder(repoRoot, 'apps'));
  dirs.push(...packageDirsUnder(repoRoot, 'packages'));

  return unique(dirs);
}

function resolvePackageBinFromPackageDir(packageRoot) {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const packageJson = readJson(packageJsonPath);
  const bin = typeof packageJson?.bin === 'string' ? packageJson.bin : packageJson?.bin?.[TAURI_BIN];
  if (!bin) return undefined;

  const binPath = path.resolve(packageRoot, bin);
  return fs.existsSync(binPath) ? binPath : undefined;
}

function resolvePackageBinWithRequire(packageDir) {
  const packageJsonPath = path.join(packageDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) return undefined;

  try {
    const require = createRequire(packageJsonPath);
    const resolvedPackageJson = require.resolve(`${TAURI_PACKAGE}/package.json`);
    return resolvePackageBinFromPackageDir(path.dirname(resolvedPackageJson));
  } catch {
    return undefined;
  }
}

function resolvePackageBinFromNodeModules(packageDir) {
  return resolvePackageBinFromPackageDir(packageDirForDependency(packageDir, TAURI_PACKAGE));
}

function packageDirForDependency(packageDir, packageName) {
  return path.join(packageDir, 'node_modules', ...packageName.split('/'));
}

function resolveLocalBin(packageDir) {
  const names = process.platform === 'win32' ? ['tauri.cmd', 'tauri.bat', 'tauri'] : ['tauri'];
  for (const name of names) {
    const binPath = path.join(packageDir, 'node_modules', '.bin', name);
    if (fs.existsSync(binPath)) return binPath;
  }
  return undefined;
}

function quoteForCmd(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=+\\-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function commandSpec(command, args = []) {
  if (process.platform !== 'win32') return { command, args };
  const extension = path.extname(command).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat') return { command, args };

  return {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', [command, ...args].map(quoteForCmd).join(' ')],
  };
}

function commandForResolvedBin(binPath) {
  const extension = path.extname(binPath).toLowerCase();
  if (extension === '.js' || extension === '.cjs' || extension === '.mjs') {
    return { command: process.execPath, args: [binPath] };
  }
  return commandSpec(binPath);
}

function resolveTauriCli({ cwd, repoRoot }) {
  const explicit = process.env.NUTRINO_TAURI_CLI;
  if (explicit) return commandSpec(explicit);

  const packageDirs = candidatePackageDirs(cwd, repoRoot);
  for (const packageDir of packageDirs) {
    const resolved =
      resolvePackageBinWithRequire(packageDir) ||
      resolvePackageBinFromNodeModules(packageDir) ||
      resolveLocalBin(packageDir);
    if (resolved) return commandForResolvedBin(resolved);
  }

  const searched = packageDirs.map((dir) => `  - ${path.relative(repoRoot, dir) || '.'}`).join('\n');

  throw new Error(
    [
      `Could not find the project-local ${TAURI_PACKAGE} CLI.`,
      '',
      'Nutrino intentionally does not use a global `tauri` command.',
      'Run `aube install`, then retry the same command.',
      '',
      'Searched package directories:',
      searched,
      '',
      'For debugging only, set NUTRINO_TAURI_CLI to an explicit executable path.',
    ].join('\n'),
  );
}

const cwd = process.cwd();
const repoRoot = findRepoRoot(cwd);
let spec;
try {
  spec = resolveTauriCli({ cwd, repoRoot });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const child = spawn(spec.command, [...spec.args, ...process.argv.slice(2)], {
  cwd,
  env: process.env,
  stdio: 'inherit',
  shell: false,
  windowsHide: false,
});

child.on('error', (error) => {
  console.error('Failed to start the project-local Tauri CLI.');
  console.error(error);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
