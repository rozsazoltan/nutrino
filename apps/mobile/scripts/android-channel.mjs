#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STABLE_APPLICATION_ID = 'net.datarose.nutrino.mobile';
export const DEV_APPLICATION_ID = `${STABLE_APPLICATION_ID}.dev`;
export const STABLE_LABEL = 'Nutrino';
export const DEV_LABEL = 'Nutrino Dev';

export function normalizeChannel(value) {
  return value === 'stable' || value === 'release' ? 'stable' : 'dev';
}

export function parseChannel(argv = process.argv.slice(2), fallback = process.env.NUTRINO_ANDROID_CHANNEL || 'dev') {
  const index = argv.findIndex((arg) => arg === '--channel');
  const value = index >= 0 ? argv[index + 1] : fallback;
  return normalizeChannel(value);
}

export function stripChannelArgs(argv = process.argv.slice(2)) {
  const index = argv.findIndex((arg) => arg === '--channel');
  if (index < 0) return argv;
  return argv.filter((_, i) => i !== index && i !== index + 1);
}

export function channelConfig(channelValue) {
  const channel = normalizeChannel(channelValue);
  return {
    channel,
    applicationId: channel === 'stable' ? STABLE_APPLICATION_ID : DEV_APPLICATION_ID,
    label: channel === 'stable' ? STABLE_LABEL : DEV_LABEL,
    productName: channel === 'stable' ? STABLE_LABEL : DEV_LABEL,
  };
}

export function patchTauriConfig(projectRoot, channelValue) {
  const config = channelConfig(channelValue);
  const tauriConfigPath = path.join(projectRoot, 'src-tauri', 'tauri.conf.json');
  if (!fs.existsSync(tauriConfigPath)) {
    throw new Error(`Missing Tauri config: ${tauriConfigPath}`);
  }

  const source = fs.readFileSync(tauriConfigPath, 'utf8');
  const data = JSON.parse(source);
  const before = JSON.stringify(data);

  data.productName = config.productName;
  data.identifier = config.applicationId;

  fs.writeFileSync(tauriConfigPath, `${JSON.stringify(data, null, 2)}\n`);
  return { changed: before !== JSON.stringify(data), config, path: tauriConfigPath };
}

function runCli() {
  const projectRoot = process.cwd();
  const channel = parseChannel();
  const result = patchTauriConfig(projectRoot, channel);
  console.log(`Android channel configured: channel=${result.config.channel}, identifier=${result.config.applicationId}, productName="${result.config.productName}", tauriConfig=${result.changed ? 'patched' : 'already ok'}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runCli();
}
