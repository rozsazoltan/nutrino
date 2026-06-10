#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const hooksDir = path.join(root, '.githooks');

function commandName(command) {
  if (process.platform !== 'win32') return command;
  if (command === 'git') return 'git.exe';
  return command;
}

function run(command, args) {
  const result = spawnSync(commandName(command), args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} ${args.join(' ')} failed`).trim());
  }
  return result.stdout.trim();
}

function writeHook(name, script) {
  const file = path.join(hooksDir, name);
  fs.writeFileSync(file, script.replace(/^\n/, ''), 'utf8');
  fs.chmodSync(file, 0o755);
}

try {
  run('git', ['rev-parse', '--is-inside-work-tree']);
} catch {
  console.error('Git hooks can only be installed inside a Git repository.');
  process.exit(1);
}

fs.mkdirSync(hooksDir, { recursive: true });

writeHook(
  'pre-commit',
  `#!/usr/bin/env sh
set -eu
exec aube run pre-commit
`,
);

writeHook(
  'pre-push',
  `#!/usr/bin/env sh
set -eu
exec aube run pre-push
`,
);

run('git', ['config', 'core.hooksPath', '.githooks']);

console.log('Git hooks installed in .githooks.');
console.log('pre-commit: formats JavaScript and Rust files.');
console.log('pre-push: runs JavaScript, app-domain, Rust, i18n, Android bridge, and release workflow checks.');
