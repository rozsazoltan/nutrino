#!/usr/bin/env node
import fs from 'node:fs';

const file = 'apps/desktop/src/App.vue';
const source = fs.readFileSync(file, 'utf8');
const templateStart = source.indexOf('<template>');
const templateEnd = source.indexOf('</template>');
const template = templateStart >= 0 && templateEnd > templateStart ? source.slice(templateStart, templateEnd) : source;
const errors = [];

if (/v-for="note in csvImportNotes"[^>]*>\s*\{\{\s*note\s*\}\}/.test(template)) {
  errors.push('csvImportNotes must be rendered through t(note), not raw {{ note }}.');
}

const rawUiInterpolation = [...template.matchAll(/\{\{\s*['"](ui\.[^'"]+)['"]\s*\}\}/g)].map((match) => match[1]);
if (rawUiInterpolation.length) {
  errors.push(`Raw ui.* template keys found: ${rawUiInterpolation.join(', ')}`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Desktop raw i18n key check OK.');
