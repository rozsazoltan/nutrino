import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const vueFiles = [];
const ignored = new Set(['node_modules', 'dist', 'target', '.git', 'src-tauri/target']);

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignored.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (entry.endsWith('.vue')) vueFiles.push(full);
  }
}

walk(root);

const unsafeBoundTranslation = /(?:^|\s)(?::|v-bind:)[\w-]+\s*=\s*"[^"]*\bt\("/g;
const unsafeInterpolatedTranslation = /\{\{\s*t\("/g;
const failures = [];

for (const file of vueFiles) {
  const source = readFileSync(file, 'utf8');
  const checks = [unsafeBoundTranslation, unsafeInterpolatedTranslation];
  for (const regex of checks) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(source))) {
      const line = source.slice(0, match.index).split('\n').length;
      failures.push(`${relative(root, file)}:${line}: unsafe double-quoted t(\"...\") translation expression`);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`Vue i18n quote check OK (${vueFiles.length} .vue files).`);
