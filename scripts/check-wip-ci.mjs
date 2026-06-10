#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const safeValue = String(value).replace(/\r?\n/g, ' ');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${safeValue}\n`);
}

function readHeadSubject() {
  const configuredSubject = process.env.WIP_CI_SUBJECT?.trim();
  if (configuredSubject) return configuredSubject;

  try {
    return execFileSync('git', ['log', '-1', '--format=%s'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

const subject = readHeadSubject();
const isWip = subject !== '' && /^\s*wip(?:\b|[\s:._-])/i.test(subject);

writeOutput('is_wip', isWip ? 'true' : 'false');
writeOutput('subject', subject);

if (isWip) {
  console.error(`WIP commit detected: ${subject}`);
  console.error('Skipping expensive CI jobs and blocking this run until the commit is no longer WIP.');
  process.exit(1);
}

console.log(subject === '' ? 'CI allowed: no git commit subject available.' : `CI allowed for commit: ${subject}`);
