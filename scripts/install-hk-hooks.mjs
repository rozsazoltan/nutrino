#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function run(command, { optional = false } = {}) {
  const result = spawnSync(command, {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    stdio: optional ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  });

  if (result.error) {
    if (optional) return false;
    throw result.error;
  }

  if (result.status !== 0) {
    if (optional) return false;
    process.exit(result.status ?? 1);
  }

  return true;
}

if (!run('git rev-parse --is-inside-work-tree', { optional: true })) {
  console.error('Git hooks can only be installed inside a Git repository.');
  process.exit(1);
}

const legacyHooksDir = path.join(root, '.githooks');
if (fs.existsSync(legacyHooksDir)) {
  fs.rmSync(legacyHooksDir, { recursive: true, force: true });
}

run('git config --local --unset core.hooksPath', { optional: true });
run('mise exec -- hk install');

console.log('hk Git hooks installed.');
console.log('pre-commit: formats JavaScript and Rust files.');
console.log('pre-push: runs JavaScript, app-domain, Rust, i18n, Android bridge, and release workflow checks.');
