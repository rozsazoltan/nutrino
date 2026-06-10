#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const scriptPath = path.join(process.cwd(), 'apps', 'mobile', 'scripts', 'patch-android-generated.mjs');
const source = fs.readFileSync(scriptPath, 'utf8');

const errors = [];
if (/import\s+app\.tauri\.TauriActivity/.test(source)) {
  errors.push(
    'patch-android-generated.mjs must not import app.tauri.TauriActivity; Tauri generates TauriActivity in the app package.',
  );
}
if (!/class\s+MainActivity\s*:\s*TauriActivity\s*\(\)/.test(source)) {
  errors.push('patch-android-generated.mjs must keep MainActivity extending the generated TauriActivity.');
}
if (!/nutrino:android-back/.test(source)) {
  errors.push('patch-android-generated.mjs must keep the nutrino:android-back native event bridge.');
}
if (!/configureEdgeToEdgeWindow/.test(source) || !/statusBarColor\s*=\s*Color\.TRANSPARENT/.test(source)) {
  errors.push('patch-android-generated.mjs must keep the Android edge-to-edge transparent status bar setup.');
}

if (!/function\s+patchBuildSrcAndroidRustBuildTask/.test(source)) {
  errors.push('patch-android-generated.mjs must patch the generated Android BuildTask CLI invocation.');
}
if (!/cmd\.exe/.test(source) || !/android-studio-script/.test(source)) {
  errors.push('patch-android-generated.mjs must keep the Windows-safe Tauri Android BuildTask command.');
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Android MainActivity bridge check OK.');
