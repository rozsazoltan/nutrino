#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const mode = process.argv[2] || 'check';

const commandName = (command) => {
  if (process.platform !== 'win32') return command;
  if (command === 'aube') return 'aube.cmd';
  return command;
};

function run(command, args = []) {
  const display = [command, ...args].join(' ');
  console.log(`\n> ${display}`);
  const result = spawnSync(commandName(command), args, {
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  if (result.error) {
    console.error(`Failed to run: ${display}`);
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) process.exit(result.status ?? 1);
}

const tasks = {
  fix: [
    ['aube', ['run', 'format:js']],
    ['aube', ['run', 'format:rust']],
  ],
  check: [
    ['aube', ['run', 'format:js:check']],
    ['aube', ['run', 'format:rust:check']],
    ['aube', ['run', 'test:js']],
    ['aube', ['run', 'test:app']],
    ['aube', ['run', 'test:rust']],
    ['aube', ['run', 'check:i18n']],
    ['aube', ['run', 'check:android-mainactivity-bridge']],
    ['aube', ['run', 'check:release-workflows']],
  ],
  'pre-commit': [
    ['aube', ['run', 'format:js']],
    ['aube', ['run', 'format:rust']],
  ],
  'pre-push': [
    ['aube', ['run', 'test:js']],
    ['aube', ['run', 'test:app']],
    ['aube', ['run', 'test:rust']],
    ['aube', ['run', 'check:i18n']],
    ['aube', ['run', 'check:android-mainactivity-bridge']],
    ['aube', ['run', 'check:release-workflows']],
  ],
};

if (!tasks[mode]) {
  console.error(`Unknown quality mode: ${mode}`);
  console.error(`Expected one of: ${Object.keys(tasks).join(', ')}`);
  process.exit(1);
}

for (const [command, args] of tasks[mode]) run(command, args);
