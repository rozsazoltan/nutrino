import fs from 'node:fs';
import vm from 'node:vm';

function extractObject(file, name) {
  const src = fs.readFileSync(file, 'utf8');
  const idx = src.indexOf(`const ${name}`);
  if (idx < 0) throw new Error(`${name} not found in ${file}`);
  const eq = src.indexOf('=', idx);
  const start = src.indexOf('{', eq);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return vm.runInNewContext(`(${src.slice(start, i + 1)})`, {});
    }
  }
  throw new Error(`${name} object was not closed in ${file}`);
}

const languageCodes = ['hu', 'de', 'fr', 'ru', 'uk', 'zh', 'sk', 'ro', 'cs', 'sl', 'hr', 'pl', 'es', 'pt'];
const desktopFile = 'apps/desktop/src/App.vue';
const mobileFile = 'apps/mobile/src/App.vue';
const desktopBase = {
  ...extractObject(desktopFile, 'translations').en,
  ...extractObject(desktopFile, 'desktopSupplementalTranslations').en,
};
const mobileBase = {
  ...extractObject(mobileFile, 'translations').en,
  ...extractObject(mobileFile, 'supplementalTranslations').en,
};
const desktopComplete = extractObject(desktopFile, 'completeDesktopLanguageTranslations');
const mobileComplete = extractObject(mobileFile, 'completeMobileLanguageTranslations');

function assertComplete(scope, base, complete) {
  const baseKeys = Object.keys(base);
  for (const language of languageCodes) {
    const values = complete[language] || {};
    const missing = baseKeys.filter((key) => !(key in values) || String(values[key] ?? '').trim() === '');
    if (missing.length) {
      throw new Error(`${scope} ${language} has ${missing.length} missing i18n keys: ${missing.slice(0, 10).join(', ')}`);
    }
  }
  console.log(`${scope} i18n completeness OK (${baseKeys.length} keys × ${languageCodes.length} languages).`);
}

assertComplete('Desktop', desktopBase, desktopComplete);
assertComplete('Mobile', mobileBase, mobileComplete);
