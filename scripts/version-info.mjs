import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function findRepoRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, 'aube-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

export function readPackageVersion(repoRoot = findRepoRoot()) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return String(packageJson.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

export function gitShortCommit(repoRoot = findRepoRoot()) {
  const explicit = process.env.NUTRINO_GIT_COMMIT || process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
  if (explicit && /^[0-9a-f]{7,40}$/i.test(explicit.trim())) return explicit.trim().slice(0, 12);
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || 'local';
  } catch {
    return 'local';
  }
}

export function resolveVersionInfo(options = {}) {
  const repoRoot = findRepoRoot(options.startDir || process.cwd());
  const releaseVersion = readPackageVersion(repoRoot);
  const commit = gitShortCommit(repoRoot);
  return {
    repoRoot,
    releaseVersion,
    commit,
    devVersion: `0.0.0-dev-${commit}`,
  };
}
