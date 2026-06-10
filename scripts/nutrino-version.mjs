import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function findRepoRoot(startDir = process.cwd()) {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, 'aube-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

export function packageVersion(repoRoot = findRepoRoot()) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const version = String(data.version || '').trim();
    if (version) return version;
  } catch {}
  return '0.0.0';
}

export function gitCommitHash(repoRoot = findRepoRoot()) {
  const explicit = String(process.env.NUTRINO_DEV_COMMIT || '').trim();
  if (explicit) return explicit.slice(0, 12);

  const githubSha = String(process.env.GITHUB_SHA || '').trim();
  if (githubSha) return githubSha.slice(0, 12);

  const result = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const hash = String(result.stdout || '').trim();
  return hash || 'local';
}

export function devVersion(repoRoot = findRepoRoot()) {
  return `0.0.0-dev-${gitCommitHash(repoRoot)}`;
}

export function normalizeChannel(value, fallback = 'stable') {
  const channel = String(value || fallback || '').toLowerCase();
  return channel === 'dev' ? 'dev' : 'stable';
}

export function appVersionForEnv({ repoRoot = findRepoRoot(), channel = 'stable', devMode = false } = {}) {
  const explicit = String(process.env.NUTRINO_APP_VERSION || process.env.VITE_NUTRINO_APP_VERSION || '').trim();
  if (explicit) return explicit;
  return normalizeChannel(channel, devMode ? 'dev' : 'stable') === 'dev' || devMode
    ? devVersion(repoRoot)
    : packageVersion(repoRoot);
}

export function applyNutrinoVersionEnv(env, { repoRoot = findRepoRoot(), channel = 'stable', devMode = false } = {}) {
  const normalizedChannel = normalizeChannel(channel, devMode ? 'dev' : 'stable');
  const version = appVersionForEnv({ repoRoot, channel: normalizedChannel, devMode });
  env.NUTRINO_APP_CHANNEL = normalizedChannel;
  env.VITE_NUTRINO_CHANNEL = normalizedChannel;
  env.NUTRINO_APP_VERSION = version;
  env.VITE_NUTRINO_APP_VERSION = version;
  return { channel: normalizedChannel, version };
}
